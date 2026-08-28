/**
 * What's true about a region's own slice of the directory, computed once and looked up by
 * whichever region search or geolocation resolves to — the same precompute-then-lookup shape
 * already used for centroids in `routes/+page.server.ts`.
 *
 * Deliberately carries directory facts only. There is no field anywhere that ties a
 * Watchtower to a region, and there should not be one [docs/spec/bootstrap.spec.md: "a list
 * of Watchtowers is a list of where operators are"] — so this function must never grow a
 * watch/coverage concept, only ever count records.
 */
import { isSeeded } from '@navcom/core';
import type { Region, ResourceRecord } from '@navcom/core';
import type { ConsoleRegionFigures } from './types';

export function regionFigures(
  records: ResourceRecord[],
  regions: Region[]
): Record<string, ConsoleRegionFigures> {
  const byRegion = new Map<
    string,
    { records: number; confirmedByPerson: number; freshest: string | null }
  >();

  for (const r of records) {
    if (!r.region) continue;
    const f = byRegion.get(r.region) ?? { records: 0, confirmedByPerson: 0, freshest: null };
    f.records += 1;
    // Matches BROADCAST.measure (packages/core/src/refusals.ts): verified_by set, a real
    // method, and not a scraped/secondhand record.
    if (r.verified_by && r.method && !isSeeded(r)) f.confirmedByPerson += 1;
    if (r.last_verified && (!f.freshest || r.last_verified > f.freshest)) f.freshest = r.last_verified;
    byRegion.set(r.region, f);
  }

  const out: Record<string, ConsoleRegionFigures> = {};
  for (const [slug, f] of byRegion) {
    const region = regions.find((rg) => rg.slug === slug);
    out[slug] = { region: slug, name: region?.name ?? slug, languages: region?.languages ?? [], ...f };
  }
  return out;
}
