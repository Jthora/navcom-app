/**
 * A real calendar date, not just YYYY-MM-DD shape.
 *
 * Found by robustness audit: a shape-only regex, duplicated across three files, let
 * "2023-02-29" and "2024-04-31" through, and Date.parse silently rolled both over to the
 * following day rather than rejecting what an operator actually typed.
 */

import { describe, expect, it } from 'vitest';
import { isValidIsoDate } from '../src/directory/iso-date.js';

describe('isValidIsoDate', () => {
  it('accepts a real date', () => {
    expect(isValidIsoDate('2026-08-19')).toBe(true);
  });

  it('accepts a real leap day', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects a leap day in a non-leap year', () => {
    expect(isValidIsoDate('2023-02-29')).toBe(false);
  });

  it('rejects a day that does not exist in a 30-day month', () => {
    expect(isValidIsoDate('2024-04-31')).toBe(false);
  });

  it('rejects month 00 and month 13', () => {
    expect(isValidIsoDate('2026-00-15')).toBe(false);
    expect(isValidIsoDate('2026-13-15')).toBe(false);
  });

  it('rejects day 00', () => {
    expect(isValidIsoDate('2026-08-00')).toBe(false);
  });

  it('rejects anything not shaped like YYYY-MM-DD', () => {
    for (const bad of ['', 'not a date', '2026-8-19', '08-19-2026', '2026/08/19', '2026-08-19T00:00:00Z']) {
      expect(isValidIsoDate(bad), bad).toBe(false);
    }
  });
});
