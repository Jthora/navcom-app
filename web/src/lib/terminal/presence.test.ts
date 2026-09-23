/**
 * Who else is out, as this device sees it.
 *
 * The thing that matters here is what *silence* is allowed to mean. A peer we have not heard
 * from is unknown — never home, never in trouble — and how long it has been since we heard
 * from them is a question only this phone can answer.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { buildPresence, newSecretKey, publicKeyOf } from '@navcom/core';

const me = newSecretKey();
const myPubkey = publicKeyOf(me);
const raven = newSecretKey();
const ravenPubkey = publicKeyOf(raven);

let deliver: (event: Event) => void = () => {};

vi.mock('./identity', () => ({
  loadIdentity: () => ({ secretKey: me, pubkey: myPubkey, callsign: 'Wren' })
}));
vi.mock('./peers', () => ({
  peers: () => [{ pubkey: ravenPubkey, callsign: 'Raven', since: 0 }],
  peerPubkeys: () => [ravenPubkey],
  buddies: () => []
}));
vi.mock('./relays', () => ({ relays: () => ['wss://fake.relay'] }));
vi.mock('./pq.svelte', () => ({ kemKeys: () => ({}) }));
vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: (_u: string[], _f: unknown, p: { onevent: (e: Event) => void }) => {
      deliver = p.onevent;
      return { close: () => {} };
    },
    publish: () => [Promise.resolve('ok')]
  })
}));

const { presence } = await import('./presence.svelte');

/** A heartbeat from Raven, stamped with whatever Raven's phone thinks the time is. */
const heartbeat = (theirClock: number): Event =>
  buildPresence(raven, [myPubkey], {
    callsign: 'Raven', status: 'out', area: 'north side', until: theirClock + 3600
  }, theirClock)[0]!;

beforeEach(() => {
  presence.stop();
  presence.start();
});

describe("a peer whose phone has the wrong time", () => {
  it('is still out when their clock runs slow', () => {
    // Ten minutes slow. Measured against their own timestamp this read as unknown while
    // they were actively out — and a buddy watching them would have acted on that.
    const theirs = Math.floor(Date.now() / 1000) - 600;
    deliver(heartbeat(theirs));
    expect(presence.out.map((p) => p.callsign)).toContain('Raven');
    expect(presence.unknown.map((p) => p.callsign)).not.toContain('Raven');
  });

  it('goes unknown on our silence, not on their clock', () => {
    // An hour fast, and they stopped half an hour ago. Measured against their timestamp
    // this read as OUT — telling a buddy somebody is fine when nothing has been heard,
    // which is the one thing this module says it will never do.
    vi.useFakeTimers();
    try {
      deliver(heartbeat(Math.floor(Date.now() / 1000) + 3600));
      expect(presence.out.map((p) => p.callsign)).toContain('Raven');

      vi.advanceTimersByTime(31 * 60 * 1000);
      expect(presence.out.map((p) => p.callsign)).not.toContain('Raven');
      expect(presence.unknown.map((p) => p.callsign)).toContain('Raven');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still uses their clock to order two of their own heartbeats', () => {
    // It is the only thing that can say which of two came later, and relays deliver out of
    // order as a matter of course.
    const theirs = Math.floor(Date.now() / 1000);
    deliver(heartbeat(theirs));
    const stale = buildPresence(raven, [myPubkey], {
      callsign: 'Raven', status: 'stood-down', area: null, until: theirs
    }, theirs - 300)[0]!;
    deliver(stale);
    expect(presence.out.map((p) => p.callsign)).toContain('Raven');
  });
});

describe('the outgoing heartbeat', () => {
  it('is not stopped by the screen that stops the listening', () => {
    /*
     * `presence.stop()` is the Status screen's `onMount` cleanup, and it used to clear the beat
     * as well as the subscription. So the first time an operator left Status for any other
     * screen, their own heartbeat stopped while they were still out — and three minutes later
     * every paired peer moved them to `unknown · nothing heard`, where a buddy who agreed to
     * watch could no longer tell a flat battery from trouble.
     */
    vi.useFakeTimers();
    let beats = 0;
    presence.beat(() => {
      beats++;
      return { callsign: 'Wren', status: 'out', area: 'north side', until: 0 };
    });

    presence.stop();
    vi.advanceTimersByTime(180_000);
    expect(beats, 'the beat belongs to the patrol, not to a screen').toBeGreaterThan(0);

    // It ends where the patrol does.
    presence.stopBeat();
    const after = beats;
    vi.advanceTimersByTime(180_000);
    expect(beats).toBe(after);
    vi.useRealTimers();
  });
});
