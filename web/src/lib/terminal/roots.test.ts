/**
 * The device's own record of what the watch claimed.
 *
 * Kind 10910 is replaceable, so without this the watch is the only party holding the
 * evidence about its own log. These assertions are about that custody, not about the maths
 * -- the proof logic is tested in core.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { LogRoot } from '@navcom/core';
import { recordRoot, rootAlarms, seenRoots } from './roots';
import { burn, panicWipe, set } from './storage';

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null
  };
}

const at = (size: number, root: string): LogRoot => ({ root, size, at: 0 });

beforeEach(installLocalStorage);

describe('custody of the evidence', () => {
  it('keeps what the watch published across reads', () => {
    recordRoot(at(3, 'aaa'));
    recordRoot(at(7, 'bbb'));
    expect(seenRoots().map((r) => r.size)).toEqual([3, 7]);
  });

  it('does not throw on a schema-drifted stored value, and treats it as no roots seen (found in robustness audit)', () => {
    // An entry written by an older schema (or otherwise not shaped like a LogRoot) used to
    // reach observeRoot()'s own `.at(-1)` and throw, silently breaking the one mechanism
    // that lets an operator catch a rewritten history -- forever, with nothing surfaced.
    set('accruing', 'seen_roots', { legacy: true });
    expect(() => seenRoots()).not.toThrow();
    expect(seenRoots()).toEqual([]);
    expect(() => recordRoot(at(3, 'aaa'))).not.toThrow();
    expect(seenRoots().map((r) => r.size)).toEqual([3]);
  });

  it('drops only the malformed entries in an otherwise-real array, keeping the rest', () => {
    set('accruing', 'seen_roots', [at(3, 'aaa'), { root: 'bad' }, at(7, 'bbb')]);
    expect(seenRoots().map((r) => r.size)).toEqual([3, 7]);
  });

  it('records a contradiction and never clears it', () => {
    recordRoot(at(3, 'aaa'));
    recordRoot(at(9, 'bbb'));
    expect(recordRoot(at(3, 'ccc'))?.kind).toBe('diverged');

    // Still there after any number of ordinary, honest observations.
    for (let n = 10; n < 40; n++) recordRoot(at(n, `root-${n}`));
    expect(rootAlarms()).toHaveLength(1);
    expect(rootAlarms()[0]!.kind).toBe('diverged');
  });

  it('survives a panic wipe', () => {
    // The accruing tier, deliberately. A hash says nothing about where anyone was, and a
    // record of what the watch claimed last month is worth more the longer it goes back.
    recordRoot(at(3, 'aaa'));
    recordRoot(at(9, 'bbb'));
    recordRoot(at(3, 'ccc'));

    panicWipe();
    expect(seenRoots()).toHaveLength(3);
    expect(rootAlarms()).toHaveLength(1);
  });

  it('is destroyed by a burn, like everything else on the device', () => {
    recordRoot(at(3, 'aaa'));
    burn();
    expect(seenRoots()).toEqual([]);
    expect(rootAlarms()).toEqual([]);
  });

  it('does not grow without bound as the watch heartbeats', () => {
    for (let i = 0; i < 300; i++) recordRoot(at(5, 'steady'));
    expect(seenRoots()).toHaveLength(1);
  });
});
