/**
 * Reading the watch's state from several relays at once [audit: relay paths, F01, F11].
 *
 * Each relay serves its own last copy of a replaceable event, and they need not agree — so the
 * newest must win whatever order they answer in. And a list the pool cannot open must leave the
 * reading Dark, never throw out of the screen that asked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { buildWatchStateEvent, type WatchStateRead } from '@navcom/core';

const subscribed: { onevent: (e: unknown) => void; oneose?: () => void }[] = [];
let throws = false;
vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: (_urls: string[], _f: unknown, params: { onevent: (e: unknown) => void; oneose?: () => void }) => {
      if (throws) throw new Error('Invalid URL: wss://');
      subscribed.push(params);
      return { close() {} };
    }
  })
}));

const { watchWatchtower } = await import('./relay');

const watch = generateSecretKey();
const now = Math.floor(Date.now() / 1000);
const state = (s: 'station' | 'dark', at: number) =>
  finalizeEvent(
    buildWatchStateEvent(
      {
        state: s,
        holder: s === 'station' ? 'Wren' : null,
        holder_kind: s === 'station' ? 'human' : null,
        oncall: [],
        since: at,
        agent_health: 'ok',
        last_drill: null,
        now: at
      } as never,
      at
    ),
    watch
  );

beforeEach(() => {
  subscribed.length = 0;
  throws = false;
});

describe('two relays that disagree', () => {
  /*
   * Each copy on its own relay, in both orders, and the reading asserted exactly. This used to
   * assert only that the last reading was not Station — which the absent reading given before
   * anything arrives satisfies, so a module that showed nothing at all passed [review: relay paths].
   */
  const read = (first: ReturnType<typeof state>, second: ReturnType<typeof state>) => {
    const reads: WatchStateRead[] = [];
    const c = watchWatchtower({ pubkey: getPublicKey(watch), relays: ['wss://a', 'wss://b'], holders: [] }, (r) => reads.push(r));
    expect(subscribed, 'one subscription per relay').toHaveLength(2);
    subscribed[0]!.onevent(first);
    subscribed[1]!.onevent(second);
    c.close();
    return reads.at(-1);
  };

  it('keeps the newer state when the older arrives last', () => {
    expect(read(state('dark', now - 10), state('station', now - 60))).toMatchObject({
      reason: null,
      dark: true,
      state: { state: 'dark' }
    });
  });

  it('takes the newer state when it arrives last', () => {
    expect(read(state('dark', now - 60), state('station', now - 10))).toMatchObject({
      reason: null,
      dark: false,
      state: { state: 'station', holder: 'Wren' }
    });
  });
});

describe('a list the pool cannot open', () => {
  it('leaves the reading Dark and throws nothing out of the screen', () => {
    throws = true;
    const reads: { read: WatchStateRead; heard?: { unanswered: boolean } }[] = [];
    expect(() =>
      watchWatchtower({ pubkey: getPublicKey(watch), relays: ['wss://', 'wss://bad.example'], holders: [] }, (read, heard) =>
        reads.push({ read, heard })
      )
    ).not.toThrow();
    expect(reads.every((r) => r.read.dark)).toBe(true);
    // And it says nobody answered, rather than that the watch published nothing [F20].
    expect(reads.at(-1)!.heard).toEqual({ unanswered: true });
  });
});
