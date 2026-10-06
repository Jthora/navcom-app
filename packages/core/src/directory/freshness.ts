/**
 * How much of this directory still answers the question it exists to answer.
 *
 * A volatile field — opening hours, intake hours — stops showing once its check date passes
 * `window - margin`, and a suppressed field reads *"call first"*. That is the design working. It is
 * also a **cliff**: when the newest check in the whole directory crosses fourteen days, every
 * volatile value on every page goes dark at once, and nothing about the page looks broken while it
 * happens.
 *
 * ## Why this is here rather than in the script that printed it
 *
 * `check-data.ts` has measured this since the day the cliff was first hit. The **status page**, whose
 * entire job is saying what is true about this deployment, said nothing about it — so the fact lived
 * in a build log a maintainer reads and not on the page a reader opens. Two implementations of one
 * measurement would be the usual next mistake, so there is one, and both callers use it.
 *
 * Counting records is fine here and is not the counting C20 refuses: that rule is about tallies of
 * somebody's work inviting gaming. This is a measurement of a dataset's age, which is the same thing
 * invariant 9 already demands of every field on every page, asked of the whole directory at once.
 */

import { STALE_AFTER_DAYS, STALENESS_MARGIN_DAYS } from './volatility.js';
import type { VolatilityClass } from './types.js';

export interface TierFreshness {
  cls: VolatilityClass;
  /** The window this class is suppressed after, from `STALE_AFTER_DAYS`. */
  windowDays: number;
  /** The age at which a value stops showing — the window less the margin. */
  usableDays: number;
  /** Records whose check date is recent enough that a value still shows. */
  showing: number;
  /** Records carrying a check date at all. */
  checked: number;
  /** Days until nothing in this class shows. Negative is how long nothing has. */
  left: number;
}

export interface Freshness {
  /** The most recent check date anywhere in the directory, ISO, or null if none carries one. */
  newest: string | null;
  /** How old that check is, in days. */
  newestAgeDays: number | null;
  tiers: TierFreshness[];
  /** Whether every volatile value in the directory is currently suppressed. */
  volatileDark: boolean;
}

const DAY = 86_400_000;

/** Whole days between two ISO dates, floored, in UTC so a timezone cannot move the cliff. */
function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/**
 * Measures the directory from its check dates. One date per record, `today` as ISO.
 *
 * Never throws: a malformed date is dropped rather than poisoning the measurement, because this runs
 * on data a volunteer typed and a page that cannot render is worse than one that counts slightly
 * fewer records.
 */
export function freshness(checkDates: readonly string[], today: string): Freshness {
  const checked = checkDates
    .map((d) => d.trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`)))
    .sort();
  const newest = checked.length > 0 ? checked[checked.length - 1]! : null;

  const tiers: TierFreshness[] = Object.entries(STALE_AFTER_DAYS).map(([cls, windowDays]) => {
    const usableDays = windowDays - STALENESS_MARGIN_DAYS;
    const showing = checked.filter((d) => daysBetween(d, today) <= usableDays).length;
    return {
      cls: cls as VolatilityClass,
      windowDays,
      usableDays,
      showing,
      checked: checked.length,
      left: newest === null ? 0 : usableDays - daysBetween(newest, today)
    };
  });

  return {
    newest,
    newestAgeDays: newest === null ? null : daysBetween(newest, today),
    tiers,
    // Nothing checked at all is also dark, and reads the same way on a page: no value to show.
    volatileDark: (tiers.find((t) => t.cls === 'volatile')?.showing ?? 0) === 0
  };
}
