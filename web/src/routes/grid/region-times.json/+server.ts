import { loadRegions } from '$lib/directory/load';
import type { RegionTimes } from '$lib/grid/layers/timezones';

export const prerender = true;

/**
 * Each directory region's IANA time zone, for the map's Time zones layer [D8; grid/layers/timezones.ts].
 *
 * The bands Natural Earth draws are standard offsets, and a region's clocks are not: Birmingham is
 * UTC±0 in the bands and an hour ahead of it all summer. Each region's `region.json` already names its
 * zone, validated when it is read [core: directory/region.ts], so the phone can say what its clocks
 * show through `Intl`, daylight saving included.
 *
 * Its own file rather than a field in `console-regions.json`, which every visit fetches as the page
 * mounts: this one is fetched only by somebody who chooses Time zones, and its line in
 * `scripts/lib/budget.mjs` counts it. Region slugs and zone names, nothing about any record.
 */
export function GET() {
  const zones: string[] = [];
  const at = new Map<string, number>();
  const regions: Record<string, number> = {};
  for (const r of loadRegions()) {
    if (!at.has(r.timezone)) {
      at.set(r.timezone, zones.length);
      zones.push(r.timezone);
    }
    regions[r.slug] = at.get(r.timezone)!;
  }
  const file: RegionTimes = { v: 1, zones, regions };
  return new Response(JSON.stringify(file), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}
