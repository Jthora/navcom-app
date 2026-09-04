/**
 * What the root console needs, computed once at build time.
 *
 * Three things, all derived from the same directory the site and the terminal already load
 * [`$lib/directory/load`] — nothing fabricated, nothing asserted twice:
 *
 * - Every region, with its figures. This is the whole embedded index: a few kilobytes that
 *   do not grow as the directory does. Records are **not** here — one region's are fetched
 *   from `/console-index/<region>.json` once the nearest is known.
 * - The coverage aggregate `status/+page.server.ts` already computes: record count, regions
 *   with data, and the single freshest `last_verified` date across all of them.
 * - A per-region centroid, derived from the mean of that region's own geotagged records
 *   rather than hand-curated: 467 of 479 records already carry real `lat`/`lon`, so nothing
 *   new needs sourcing or maintaining. Only regions that actually have a geotagged record are
 *   included — an empty seeded region should never win "nearest".
 * - Per-region figures, precomputed for every region and looked up client-side by whichever
 *   one search or geolocation resolves to — same pattern as the centroids. `confirmedByPerson`
 *   reuses `isSeeded()`, matching `BROADCAST.measure`'s own published definition
 *   (`packages/core/src/refusals.ts`) rather than a second, invented metric.
 */

import { loadDirectory, loadRegions } from '$lib/directory/load';

export const prerender = true;

export function load() {
  const records = loadDirectory();
  const regions = loadRegions();

  /*
   * No record index here any more.
   *
   * Every record used to be embedded so the search worked with no fetch at all. At 1,405
   * records that was 27.9 kB gzipped and a 94 kB page against a 120 kB budget, with a ceiling
   * near 4,600 however the fields were trimmed -- and national coverage needs 10,000 or more.
   *
   * The regions below are the whole embedded index now. One region's records are fetched from
   * `/console-index/<region>.json` once the nearest is known, so **this page stops growing as
   * the directory does**. See `delivery.md` for the three trimming attempts that ruled out
   * doing it any other way.
   */
  const regionsWithData = new Set(records.map((r) => r.region)).size;

  // ISO dates (YYYY-MM-DD) sort lexicographically the same as chronologically, so the max
  // string is the freshest date without parsing anything.
  let freshest: string | null = null;
  for (const r of records) {
    if (r.last_verified && (!freshest || r.last_verified > freshest)) freshest = r.last_verified;
  }


  return {
    coverage: {
      records: records.length,
      regionsWithData,
      regionsTotal: regions.length,
      freshest
    },
    /*
     * Slug and name only -- what a search needs on the first keystroke.
     *
     * Centroids and figures moved to `/console-regions.json`, fetched on mount. At 1,912
     * regions they were 402 kB of inline data on a page with a 120 kB budget, and neither is
     * needed until a location fix returns or a region is focused. Splitting on *when it is
     * needed* is what fits; trimming their fields saved 2 kB of 41.
     */
    regionList: regions.map((r) => [r.slug, r.name] as [string, string])
  };
}
