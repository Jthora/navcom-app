/**
 * The list of cards navcom.app will not display, as data.
 *
 * Expected to be empty, so most of these pass vacuously today. They are here for the day an
 * entry is added under pressure -- a notice arrived, somebody is upset -- which is exactly when
 * a free-text reason gets typed and a date gets guessed.
 */

import { describe, expect, it } from 'vitest';
import { HIDDEN, hiddenOn, isHidden } from './hidden';

const REAL_DATE = (iso: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
};

describe('the cards navcom.app will not display', () => {
  it('names each one by the key that signed it', () => {
    for (const h of HIDDEN) expect(h.key, 'a contact key is 64 lowercase hex').toMatch(/^[0-9a-f]{64}$/);
  });

  it('says why only by category, never in words', () => {
    // A written reason is an accusation about a pseudonymous person, published by the one
    // party who cannot check it. There is nowhere in an entry to put one.
    for (const h of HIDDEN) {
      expect(Object.keys(h).sort()).toEqual(['because', 'key', 'on']);
      expect(['legal-notice', 'unlawful']).toContain(h.because);
    }
  });

  it('dates every decision with a real date that has already happened', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const h of HIDDEN) {
      expect(REAL_DATE(h.on), `${h.on} is not a date`).toBe(true);
      expect(h.on <= today, `${h.on} is in the future`).toBe(true);
    }
  });

  it('holds each key once', () => {
    const keys = HIDDEN.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('answers for the keys it holds and nothing else', () => {
    for (const h of HIDDEN) {
      expect(isHidden(h.key)).toBe(true);
      expect(hiddenOn(h.key)).toBe(h.on);
    }
    const absent = 'f'.repeat(64);
    if (!HIDDEN.some((h) => h.key === absent)) {
      expect(isHidden(absent)).toBe(false);
      expect(hiddenOn(absent)).toBeNull();
    }
    expect(isHidden('not a key')).toBe(false);
  });
});
