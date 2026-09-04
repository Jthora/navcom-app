/**
 * Server-only, so the region and record globs never reach a browser.
 *
 * `regions.ts` and `load.ts` glob every `region.json` and every `resources.csv` **eagerly, at
 * module scope**, so a *universal* loader -- one that also runs in the browser -- pulls the
 * whole directory into the client bundle. At 68 regions that cost nothing. At 1,915 it is
 * 175 kB gzipped of county names on a page that needs one county, against a 220 kB budget
 * derived from four seconds on a congested cell.
 *
 * This is the same fix the region page took, and the reason that page survived the expansion
 * this one did not. The rule it enforces: **no client-side loader may call `loadRegions()` or
 * `loadDirectory()`.**
 */
import { loadAll } from '$lib/directory/load';


export const load = () => {
  const { records, regions } = loadAll();
  /*
   * Counts, not records. Shipping all 8,428 to render an index was 11 MB of HTML; the number
   * beside an area is the only thing this page needs from them.
   */
  const counts: Record<string, number> = {};
  for (const r of records) if (r.region) counts[r.region] = (counts[r.region] ?? 0) + 1;
  return {
    counts,
    realCount: records.filter((r) => !r.id.startsWith('EXAMPLE')).length,
    regions,
    // Fixed at build time. The site is static, so "now" is when it was published — and
    // that is stated on the page rather than implied, because every age shown is relative
    // to it.
    builtAt: new Date().toISOString()
  };
};
