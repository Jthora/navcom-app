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
