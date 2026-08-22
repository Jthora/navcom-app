/**
 * The Watchtower key, on a phone.
 *
 * A squad with no box holds the watch here, so this key is the watch's identity: the address
 * operators send to. Losing it or replacing it strands everybody configured against it.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  createWatch, foundedHere, joinWatch, leaveWatch, watchKey, WatchKeyError
} from './watch-key';

/** Enough of the browser API for storage; the real one is tiny here. */
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
});

describe('joining a watch on a device that already holds one', () => {
  it('is refused rather than silently replacing it', () => {
    // `createWatch` was guarded against replacing a live watch's identity and `joinWatch` —
    // the one that takes a key from somebody else — was not. On a device holding the only
    // copy, that is the watch ending and everybody configured against it stranded.
    const first = createWatch();
    expect(() => joinWatch('d'.repeat(63) + '4')).toThrow(WatchKeyError);
    expect(watchKey()).toEqual(first);
  });

  it('says what to do about it', () => {
    createWatch();
    expect(() => joinWatch('d'.repeat(63) + '4')).toThrow(/give that one up first/i);
  });

  it('still joins on a device with no watch', () => {
    const joined = joinWatch('d'.repeat(63) + '4');
    expect(watchKey()).toEqual(joined);
    // Joining is not founding, so the qualification gate still applies.
    expect(foundedHere()).toBe(false);
  });

  it('joins again once the first has been given up', () => {
    createWatch();
    leaveWatch();
    expect(() => joinWatch('d'.repeat(63) + '4')).not.toThrow();
  });
});

describe("the watch key is the watch's identity", () => {
  it('is never replaced by founding a second time', () => {
    // Its own words: "replacing a live watch's identity would silently strand every operator
    // configured against the old address." 4.X added the same guard to `joinWatch` and tested
    // that one; the original here had no test.
    const first = createWatch();
    expect(createWatch()).toEqual(first);
    expect(watchKey()).toEqual(first);
  });

  it('records that this device founded it, which is how the gate opens at all', () => {
    // The genesis route. `can take watch` gates who may hold a board, and gating on it alone
    // bricks a new squad: nobody has standing, so nobody can take the watch, so the watch is
    // unusable. Founding needs nobody's permission because there is nobody to ask.
    createWatch();
    expect(foundedHere()).toBe(true);
  });

  it('does not treat a key somebody handed you as founding', () => {
    joinWatch('d'.repeat(63) + '4');
    expect(foundedHere()).toBe(false);
  });

  it('forgets that it founded once the watch is given up', () => {
    // Otherwise an operator who gives up their own watch and joins somebody else's would
    // still walk through the gate as a founder of a watch that is not theirs.
    createWatch();
    leaveWatch();
    expect(foundedHere()).toBe(false);

    joinWatch('d'.repeat(63) + '4');
    expect(foundedHere()).toBe(false);
  });

  it('reads a damaged key as no watch rather than refusing to start', () => {
    // Same call the corrupt-storage path makes everywhere else: a terminal that will not
    // start is worse than one that says it holds no watch.
    createWatch();
    localStorage.setItem(
      'navcom.accruing',
      JSON.stringify({ watch_secret: 'not-a-key', watch_founded: true })
    );
    expect(() => watchKey()).not.toThrow();
    expect(watchKey()).toBeNull();
  });
});
