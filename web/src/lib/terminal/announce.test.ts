import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAnnouncement, newSecretKey, publicKeyOf, readAnnouncement } from '@navcom/core';
// Plain .mjs — this is the file that runs during a deploy.
import { publish } from '../../../scripts/announce.mjs';
import { startRelay, type LocalRelay } from '../../../e2e/relay-server';

/**
 * The pointer, across a relay that is actually running.
 *
 * This project already owns the right counterparty for this: `e2e/relay-server.ts` is a real
 * NIP-01 relay written for the two-device tests, and the day it replaced a stub it exposed within
 * ten minutes that 259 browser tests had been running with both operators holding the same key.
 *
 * So unlike the request signer — which no credential on this machine could ever have judged — the
 * publisher can be exercised end to end: a real WebSocket, a real `["EVENT", …]` frame it
 * composed, a real `["OK", …]` coming back, and a subscriber reading the event out of the relay
 * without being told what to expect.
 *
 * **The limit, stated rather than left implied:** this relay was written by this project, so both
 * ends still trace to one reading of NIP-01. It proves the publisher speaks the protocol. It does
 * not prove any particular relay accepts a `30078`, which is a policy question only that relay's
 * operator can answer.
 */

let relay: LocalRelay;

beforeAll(async () => {
  relay = await startRelay();
});

afterAll(async () => {
  await relay?.close();
});

const NODE = newSecretKey();
const CID = 'bafybeigpcpp4xcwpt7by6nzklntkjnrprfowzuvng36x7kgw26nzcjipji';

const announcement = () =>
  buildAnnouncement(
    NODE,
    {
      artifact: 'navcom:directory',
      cid: CID,
      car: 'https://navcom.app/_ipfs/navcom-directory.car',
      census: { records: 479, regions: 68 }
    },
    Math.floor(Date.now() / 1000)
  );

describe('publishing to a relay that is real', () => {
  it('the relay is real, so a passing run means something', async () => {
    // Without this the file passes beautifully against a relay that never started — the failure
    // mode of every test that watches for an absence, and one this project has been bitten by.
    expect(relay.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });

  it('waits for the relay to say it kept the event, not merely for the socket to accept it', async () => {
    /*
     * The property that makes this worth having. A relay refuses events for rate limits, size and
     * kind policy, and a publisher treating a successful `send()` as a successful publish would
     * record a pointer nobody can read — disguised success, one layer below where this project
     * has been finding it all week.
     */
    const event = announcement();
    const { ok } = await publish(relay.url, event);
    expect(ok).toBe(true);
    expect(relay.received.map((e) => e.id)).toContain(event.id);
  });

  it('and a subscriber reads it back, having been told nothing', async () => {
    const event = announcement();
    await publish(relay.url, event);

    const { WebSocket } = await import('ws');
    const socket = new WebSocket(relay.url);
    const seen = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('nothing arrived')), 10_000);
      socket.on('open', () => socket.send(JSON.stringify(['REQ', 'sub', { kinds: [30078] }])));
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw));
        if (message[0] !== 'EVENT') return;
        clearTimeout(timer);
        resolve(message[2]);
      });
      socket.on('error', reject);
    });
    socket.close();

    // Verified from the wire, by the same reader another node would use.
    const read = readAnnouncement(seen as never);
    expect(read?.cid).toBe(CID);
    expect(read?.by).toBe(publicKeyOf(NODE));
    expect(read?.census).toEqual({ records: 479, regions: 68 });
  });

  it('names nobody on the wire', async () => {
    /*
     * The check that decides whether this may cross a relay somebody else runs. Asserted against
     * the bytes sitting in the relay's memory rather than against the object that was sent — the
     * same reasoning as the real-relay test, which asserts what actually left the device.
     */
    await publish(relay.url, announcement());
    const onTheWire = JSON.stringify(relay.received).toLowerCase();
    for (const forbidden of ['callsign', 'verified_by', 'wren', 'presence', 'distress']) {
      expect(onTheWire, `"${forbidden}" reached the relay`).not.toContain(forbidden);
    }
  });
});

describe('when the relay is not there', () => {
  it('reports a refusal rather than throwing, so a deploy is never taken down by one', async () => {
    // Port 1 is reserved and nothing listens on it. The publisher has to come back with an answer
    // rather than an exception, because the caller records the failure and carries on.
    const { ok, detail } = await publish('ws://127.0.0.1:1', announcement());
    expect(ok).toBe(false);
    expect(detail.length).toBeGreaterThan(0);
  });

  it('reports a refusal the relay explains, in the relay’s own words', async () => {
    /*
     * A build log that says "failed" and nothing else sends somebody to read the wrong code. The
     * reason is the only thing that separates a rate limit from "this kind is not accepted here",
     * which is the answer that actually matters on a relay with a kind policy.
     */
    const refusing = await startRelay({ refuse: 'blocked: kind not accepted' });
    try {
      const { ok, detail } = await publish(refusing.url, announcement());
      expect(ok).toBe(false);
      expect(detail).toContain('kind not accepted');
    } finally {
      await refusing.close();
    }
  });
});
