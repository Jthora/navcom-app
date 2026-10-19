/**
 * The cliff, measured.
 *
 * A volatile field stops showing at `window - margin`, so when the newest check in the directory
 * crosses that line **every** volatile value on every page goes dark at once — and nothing about any
 * page looks broken while it does. It happened, and what found it was a silence guard going red at
 * one minute past midnight. These are the assertions that would have found it a week earlier.
 */

import { describe, expect, it } from 'vitest';
import { STALE_AFTER_DAYS, STALENESS_MARGIN_DAYS, confidenceForField, displayField, freshness, readingOf } from '../src/index.js';
import type { ResourceRecord } from '../src/directory/types.js';

const TODAY = '2026-10-05';
/** An ISO date `n` days before TODAY. */
const ago = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const tier = (f: ReturnType<typeof freshness>, cls: string) => f.tiers.find((t) => t.cls === cls)!;

describe('a directory with nothing checked', () => {
  it('is dark rather than undefined, because a page has nothing to show either way', () => {
    const f = freshness([], TODAY);
    expect(f.newest).toBeNull();
    expect(f.newestAgeDays).toBeNull();
    expect(f.volatileDark).toBe(true);
    expect(tier(f, 'volatile').checked).toBe(0);
  });
});

describe('the volatile cliff', () => {
  const usable = STALE_AFTER_DAYS.volatile - STALENESS_MARGIN_DAYS;

  it('still shows on the last day it can', () => {
    const f = freshness([ago(usable)], TODAY);
    expect(tier(f, 'volatile').showing).toBe(1);
    expect(tier(f, 'volatile').left).toBe(0);
    expect(f.volatileDark).toBe(false);
  });

  it('goes dark the day after, and says how long it has been dark', () => {
    const f = freshness([ago(usable + 1)], TODAY);
    expect(tier(f, 'volatile').showing).toBe(0);
    expect(tier(f, 'volatile').left).toBe(-1);
    expect(f.volatileDark).toBe(true);
  });

  it('counts only the records that still show, not the ones that were ever checked', () => {
    const f = freshness([ago(1), ago(2), ago(60), ago(90)], TODAY);
    expect(tier(f, 'volatile').showing).toBe(2);
    expect(tier(f, 'volatile').checked).toBe(4);
  });
});

describe('the tiers do not move together', () => {
  it('leaves the slower classes showing while volatile is dark, which is the ordinary state', () => {
    // The directory as it actually stands: a month since anybody rang a shelter, so hours are gone
    // and the address is not.
    const f = freshness([ago(33)], TODAY);
    expect(f.volatileDark).toBe(true);
    expect(tier(f, 'seasonal').showing).toBe(0);
    expect(tier(f, 'slow').showing).toBe(1);
    expect(tier(f, 'static').showing).toBe(1);
  });

  it('reports the newest check and its age, because the fix is somebody ringing a place', () => {
    const f = freshness([ago(40), ago(33), ago(99)], TODAY);
    expect(f.newest).toBe(ago(33));
    expect(f.newestAgeDays).toBe(33);
  });
});

describe('data a volunteer typed', () => {
  it('drops what is not a date rather than poisoning the measurement', () => {
    const f = freshness(['', 'soon', '2026-13-45', ago(2), '  ' + ago(3) + '  '], TODAY);
    expect(tier(f, 'volatile').checked).toBe(2);
    expect(tier(f, 'volatile').showing).toBe(2);
  });

  it('never throws, whatever is in the column', () => {
    expect(() => freshness(['0000-00-00', '2026-02-30', 'null'], TODAY)).not.toThrow();
  });
});

describe('one record’s check, read the way its page reads it', () => {
  /*
   * The map shades the directory by when it was checked [web: grid/layers/ages.ts], by the age of the
   * check alone. The ages it names turn on the same days a page's fields do, so the reading is held to
   * the page's own windows, for a record that has the fields: hours (volatile) for `current`, intake
   * rules (slow) for `stale`. Whether a record has hours at all is not the reading's to say, and the map
   * names no field for it.
   */
  const NOW = new Date(`${TODAY}T12:00:00Z`);
  const record = (last_verified: string) =>
    ({
      id: 'r1', name: 'S', type: 'meal', region: 'x', hours: '09:00-17:00', accepts: ['adults'],
      flag: 'ok', verified_by: 'a website', method: 'website', last_verified
    }) as unknown as ResourceRecord;

  it('turns at the same days the page does: hours at two weeks, intake rules at three months', () => {
    expect(readingOf(ago(0), NOW)).toBe('current');
    expect(readingOf(ago(13), NOW)).toBe('current');
    expect(readingOf(ago(14), NOW)).toBe('hours');
    expect(readingOf(ago(89), NOW)).toBe('hours');
    expect(readingOf(ago(90), NOW)).toBe('stale');
    expect(readingOf(ago(400), NOW)).toBe('stale');
  });

  it('agrees with the page, field by field, on every day of a year', () => {
    for (let n = -1; n <= 366; n++) {
      const r = record(ago(n));
      const reading = readingOf(ago(n), NOW);
      expect(reading === 'current', `day ${n}: hours shown`).toBe(displayField(r, 'hours', NOW).kind === 'value');
      expect(reading === 'stale', `day ${n}: intake rules stale`).toBe(confidenceForField(r, 'accepts', NOW) === 'stale');
    }
  });

  it('is unknown when there is no date to read, and never current', () => {
    for (const d of [undefined, null, '', 'not-a-date', '2026-13-45']) expect(readingOf(d, NOW), String(d)).toBe('unknown');
    // A date in this phone's future is a wrong clock somewhere: cautious, as the page is.
    expect(readingOf('2099-01-01', NOW)).toBe('stale');
  });
});
