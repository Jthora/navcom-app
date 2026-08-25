/**
 * Fetching it back from somebody who has never heard of this repository.
 *
 * Every other check on the archive is NavCom checking NavCom: the packer computes a CID, a test
 * recomputes it with the same library, and both agree because they are the same code. That is
 * the exact defect class this project catalogued across five projects in a single day — an
 * integration reporting success without ever meeting a counterparty it did not control. The
 * counter, every time, was a second implementation that was never told what to expect.
 *
 * **A public gateway is that counterparty.** It is somebody else's server, running somebody
 * else's IPFS implementation, retrieving over a network nobody here operates. If the bytes it
 * returns hash to the identifier NavCom published, then the identifier is what the world
 * computes for that content — and if they do not, NavCom has been publishing a number that
 * means nothing.
 *
 * ## Not in the default run
 *
 * `npm run test:pin`, the same treatment `real-relay.spec.ts` gets and for the same reason
 * already written down there: *"a test that can fail because a stranger rebooted a box is not a
 * test."* Gateways rate-limit, time out and disagree about propagation delay. This is a
 * deliberate check somebody runs, not a gate that turns red because `ipfs.io` is busy.
 *
 * ## What a pass means, and what it does not
 *
 * It proves the content is retrievable by CID from outside, right now, and that the bytes are
 * exactly what was published. It proves nothing about how long anybody will hold them — the
 * free tier is an account, and accounts are what actually fail in this network. That is why the
 * receipt names the holder rather than claiming permanence.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../build/_ipfs/', import.meta.url));
const DATA = fileURLToPath(new URL('../../data/regions/', import.meta.url));

/**
 * Gateways to try, in order.
 *
 * Several, because one being slow is not evidence of anything and a check that depends on a
 * single stranger's uptime is the thing this file exists to avoid. The first that answers
 * decides — they are all serving content addressed by hash, so a disagreement between them
 * would itself be the finding.
 */
const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/'
];

const TIMEOUT = 30_000;

/** @param {string} url */
async function fetchBytes(url) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { signal: control.signal });
    if (!response.ok) return { error: `${response.status} ${response.statusText}` };
    return { bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The CIDv1 a raw block of these bytes would have, computed here rather than borrowed.
 *
 * `<multibase 'b'><version 0x01><codec 0x55 raw><multihash 0x12 sha2-256><length 0x20><digest>`
 * — every field a single byte at these values, so nothing is needed from the library that wrote
 * the archive. Used to check the *object* identifier a pinning service assigns, which is a raw
 * upload rather than a UnixFS tree.
 *
 * @param {Uint8Array} bytes
 */
export function rawCid(bytes) {
  const A = 'abcdefghijklmnopqrstuvwxyz234567';
  const prefixed = new Uint8Array([0x01, 0x55, 0x12, 0x20, ...createHash('sha256').update(bytes).digest()]);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of prefixed) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return `b${out}`;
}

/*
 * Guarded, because a test importing `rawCid` for its own use should not run a network check
 * and call `process.exit`. Found by exactly that — the first test file to import this took the
 * whole suite down with an exit code, which is a small instance of the thing this script is
 * about: a side effect nobody asked for, arriving where it was not expected.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const sidecarPath = join(OUT, 'navcom-directory.json');
  if (!existsSync(sidecarPath)) {
    console.error('[verify-pin] no archive — run `npm run car` first.');
    process.exit(1);
  }

  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  const root = sidecar.pin?.root;

  if (!root) {
    console.error('[verify-pin] nothing is pinned — there is no third party to check against.');
    console.error(`[verify-pin] ${sidecar.held_by}`);
    process.exit(1);
  }

  let failed = false;
  let checked = 0;

  /**
   * The strong check: a file out of the pinned directory, byte for byte.
   *
   * Fetching the root's listing would only prove it resolved. Pulling a real file out of it and
   * comparing against the bytes on this disk proves the **content** survived — that what a
   * stranger retrieves for NavCom's published identifier is what NavCom published.
   */
  if (root) {
    const sample = sidecar.sample;
    const local = new Uint8Array(readFileSync(join(DATA, sample)));
    console.log(`[verify-pin] root ${root}`);
    console.log(`[verify-pin] asking for ${sample} — ${local.length} bytes on this disk\n`);

    for (const gateway of GATEWAYS) {
      const { bytes, error } = await fetchBytes(`${gateway}${root}/${sample}`);
      if (error || !bytes) {
        // Not a failure on its own. A gateway being slow is a fact about the gateway.
        console.log(`  ..  ${gateway} — ${error ?? 'no body'}`);
        continue;
      }
      const same = bytes.length === local.length && Buffer.compare(Buffer.from(bytes), Buffer.from(local)) === 0;
      console.log(`  ${same ? 'OK' : 'XX'}  ${gateway} — ${bytes.length} bytes`);
      if (!same) {
        console.error('\n[verify-pin] the bytes differ from what was published. Stop and find out why.');
        failed = true;
        break;
      }
      checked++;
    }
  }

  if (failed) process.exit(1);
  if (checked === 0) {
    console.error('\n[verify-pin] no gateway answered. That is a fact about today, not a pass.');
    process.exit(1);
  }

  console.log(`\n[verify-pin] ${checked} retrieval(s) verified against gateways nobody here operates.`);
  console.log(`[verify-pin] ${sidecar.records} records across ${sidecar.regions} regions — held by ${sidecar.held_by}.`);
}
