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
import { US } from '$lib/components/missions/format';

/**
 * Two-letter codes the build's own tables name that are not a country: reserved, grouped or unknown.
 * Every other code `Intl` names is offered as a nation, so the list is the build's, never a phone's.
 */
const NOT_NATIONS = new Set(['AC', 'CP', 'CQ', 'DG', 'EA', 'EU', 'EZ', 'IC', 'QO', 'TA', 'UN', 'XA', 'XB', 'ZZ']);

function nations(): { code: string; name: string }[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_NATIONS.has(code)) continue;
      const name = names.of(code);
      if (name && name !== code) out.push({ code: code.toLowerCase(), name });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * The states and provinces a card may name, by ISO 3166-2 code: those of the countries the directory
 * has regions in. Elsewhere a card names its nation, rather than a code this build has no name for.
 */
const GB: Record<string, string> = { eng: 'England', sct: 'Scotland', wls: 'Wales', nir: 'Northern Ireland' };
const AU: Record<string, string> = {
  nsw: 'New South Wales', vic: 'Victoria', qld: 'Queensland', wa: 'Western Australia',
  sa: 'South Australia', tas: 'Tasmania', act: 'Australian Capital Territory', nt: 'Northern Territory'
};
function provinces(): { code: string; name: string; country: string }[] {
  const of = (country: string, table: Record<string, string>) =>
    Object.entries(table)
      .map(([k, name]) => ({ code: `${country.toLowerCase()}-${k}`, name, country }))
      .sort((x, y) => x.name.localeCompare(y.name));
  return [...of('US', US), ...of('GB', GB), ...of('AU', AU)];
}

export const prerender = true;

export function load() {
  return {
    regions: loadRegions()
      .map((r) => ({ slug: r.slug, name: r.name, country: r.country }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    nations: nations(),
    provinces: provinces()
  };
}
