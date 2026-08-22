/**
 * Corrections, and the one door a stranger can write through.
 *
 * Anybody may publish a correction, every device carrying that area caches it, and it is
 * keyed by author — so fresh keys buy unlimited entries in the tier that survives a wipe.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { buildCorrection, newSecretKey, publicKeyOf } from '@navcom/core';

const me = newSecretKey();

let deliver: (event: Event) => void = () => {};

vi.mock('./identity', () => ({
  loadIdentity: () => ({ secretKey: me, pubkey: publicKeyOf(me), callsign: 'Wren' })
}));
vi.mock('./card', () => ({ ensureContactKey: () => me }));
vi.mock('./relays', () => ({ relays: () => ['wss://fake.relay'] }));
/** Whether relays take anything. A doorway in a basement is the ordinary case here. */
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

let corrections: typeof import('./corrections.svelte').corrections;

const RECORD = 'st-louis-shelter-0001';

/** A correction from a fresh key, which is what an attacker has an unlimited supply of. */
const fromStranger = (record = RECORD, at = '2026-08-21'): Event =>
  buildCorrection(newSecretKey(), {
    record, verified_by: 'anonymous', method: 'in_person', last_verified: at,
    fields: { hours: '24/7' }
  }, 1_800_000_000);

beforeEach(async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  relaysUp = true;
  vi.resetModules();
  ({ corrections } = await import('./corrections.svelte'));
  corrections.start([RECORD, 'other-record']);
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
describe('a flood of corrections from strangers', () => {
  it('does not fill the phone', () => {
    // Twenty thousand is about 11 MB, past a typical quota — and a full phone stops saving,
    // so the end of that chain is an operator's patrol record silently failing to record,
    // caused by somebody with no relationship to them at all.
    for (let i = 0; i < 600; i++) deliver(fromStranger());
    expect(corrections.all.length).toBeLessThanOrEqual(400);
  });

  it('does not let one record swallow the whole budget', () => {
    for (let i = 0; i < 200; i++) deliver(fromStranger(RECORD));
    expect(corrections.about(RECORD).length).toBeLessThanOrEqual(25);

    // And another record can still be corrected afterwards.
    deliver(fromStranger('other-record'));
    expect(corrections.about('other-record')).toHaveLength(1);
  });

  it('says it is holding a partial set rather than looking uncorrected', () => {
    for (let i = 0; i < 200; i++) deliver(fromStranger(RECORD));
    expect(corrections.partial).toBe(true);
  });

  it('keeps what was already carried rather than evicting it', () => {
    // Refusing the new one rather than evicting an old one means a flood cannot displace a
    // correction somebody actually relies on.
    const early = fromStranger(RECORD, '2026-01-01');
    deliver(early);
    const before = corrections.about(RECORD).map((c) => c.by);

    for (let i = 0; i < 200; i++) deliver(fromStranger(RECORD));
    expect(corrections.about(RECORD).map((c) => c.by)).toEqual(expect.arrayContaining(before));
  });

  it('still updates somebody already held, even when full', () => {
    // An author already on the board is not a new entry, so a genuine update from them is
    // never refused because strangers filled the space.
    const author = newSecretKey();
    const first = buildCorrection(author, {
      record: RECORD, verified_by: 'Raven', method: 'in_person',
      last_verified: '2026-01-01', fields: { hours: 'old' }
    }, 1_800_000_000);
    deliver(first);

    for (let i = 0; i < 200; i++) deliver(fromStranger(RECORD));

    const updated = buildCorrection(author, {
      record: RECORD, verified_by: 'Raven', method: 'in_person',
      last_verified: '2026-08-21', fields: { hours: 'new' }
    }, 1_800_009_999);
    deliver(updated);

    const mine = corrections.about(RECORD).find((c) => c.by === publicKeyOf(author));
    expect(mine?.fields.hours).toBe('new');
  });

  it('leaves an ordinary area alone', () => {
    for (let i = 0; i < 3; i++) deliver(fromStranger());
    expect(corrections.about(RECORD)).toHaveLength(3);
    expect(corrections.partial).toBe(false);
  });
}, { timeout: 30_000 });

describe('a correction made where there is no signal', () => {
  /** Relays that refuse everything, which is a doorway in a basement. */
  const offline = () => { relaysUp = false; };
  const online = () => { relaysUp = true; };

  it('is kept so it can be sent later, rather than lost', async () => {
    // The comment promised this would "publish the next time this runs with a connection"
    // and nothing implemented it. The correction appeared in the operator's own directory,
    // so they had positive evidence it had worked — worse than a silent failure.
    offline();
    await corrections.submit(RECORD, { hours: '24/7' });
    expect(corrections.unsentCount).toBe(1);
  });

  it('still shows to the operator who made it', async () => {
    // They were at the door. Not showing it would be its own lie.
    offline();
    await corrections.submit(RECORD, { hours: '24/7' });
    expect(corrections.about(RECORD)).toHaveLength(1);
  });

  it('goes out on its own once there is signal', async () => {
    offline();
    await corrections.submit(RECORD, { hours: '24/7' });
    expect(corrections.unsentCount).toBe(1);

    online();
    await corrections.flush();
    expect(corrections.unsentCount).toBe(0);
  });

  it('is not queued when it went out the first time', async () => {
    online();
    await corrections.submit(RECORD, { hours: '24/7' });
    expect(corrections.unsentCount).toBe(0);
  });

  it('survives the app being closed and reopened', async () => {
    // Kept in the accruing tier beside the corrections themselves — this is the operator's
    // own contribution, and losing it is the failure.
    offline();
    await corrections.submit(RECORD, { hours: '24/7' });

    vi.resetModules();
    ({ corrections } = await import('./corrections.svelte'));
    corrections.start([RECORD]);
    expect(corrections.unsentCount).toBe(1);
  });
});
