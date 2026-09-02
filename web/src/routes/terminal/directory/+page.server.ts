/**
 * Which area's directory to carry.
 *
 * An operator works in one place. Offering all of them at once is both useless to them and
 * more than a prepaid phone should be asked to cache.
 *
 * A server loader rather than a universal one: this needs a count per region, which means
 * reading every record, and a universal loader would ship all of them to the browser to
 * produce sixty-eight integers.
 */

import { loadDirectory, loadRegions } from '$lib/directory/load';

export const prerender = true;

export function load() {
  const counts = new Map<string, number>();
  for (const r of loadDirectory()) {
    if (r.region) counts.set(r.region, (counts.get(r.region) ?? 0) + 1);
  }

  return {
    /*
     * Every region, and the empty ones are listed rather than hidden.
     *
     * They used to be filtered out, because "a region with nothing in it has nothing to offer
     * offline, and listing it would promise a fallback that is an empty page." That reasoning
     * held exactly until an operator could add a place. Now hiding them means the person who
     * knows a city is the one person who cannot find it, and the count beside each name says
     * plainly what is there — which is the honest version of the same concern.
     */
    areas: loadRegions()
      .map((region) => ({ region, records: counts.get(region.slug) ?? 0 }))
      .sort((a, b) => a.region.name.localeCompare(b.region.name))
  };
}
