/**
 * One region's public listing.
 *
 * The level that was missing. `/directory/` rendered **every** record in the country onto one
 * page: at 8,428 records that was 11 MB of raw HTML and 350 kB gzipped, against a 250 kB
 * budget — a page nobody on a slow connection could open, listing places for people whose
 * connections are the worst.
 *
 * So the index lists regions, and this lists a region's records. The same shape the field
 * terminal has had since it split, and the same reason: an operator is in one place, and a
 * person looking for a bed tonight is in one place too.
 *
 * Server-only, so the eager globs in `load.ts` never reach a browser.
 *
 * ## Why `/directory/area/<slug>/` and not `/directory/<slug>/`
 *
 * `/directory/<id>/` already exists and is one dynamic segment, so a sibling `/directory/
 * <region>/` is ambiguous -- SvelteKit refuses it, and rightly: nothing in the path says
 * whether `seattle` is a record or an area.
 *
 * The record path is the one that must not move. Those URLs are already public, and this
 * project keeps a document about link rot and archives other people's squatted domains; it
 * does not get to break its own links for tidiness. So the new level takes the new path.
 */
import { error } from '@sveltejs/kit';
import { loadDirectory, loadRegions } from '$lib/directory/load';

export const prerender = true;

export function entries() {
  return loadRegions().map((r) => ({ region: r.slug }));
}

export function load({ params }: { params: { region: string } }) {
  const region = loadRegions().find((r) => r.slug === params.region);
  if (!region) error(404, 'No such area');
  return {
    region,
    records: loadDirectory().filter((r) => r.region === params.region),
    builtAt: new Date().toISOString()
  };
}
