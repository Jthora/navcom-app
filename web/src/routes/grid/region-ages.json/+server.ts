import { loadRegions, regionRecords } from '$lib/directory/load';
import { agesFileOf } from '$lib/grid/layers/ages';

export const prerender = true;

/**
 * When each directory record was last checked, for the map's directory-by-last-check overlay
 * [grid/layers/ages.ts; docs/design/map.md, The directory by last check].
 *
 * Dates, never ages: the phone reads each against its own clock, so the picture ages honestly between
 * deploys rather than freezing at the age it had the day this was built [invariant 7]. One index into a
 * short list of dates per record, in the order of its region's `console-index`, so a record's point on
 * the map and its place in Com read the same entry.
 *
 * Its own file rather than a field in `console-regions.json`, which every visit fetches as the page
 * mounts: this one is fetched only by somebody who shows the ages, and its line in
 * `scripts/lib/budget.mjs` counts it. Prerendered, so it is a static file, and not in the service
 * worker's install precache: cached on first use, as `places.json` is.
 */
export function GET() {
  const file = agesFileOf(loadRegions().map((r) => ({ region: r.slug, records: regionRecords(r.slug) })));
  return new Response(JSON.stringify(file), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}
