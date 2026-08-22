/**
 * An operator's own notes on a place.
 *
 * Wipeable tier: these are tonight's observations about a doorway, and a panic wipe exists to
 * destroy exactly that [invariant 7].
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { clearNote, keepNote, noteFor } from './notes';
import { panicWipe, get } from './storage';

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
});

describe('a note about a place', () => {
  it('comes back for the record it was written about', () => {
    keepNote('st-louis-0001', 'side door after 9, ring twice');
    expect(noteFor('st-louis-0001')).toBe('side door after 9, ring twice');
  });

  it('is not returned for a different record', () => {
    keepNote('st-louis-0001', 'side door');
    expect(noteFor('st-louis-0002')).toBeNull();
  });

  it('clears, and clearing means gone rather than blank-looking', () => {
    // Nothing verified this. A note that reads as empty while still being stored is the
    // difference between an operator believing they removed something and having done so.
    keepNote('st-louis-0001', 'do not go alone');
    clearNote('st-louis-0001');
    expect(noteFor('st-louis-0001')).toBeNull();

    const all = get<Record<string, string>>('wipeable', 'notes') ?? {};
    expect(Object.values(all)).not.toContain('do not go alone');
  });

  it('is destroyed by a panic wipe [invariant 7]', () => {
    // These are observations about a doorway made tonight, which is precisely what a wipe is
    // for. If notes lived in the accruing tier they would survive one.
    keepNote('st-louis-0001', 'the man on the desk asks for ID');
    panicWipe();
    expect(noteFor('st-louis-0001')).toBeNull();
  });

  it('replaces rather than appends when written again', () => {
    keepNote('st-louis-0001', 'first');
    keepNote('st-louis-0001', 'second');
    expect(noteFor('st-louis-0001')).toBe('second');
  });
});
