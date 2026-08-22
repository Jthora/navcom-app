/**
 * The board a watch reads during an incident.
 *
 * The watch's address is handed to every operator, so anybody holding it can put something
 * here — the same open door the escalation executor has. What matters is that the one signal
 * that means somebody is hurt cannot be buried by the rest.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { buildSignal, buildDistress, newSecretKey, publicKeyOf } from '@navcom/core';
import { finalizeEvent } from 'nostr-tools/pure';

const watch = newSecretKey();
const watchPub = publicKeyOf(watch);

let deliver: (event: Event) => void = () => {};

vi.mock('./identity', () => ({
  loadIdentity: () => ({ secretKey: watch, pubkey: watchPub, callsign: 'Watch' })
}));
vi.mock('./config', () => ({ loadConfig: () => ({ watchtower: watchPub, relays: ['wss://r'] }) }));
vi.mock('./watch-key', () => ({ watchKey: () => watch, watchPubkey: () => watchPub }));
vi.mock('./relays', () => ({ relays: () => ['wss://r'] }));
vi.mock('./pq.svelte', () => ({ kemKeys: () => ({}), pq: { known: {} } }));
/** Whether relays accept anything. A watch on a phone is offline as often as an operator. */
let relaysUp = true;

vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: (_u: string[], _f: unknown, p: { onevent: (e: Event) => void }) => {
      deliver = p.onevent;
      return { close: () => {} };
    },
    publish: () =>
      relaysUp ? [Promise.resolve('ok')] : [Promise.reject(new Error('no relay accepted'))]
  })
}));

/**
 * A fresh module per test.
 *
 * The board is module-level `$state` and deliberately has no reset — it expires on its own
 * and nothing persists it [C27]. That is right for the product and means a test must not
 * inherit the previous one's traffic.
 */
let board: typeof import('./board.svelte').board;

const T = 1_800_000_000;
const to = { pubkey: watchPub, holders: [watchPub] };

/** Signed the way a relay would deliver it — the builders return unsigned templates. */
const query = (i: number): Event => {
  const sender = newSecretKey();
  return finalizeEvent(buildSignal(sender, to, 'query', { text: `q${i}`, area: 'north' }, T + i), sender);
};

const onStation = (who: Uint8Array, at: number): Event =>
  finalizeEvent(
    buildSignal(who, to, 'on-station', {
      callsign: 'Raven', area: 'north side', expected_duration: 7200,
      routine_interval: null, share_position: false, position: null
    }, at),
    who
  );

const stoodDown = (who: Uint8Array, at: number): Event =>
  finalizeEvent(buildSignal(who, to, 'stood-down', {}, at), who);

const distress = (): Event => {
  const sender = newSecretKey();
  return finalizeEvent(
    buildDistress(sender, to, { position: null, area: 'north side' }, T + 99_999),
    sender
  );
};

beforeEach(async () => {
  relaysUp = true;
  vi.resetModules();
  ({ board } = await import('./board.svelte'));
  board.start();
});

/*
 * These process tens of thousands of real events, which takes seconds rather than
 * milliseconds — that is the point of them, and it is not a cost worth optimising away.
 *
 * With vitest's 5s default they sat close enough to the limit that a **busy machine failed
 * them**, which is the worst place for a flaky test to live: they are the two anti-flooding
 * properties, so an intermittent red trains somebody to re-run rather than to look, and a
 * shared CI runner is exactly where it fires [`audit-tests.md` 9.S].
 */
describe('a Distress arriving after a flood of routine traffic', () => {
  it('is not buried underneath it', () => {
    // `20911` is a separate kind precisely so a client can prioritise it independently of
    // routine traffic. The board flattened it into one queue sorted by arrival, coloured red
    // and otherwise equal — so a hundred queries arriving first put it a hundred rows down
    // the screen a watch reads when somebody is in trouble.
    for (let i = 0; i < 150; i++) deliver(query(i));
    deliver(distress());

    expect(board.distress).toHaveLength(1);
    expect(board.waiting.every((w) => w.type !== 'distress')).toBe(true);
  });

  it('is still admitted when the routine board is completely full', () => {
    // Routine traffic is dropped once the board is full. A Distress must never be one of
    // the things dropped to make room for a query.
    for (let i = 0; i < 400; i++) deliver(query(i));
    expect(board.routineDropped).toBe(true);

    deliver(distress());
    expect(board.distress).toHaveLength(1);
  });

  it('keeps the routine board usable rather than holding everything', () => {
    for (let i = 0; i < 400; i++) deliver(query(i));
    expect(board.waiting.length).toBeLessThanOrEqual(200);
  });

  it('says routine traffic is being dropped, rather than dropping it quietly', () => {
    for (let i = 0; i < 400; i++) deliver(query(i));
    expect(board.routineDropped).toBe(true);
    expect(board.distressDropped).toBe(false);
  });

  it('leaves an ordinary night alone', () => {
    for (let i = 0; i < 5; i++) deliver(query(i));
    deliver(distress());
    expect(board.waiting).toHaveLength(5);
    expect(board.distress).toHaveLength(1);
    expect(board.routineDropped).toBe(false);
  });
}, { timeout: 30_000 });

