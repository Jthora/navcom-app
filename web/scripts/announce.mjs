/**
 * Telling whoever holds the directory that there is a new one.
 *
 * [`pinning.md`](../../docs/pinning.md) documents the arrangement this replaces the trigger for:
 * a node fetches `/_ipfs/navcom-directory.car` on a timer and imports it. That works, needs no
 * credential, and remains correct. Its only cost is latency — a holder learns up to a cadence
 * late.
 *
 * This publishes a pointer instead, so a holder finds out when it happens.
 *
 * ## What is on the wire
 *
 * A hash, two counts, an HTTPS URL and a commit — a few hundred bytes, addressable so the latest
 * replaces the last. **Nothing that is not already public on the site**, and no operator named
 * anywhere, which is what makes it the only NavCom event that may cross a relay another project
 * runs. Every other kind here is about a person, and a small allowlisted relay is *worse* for
 * those than a public one: the protection is the anonymity set, not the sealing.
 *
 * ## What NavCom holds, and what it does not
 *
 * A node key of its own, and nothing of anybody else's. It signs with that and connects to a URL.
 * If the key leaks, somebody can announce a hash NavCom never built — and what they still cannot
 * do is make bytes at that hash. **A holder that fetches and verifies is unharmed; one that
 * believes the pointer was never protected by anything.** So this is published as something to
 * check, and `test:pin` is the checking.
 *
 * ## Silent when unconfigured, loud when it fails
 *
 * No relay and no key means no publish, no error, and no complaint — the pull path is the
 * documented default and a build must not report it as a shortfall. A relay that refuses or times
 * out is recorded in the receipt and printed, and never fails the deploy: *it may fail, it may
 * never fail silently.*
 */

import { WebSocket } from 'ws';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAnnouncement } from '@navcom/core';

const OUT = fileURLToPath(new URL('../build/_ipfs/', import.meta.url));

/** Long enough for a slow relay, short enough that a dead one does not hold a deploy open. */
const TIMEOUT = 15_000;

/**
 * Publishes one event and waits for the relay to say what it did with it.
 *
 * **Waits for `OK`, rather than for the socket to accept the bytes.** A write that returned is not
 * a message a relay kept — relays refuse events for rate limits, for kind policy, for size, and a
 * publisher that treated a successful `send()` as a successful publish would report a pointer
 * nobody can read. That is the disguised success this project keeps finding, one layer down.
 *
 * @param {string} url
 * @param {{ id: string }} event
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export function publish(url, event) {
  return new Promise((resolve) => {
    /** @type {import('ws').WebSocket | undefined} */
    let socket;
    /** @param {boolean} ok @param {string} detail */
    const finish = (ok, detail) => {
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already gone. Nothing to do and nothing worth saying.
      }
      resolve({ ok, detail });
    };

    const timer = setTimeout(() => finish(false, `no answer in ${TIMEOUT / 1000}s`), TIMEOUT);

    try {
      socket = new WebSocket(url);
    } catch (e) {
      return finish(false, e instanceof Error ? e.message : String(e));
    }

    socket.on('error', (e) => finish(false, e instanceof Error ? e.message : String(e)));
    socket.on('close', () => finish(false, 'closed before answering'));
    socket.on('open', () => socket.send(JSON.stringify(['EVENT', event])));

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      // `["OK", <id>, <accepted>, <reason>]` — and the reason is the relay's own words, which is
      // the only thing that distinguishes "rate limited" from "this kind is not allowed here".
      if (message[0] !== 'OK' || message[1] !== event.id) return;
      finish(message[2] === true, String(message[3] ?? ''));
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sidecarPath = join(OUT, 'navcom-directory.json');
  if (!existsSync(sidecarPath)) {
    console.error('[announce] no archive — run `npm run car` first.');
    process.exit(1);
  }
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));

  const relay = process.env.NAVCOM_ANNOUNCE_RELAY;
  const secretHex = process.env.NAVCOM_NODE_SECRET;

  if (!relay || !secretHex) {
    /*
     * The default. Worded as a default rather than as a miss, for the same reason the pin step is
     * — a build log that reports the preferred arrangement as a shortfall is one somebody
     * eventually "fixes" by adding a credential nobody needed.
     */
    console.log('[announce] no relay configured — holders find the new hash by polling, which is fine.');
    process.exit(0);
  }

  if (!/^[0-9a-f]{64}$/.test(secretHex)) {
    // Refused rather than coerced. A malformed key here would sign with something unintended, and
    // an announcement from an identity nobody recognises is worse than none.
    console.error('[announce] NAVCOM_NODE_SECRET must be 64 hex characters. Nothing published.');
    process.exit(0);
  }

  const secret = Uint8Array.from((secretHex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

  const event = buildAnnouncement(
    secret,
    {
      artifact: 'navcom:directory',
      cid: sidecar.cid,
      car: 'https://navcom.app/_ipfs/navcom-directory.car',
      census: { records: sidecar.records, regions: sidecar.regions },
      ...(sidecar.commit ? { commit: sidecar.commit } : {})
    },
    Math.floor(Date.now() / 1000)
  );

  const { ok, detail } = await publish(relay, event);

  sidecar.announced = ok
    ? { relay, at: new Date().toISOString(), event: event.id }
    : { relay, at: new Date().toISOString(), failed: detail || 'refused without saying why' };
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');

  if (ok) {
    console.log(`[announce] ${sidecar.cid} → ${relay}`);
  } else {
    console.error(`[announce] FAILED — ${sidecar.announced.failed}`);
    console.error('[announce] the deploy continues; holders can still poll for the archive.');
  }
  process.exit(0);
}
