/**
 * Region figures and centroids, fetched rather than embedded.
 *
 * The console needs three things about regions, and they are needed at different moments:
 *
 * - **slug and name**, to search on the first keystroke. Those stay in the page.
 * - **a centroid**, to work out which region is nearest. Not needed until a location fix
 *   comes back, which takes longer than this fetch.
 * - **figures** — how many records, how fresh, how many a person confirmed — needed only once
 *   a region is focused.
 *
 * At 68 regions all three were embedded and cost nothing. At 1,912 they were 402 kB of inline
 * data, a 160.9 kB page against a 120 kB budget. Splitting on *when it is needed* rather than
 * trimming fields is what actually fits: the fields were never the weight, the count was.
 *
 * Prerendered, so this is a static file on a CDN and the service worker can keep it.
 */
import { loadDirectory, loadRegions } from '$lib/directory/load';
import { regionFigures } from '$lib/console/figures';

export const prerender = true;

export function GET() {
  const records = loadDirectory();
  const regions = loadRegions();

  const sums = new Map<string, { lat: number; lon: number; n: number }>();
  for (const r of records) {
    if (r.lat === undefined || r.lon === undefined || !r.region) continue;
    const s = sums.get(r.region) ?? { lat: 0, lon: 0, n: 0 };
    s.lat += r.lat; s.lon += r.lon; s.n += 1;
    sums.set(r.region, s);
  }
  const byRegion = new Map(regions.map((r) => [r.slug, r.name]));
  const centroids = [...sums.entries()].map(([slug, s]) => ({
    region: slug,
    name: byRegion.get(slug) ?? slug,
    lat: s.lat / s.n,
    lon: s.lon / s.n
  }));

  return new Response(JSON.stringify({ centroids, figures: regionFigures(records, regions) }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}