describe('a watch whose publishes do not land', () => {
  it('does not report standing down when the world still sees it on station', async () => {
    // This is what standDown exists to prevent, stated two lines above it: watch state is
    // replaceable, so going quiet leaves the previous state on the relay and every operator
    // reading it believes a human is watching. A Dark that fails to publish IS that — and
    // it is worse than never standing down, because the heartbeat that kept refreshing has
    // just been cleared, so nothing retries and nothing expires it soon.
    await board.takeWatch();
    expect(board.onStation).toBe(true);

    relaysUp = false;
    await board.standDown();
    expect(board.onStation).toBe(false);
    expect(board.stillAdvertised).toBe(true);
  });

  it('says nobody can see a watch that never announced itself', async () => {
    // Being on station is a claim made to other people. A holder whose screen says "On
    // station" while nothing was published is covering nobody and does not know it.
    relaysUp = false;
    await board.takeWatch();
    expect(board.unannounced).toBe(true);
  });

  it('is quiet when taking the watch actually worked', async () => {
    await board.takeWatch();
    expect(board.unannounced).toBe(false);
    expect(board.stillAdvertised).toBe(false);
  });

  it('keeps an unsent answer on the board instead of clearing it', async () => {
    // The result was discarded, so an answer that reached no relay still cleared the item:
    // the watch believed they had replied and the operator got nothing.
    deliver(query(1));
    const item = board.waiting[0]!;

    relaysUp = false;
    expect(await board.answer(item, 'the shelter on 8th')).toBe(false);
    expect(board.waiting.map((w) => w.id)).toContain(item.id);
  });

  it('clears it once the answer has actually gone', async () => {
    deliver(query(1));
    const item = board.waiting[0]!;
    expect(await board.answer(item, 'the shelter on 8th')).toBe(true);
    expect(board.waiting.map((w) => w.id)).not.toContain(item.id);
  });

  it('never clears a Distress, even on a successful acknowledgement', async () => {
    // Acknowledging is telling them somebody is awake, not that it is over. Only a human
    // ending it clears one [invariant 2].
    deliver(distress());
    const item = board.distress[0]!;
    expect(await board.answer(item, 'awake, on my way')).toBe(true);
    expect(board.distress.map((w) => w.id)).toContain(item.id);
  });
});

describe('state changes arriving out of order', () => {
  it('does not let a replayed stand-down take somebody off the board', () => {
    // The presence store already guards this and says why — out-of-order delivery is normal
    // on relays. The board, which is the watch's picture of who is out, did not: a stale
    // stand-down removed an operator who was actually out, and the watch stopped seeing them.
    const raven = newSecretKey();
    deliver(stoodDown(raven, T));
    deliver(onStation(raven, T + 3600));
    expect(board.entries).toHaveLength(1);

    deliver(stoodDown(raven, T + 60));
    expect(board.entries).toHaveLength(1);
  });

  it('does not let a replayed sign-on put somebody back who has gone home', () => {
    // The other direction, and the reason the timestamp is remembered after the entry is
    // deleted rather than read off it.
    const raven = newSecretKey();
    deliver(onStation(raven, T));
    deliver(stoodDown(raven, T + 3600));
    expect(board.entries).toHaveLength(0);

    deliver(onStation(raven, T + 60));
    expect(board.entries).toHaveLength(0);
  });

  it('still follows a genuine stand-down', () => {
    const raven = newSecretKey();
    deliver(onStation(raven, T));
    deliver(stoodDown(raven, T + 3600));
    expect(board.entries).toHaveLength(0);
  });

  it('orders the queue by when we received it, not when they say they sent it', () => {
    // Sorted oldest first because those people have waited longest — and ordered by the
    // sender's own created_at, anything backdated went straight to the top of the queue.
    deliver(query(1));
    const backdated = (() => {
      const sender = newSecretKey();
      return finalizeEvent(
        buildSignal(sender, to, 'query', { text: 'jumped the queue', area: 'north' }, T - 999_999),
        sender
      );
    })();
    deliver(backdated);

    expect(board.waiting.map((w) => w.text)).toEqual(['q1', 'jumped the queue']);
  });
});
