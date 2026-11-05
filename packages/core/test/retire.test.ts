import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { buildRetirement, readRetirement, readWatchStateAt, RetirementError, KIND_WATCH_STATE } from '../src/index.js';

const watch = generateSecretKey();
const watchPub = getPublicKey(watch);
const kite = generateSecretKey();
const kitePub = getPublicKey(kite);
const owl = generateSecretKey();
const T = 1_800_000_000;
const overRelay = (e: Event): Event => JSON.parse(JSON.stringify(e)) as Event;

describe('a watch key put out of use (SC3)', () => {
  it('reads as Dark to anybody, and names who retired it and why to a phone that knows them', () => {
    const e = overRelay(buildRetirement(watch, kite, { by: 'Kite', reason: 'Owl left the squad; new code from me tonight.' }, T));
    expect(e.pubkey).toBe(watchPub);
    expect(readWatchStateAt(e.content, { createdAt: e.created_at, now: T }).dark).toBe(true);
    expect(readRetirement(e, watchPub, [kitePub])).toEqual({ by: 'Kite', reason: 'Owl left the squad; new code from me tonight.', holder: kitePub, at: T });
  });

  it('is believed only from a holder this phone was told of: the one removed cannot retire it to send people elsewhere', () => {
    const e = overRelay(buildRetirement(watch, owl, { by: 'Owl', reason: 'moved' }, T));
    expect(readRetirement(e, watchPub, [kitePub])).toBeNull();
  });

  it('is believed only under the watch key, naming this watch', () => {
    const other = generateSecretKey();
    const e = overRelay(buildRetirement(other, kite, { by: 'Kite', reason: 'moved' }, T));
    expect(readRetirement(e, watchPub, [kitePub])).toBeNull();
    // A statement lifted from another watch's retirement into this one's state names the other watch.
    const lifted = JSON.parse(e.content) as { retired: Event };
    const forged = finalizeEvent({ kind: KIND_WATCH_STATE, created_at: T, tags: [], content: JSON.stringify({ state: 'dark', retired: lifted.retired }) }, watch);
    expect(readRetirement(overRelay(forged), watchPub, [kitePub])).toBeNull();
  });

  it('refuses a statement altered after it was signed', () => {
    const e = overRelay(buildRetirement(watch, kite, { by: 'Kite', reason: 'moved' }, T));
    const c = JSON.parse(e.content) as { retired: Event };
    c.retired.content = JSON.stringify({ by: 'Kite', reason: 'something else' });
    const resigned = finalizeEvent({ kind: KIND_WATCH_STATE, created_at: T, tags: [], content: JSON.stringify(c) }, watch);
    expect(readRetirement(overRelay(resigned), watchPub, [kitePub])).toBeNull();
  });

  it('needs a reason in the holder’s own words', () => {
    expect(() => buildRetirement(watch, kite, { by: 'Kite', reason: '  ' }, T)).toThrow(RetirementError);
  });

  it('an ordinary watch state carries none', () => {
    const plain = finalizeEvent({ kind: KIND_WATCH_STATE, created_at: T, tags: [], content: JSON.stringify({ v: 4, state: 'station' }) }, watch);
    expect(readRetirement(overRelay(plain), watchPub, [kitePub])).toBeNull();
  });
});
