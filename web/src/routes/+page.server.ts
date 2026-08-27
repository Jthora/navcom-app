/**
 * What the root console needs, computed once at build time.
 *
 * Three things, all derived from the same directory the site and the terminal already load
 * [`$lib/directory/load`] — nothing fabricated, nothing asserted twice:
 *
 * - A slim search index. Not `directory.json`'s full per-record export (that carries a
 *   computed field verdict per record, which is what makes it heavy) — just enough to search
 *   and link onward to the existing `/terminal/directory/[region]/` page, which already
 *   renders full record detail correctly.
 * - The coverage aggregate `status/+page.server.ts` already computes: record count, regions
 *   with data, and the single freshest `last_verified` date across all of them.
 * - A per-region centroid, derived from the mean of that region's own geotagged records
 *   rather than hand-curated: 467 of 479 records already carry real `lat`/`lon`, so nothing
 *   new needs sourcing or maintaining. Only regions that actually have a geotagged record are
 *   included — an empty seeded region should never win "nearest".
 */

import { loadDirectory, loadRegions, regionOf } from '$lib/directory/load';
import type { ConsoleIndexEntry, ConsoleCentroid } from '$lib/console/types';

export const prerender = true;

export function load() {
  const records = loadDirectory();
  const regions = loadRegions();

  const index: ConsoleIndexEntry[] = records.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    region: r.region ?? '',
    regionName: regionOf(r)?.name ?? r.region ?? ''
  }));

  const regionsWithData = new Set(records.map((r) => r.region)).size;

  // ISO dates (YYYY-MM-DD) sort lexicographically the same as chronologically, so the max
  // string is the freshest date without parsing anything.
  let freshest: string | null = null;
  for (const r of records) {
    if (r.last_verified && (!freshest || r.last_verified > freshest)) freshest = r.last_verified;
  }

  const sums = new Map<string, { lat: number; lon: number; n: number }>();
  for (const r of records) {
    if (r.lat === undefined || r.lon === undefined || !r.region) continue;
    const s = sums.get(r.region) ?? { lat: 0, lon: 0, n: 0 };
    s.lat += r.lat;
    s.lon += r.lon;
    s.n += 1;
    sums.set(r.region, s);
  }
  const centroids: ConsoleCentroid[] = [...sums.entries()].map(([slug, s]) => ({
    region: slug,
    name: regions.find((r) => r.slug === slug)?.name ?? slug,
    lat: s.lat / s.n,
    lon: s.lon / s.n
  }));

  return {
    index,
    coverage: {
      records: records.length,
      regionsWithData,
      regionsTotal: regions.length,
      freshest
    },
    centroids
  };
}
