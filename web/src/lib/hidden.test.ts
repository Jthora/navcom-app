/**
 * The list of cards navcom.app will not display, as data — and the windows that stop it
 * becoming a quiet, permanent lever.
 *
 * Expected to be empty, so the data checks pass vacuously today. They are here for the day an
 * entry is added under pressure -- a notice arrived, somebody is upset -- which is exactly when
 * a free-text reason gets typed, an accusing label gets reached for, and a date gets guessed.
 * The window rules are tested on synthetic entries, so they are exercised whether or not the
 * list is empty.
 */

import { describe, expect, it } from 'vitest';
import {
  HIDDEN,
  REVIEW_AFTER_DAYS,
  hiddenOn,
  isExpired,
  isHidden,
  stillHides,
  type HiddenBecause,
  type HiddenCard
} from './hidden';

const REAL_DATE = (iso: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
};

describe('the cards navcom.app will not display', () => {
  it('names each one by the key that signed it', () => {
    for (const h of HIDDEN) expect(h.key, 'a contact key is 64 lowercase hex').toMatch(/^[0-9a-f]{64}$/);
  });

  it('records only the state of a decision, never what anybody did', () => {
    // Public and permanent in git history. A reason in words, or a label like "unlawful",
    // would be an accusation about a pseudonymous person by the one party who cannot check it.
    expect(Object.keys(REVIEW_AFTER_DAYS).sort()).toEqual(['confirmed', 'provisional']);
    for (const h of HIDDEN) {
      expect(Object.keys(h).sort()).toEqual(['because', 'key', 'on']);
      expect(Object.keys(REVIEW_AFTER_DAYS)).toContain(h.because);
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

  it('has no entry past its window, so a person must look again before anything ships', () => {
    // The alarm. A confirmed hide past 90 days, or a provisional one past 14, refuses the
    // build until somebody re-dates it or removes it.
    const late = HIDDEN.filter((h) => isExpired(h)).map((h) => `${h.key.slice(0, 16)} ${h.because} ${h.on}`);
    expect(late, 're-date each entry that still holds, and remove the rest').toEqual([]);
  });

  it('answers for the keys it holds and nothing else', () => {
    for (const h of HIDDEN) {
      expect(isHidden(h.key)).toBe(stillHides(h));
      expect(hiddenOn(h.key)).toBe(stillHides(h) ? h.on : null);
    }
    const absent = 'f'.repeat(64);
    if (!HIDDEN.some((h) => h.key === absent)) {
      expect(isHidden(absent)).toBe(false);
      expect(hiddenOn(absent)).toBeNull();
    }
    expect(isHidden('not a key')).toBe(false);
  });
});

describe('nothing on the list is permanent', () => {
  const entry = (because: HiddenBecause, on: string): HiddenCard => ({ key: 'a'.repeat(64), because, on });
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it('gives a provisional hide a fortnight and a confirmed one ninety days', () => {
    expect(REVIEW_AFTER_DAYS.provisional).toBe(14);
    expect(REVIEW_AFTER_DAYS.confirmed).toBe(90);
  });

  it('lets a provisional hide lapse on its own once its fortnight is over', () => {
    const e = entry('provisional', '2026-09-01');
    expect(isExpired(e, at('2026-09-15'))).toBe(false);
    expect(stillHides(e, at('2026-09-15'))).toBe(true);
    expect(isExpired(e, at('2026-09-16'))).toBe(true);
    // A flood of bogus notices buys a fortnight, not a silence.
    expect(stillHides(e, at('2026-09-16'))).toBe(false);
  });

  it('keeps a confirmed hide in place past its window, and lets the build be the alarm', () => {
    const e = entry('confirmed', '2026-06-01');
    expect(isExpired(e, at('2026-08-30'))).toBe(false);
    expect(isExpired(e, at('2026-08-31'))).toBe(true);
    // A real notice's card must not reappear because the maintainer was away.
    expect(stillHides(e, at('2026-08-31'))).toBe(true);
  });
});
