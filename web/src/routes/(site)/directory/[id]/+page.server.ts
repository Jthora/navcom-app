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
import { error } from '@sveltejs/kit';
import { loadDirectory, regionOf } from '$lib/directory/load';


/** Tells the prerenderer which detail pages exist. */
export const entries = () => loadDirectory().map((r) => ({ id: r.id }));

export const load = ({ params }) => {
  const id = params.id.replace(/\/+$/, '');
  const record = loadDirectory().find((r) => r.id === id);
  if (!record) throw error(404, 'No such entry');
  return { record, region: regionOf(record) ?? null, builtAt: new Date().toISOString() };
};
