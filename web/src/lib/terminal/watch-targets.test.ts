/**
 * The one list everything sent to the watch goes to, and every *heard on* count is counted against
 * [relay-lists §5, §7].
 *
 * Before it, `wakeOthers` filtered the watch's relays itself and every other sender handed core the
 * whole list, so a receipt counting against one of them could drift from where a `Distress` went.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THE_RECORD, listable, whyNotListable } from '@navcom/core';

let config: { pubkey: string; relays: string[]; holders: string[] } | null = null;
vi.mock('./config', () => ({ loadConfig: () => config }));

const { distressRelays, watchTargets, watchWithheld } = await import('./watch-targets');

const A = 'wss://a.relay';
const B = 'wss://b.relay';

beforeEach(() => {
  config = { pubkey: 'f'.repeat(64), relays: [A, THE_RECORD, B], holders: [] };
});

describe('where a Distress for this watch goes', () => {
  it('is every relay the watch names, less a mission relay, in order', () => {
    expect(watchTargets()).toEqual([A, B]);
  });

  it('names the mission relay it leaves out, with core’s reason', () => {
    expect(watchWithheld()).toEqual([{ url: THE_RECORD, reason: whyNotListable(THE_RECORD) }]);
    expect(watchWithheld()[0]!.reason).toMatch(/mission relay/);
  });

  it('is nowhere, and withholds nothing, with no watch', () => {
    config = null;
    expect(watchTargets()).toEqual([]);
    expect(watchWithheld()).toEqual([]);
    expect(distressRelays()).toEqual([]);
  });
});

describe('what a Distress is handed', () => {
  it('is the targets, then each relay left out, so the loop can say why nothing went there', () => {
    expect(distressRelays()).toEqual([A, B, THE_RECORD]);
  });

  it('goes exactly where the receipt counts: what core may send to is the targets, no more', () => {
    // Core refuses what `listable()` refuses, so handing it the withheld relays sends nothing more.
    expect(distressRelays().filter((url) => listable(url))).toEqual(watchTargets());
    config = { pubkey: 'f'.repeat(64), relays: [THE_RECORD], holders: [] };
    expect(distressRelays().filter((url) => listable(url))).toEqual([]);
    expect(distressRelays()).toEqual([THE_RECORD]);
  });
});
