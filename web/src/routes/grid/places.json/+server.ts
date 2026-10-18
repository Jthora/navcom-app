import { loadRegions, regionRecords } from '$lib/directory/load';
import { placesFileOf } from '$lib/grid/places';

export const prerender = true;

/**
 * Every record the map draws, per region, as `[lon, lat]` in the order of that region's
 * `console-index`, with `null` for each record it does not [grid/places.ts].
 *
 * One file for the whole directory, fetched whole when somebody switches Places on and never by
 * what is on screen: a file per area of the map would tell the host which part of the Earth
 * somebody looked at, which is the leak map.md §2 and grid.md §1 were written to prevent. Measured
 * at about 64 KB gzipped (2026-10-18), and paid only by somebody who asks for it.
 *
 * Prerendered, so it is a static file on a CDN; not in the service worker's install precache,
 * so it is cached on first use, like `console-index`.
 */
export function GET() {
  const file = placesFileOf(loadRegions().map((r) => ({ region: r.slug, records: regionRecords(r.slug) })));
  return new Response(JSON.stringify(file), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}
