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

  // Every region gets an entry, not just the ones with records: found in robustness audit
  // that a region with zero rows was silently absent here entirely, contradicting this
  // function's own "computed once... for whichever region resolves to" premise. Concretely,
  // it made the root console's manual region picker omit all 35 of the 68 committed regions
  // that have no data yet -- the same regions CLAUDE.md's own "Current scope" already says
  // are deliberately prerendered "because until this they had no page at all." Started from
  // the full region list, not just `byRegion`'s keys, so a zero-record region still gets a
  // real (zero) entry; any record naming a region absent from that list still surfaces too,
  // under its own slug, same as before.
  const out: Record<string, ConsoleRegionFigures> = {};
  const slugs = new Set([...regions.map((r) => r.slug), ...byRegion.keys()]);
  for (const slug of slugs) {
    const f = byRegion.get(slug) ?? { records: 0, confirmedByPerson: 0, freshest: null };
    const region = regions.find((rg) => rg.slug === slug);
    out[slug] = { region: slug, name: region?.name ?? slug, languages: region?.languages ?? [], ...f };
  }
  return out;
}
