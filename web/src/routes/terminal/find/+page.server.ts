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
/**
 * The regions a card may name.
 *
 * Borrowed from the directory rather than invented, so there is one coarse place-taxonomy
 * in this app and no finer one to be tempted by. A card names a metro; there is nothing
 * smaller it could name.
 */

import { loadRegions } from '$lib/directory/regions';

export const prerender = true;

export function load() {
  return {
    regions: loadRegions()
      .map((r) => ({ slug: r.slug, name: r.name, country: r.country }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}
