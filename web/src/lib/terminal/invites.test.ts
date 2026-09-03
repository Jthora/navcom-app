/**
 * The pairing inbox.
 *
 * **Anybody can write to it.** The contact key is published — that is what a card is for —
 * so this is the one place in the app where a stranger's traffic lands on the operator's
 * screen without their consent. What matters here is that it stays usable when somebody
 * abuses that.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { buildInvite, newSecretKey, publicKeyOf } from '@navcom/core';

const me = newSecretKey();
const myPubkey = publicKeyOf(me);

/** Delivers whatever the relay subscription hands over. */
let deliver: (event: Event) => void = () => {};

vi.mock('./identity', () => ({
  loadIdentity: () => ({ secretKey: me, pubkey: myPubkey, callsign: 'Wren' })
}));
vi.mock('./card', () => ({ contactKey: () => null, contactPubkey: () => null }));
vi.mock('./relays', () => ({ relays: () => ['wss://fake.relay'] }));
vi.mock('./pq.svelte', () => ({ kemKeys: () => ({}) }));
/** Whether the relays accept anything. A field terminal is offline more often than not. */
let relaysUp = true;

vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: (_u: string[], _f: unknown, p: { onevent: (e: Event) => void }) => {
      deliver = p.onevent;
      return { close: () => {} };
    },
    publish: () =>
      relaysUp
        ? [Promise.resolve('ok')]
        : [Promise.reject(new Error('no relay accepted'))]
  })
}));

const { invites, invite } = await import('./invites.svelte');

const T = 1_800_000_000;
const from = (secret: Uint8Array, callsign: string, at: number): Event =>
  buildInvite(secret, myPubkey, { callsign }, at);

const flood = (n: number) => {
  for (let i = 0; i < n; i++) deliver(from(newSecretKey(), `S${i}`, T + i));
};

/**
 * Enough to overrun a cap of fifty, and not four times more.
 *
 * These tests used to flood **200**, which meant 200 keypairs generated and 200 invites
 * signed, encrypted and decrypted -- about 2.2 seconds of real crypto each, on an idle
 * machine, against vitest's 5-second default. Under any load they crossed it: **one in five
 * runs failed in isolation and one in two inside the full suite**, and the failure was a
 * timeout wearing the costume of a broken cap.
 *
 * A flaky test is worse than a missing one, because it teaches people to re-run instead of
 * read -- and this project's whole verification posture depends on a red result meaning
 * something.
 *
 * The assertion does not get stronger past the cap. Sixty overruns fifty, proves precisely
 * what 200 proved, and leaves headroom on a machine with other work open.
 */
const OVER_CAP = 60;

beforeEach(() => {
  relaysUp = true;
  invites.ignoreAll();
  invites.start();
});

describe('when pairing requests arrive faster than the list will hold', () => {
  it('keeps the screen usable instead of holding every one', () => {
    // Unbounded, five thousand of these cost twelve and a half million property copies and
    // four seconds on a laptop, because each arrival copied the whole map. On a prepaid
    // Android 8 the screen is gone, and the peers list goes with it.
    flood(OVER_CAP);
    expect(invites.waiting.length).toBeLessThanOrEqual(50);
  });

  it('says so, rather than quietly turning people away', () => {
    flood(OVER_CAP);
    expect(invites.flooded).toBe(true);
  });

  it('can be cleared in one action, or the cap is worse than the flood', () => {
    // A capped list that empties only fifty taps at a time is one an operator cannot
    // recover from — which would make the cap the attack rather than the defence.
    flood(OVER_CAP);
    invites.ignoreAll();
    expect(invites.waiting).toHaveLength(0);
    expect(invites.flooded).toBe(false);
  });

  it('takes a real invite again once there is room', () => {
    flood(OVER_CAP);
    invites.ignoreAll();
    deliver(from(newSecretKey(), 'Raven', T + 9_999));
    expect(invites.waiting.map((w) => w.payload.callsign)).toContain('Raven');
  });

  it('holds an ordinary handful without complaining', () => {
    flood(3);
    expect(invites.waiting).toHaveLength(3);
    expect(invites.flooded).toBe(false);
  });
});

describe('accepting when the reply cannot be sent', () => {
  it('says the pairing is one-sided rather than reporting success', async () => {
    // Pairing is two halves and only one is local. The publish result was discarded, so an
    // operator accepting with no signal — the ordinary state of a field terminal — added
    // the peer to their own list, sent nothing, and was told nothing.
    deliver(from(newSecretKey(), 'Raven', T));
    const waiting = invites.waiting[0]!;

    relaysUp = false;
    expect(await invites.accept(waiting, 'Raven')).toBe(false);
  });

  it('leaves it on the screen so it can be tried again', async () => {
    // There is deliberately no retry queue — invites are held in memory so there is nothing
    // to expire, migrate or leak into a wipe. The retry is the operator tapping again.
    deliver(from(newSecretKey(), 'Raven', T));
    relaysUp = false;
    await invites.accept(invites.waiting[0]!, 'Raven');
    expect(invites.waiting).toHaveLength(1);
  });

  it('succeeds on the second try without refusing an already-made pairing', async () => {
    deliver(from(newSecretKey(), 'Raven', T));
    relaysUp = false;
    await invites.accept(invites.waiting[0]!, 'Raven');

    relaysUp = true;
    expect(await invites.accept(invites.waiting[0]!, 'Raven')).toBe(true);
    expect(invites.waiting).toHaveLength(0);
  });

  it('reports plainly when the reply did go out', async () => {
    deliver(from(newSecretKey(), 'Raven', T));
    expect(await invites.accept(invites.waiting[0]!, 'Raven')).toBe(true);
    expect(invites.waiting).toHaveLength(0);
  });
});

describe('asking somebody to pair', () => {
  it('does not claim to have sent something that never left the device', async () => {
    relaysUp = false;
    expect(await invite(publicKeyOf(newSecretKey()), 'out most Thursdays')).toBe(false);
  });

  it('says so when it did', async () => {
    expect(await invite(publicKeyOf(newSecretKey()), 'out most Thursdays')).toBe(true);
  });
});
