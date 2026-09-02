/**
 * Region manifests, and nothing else.
 *
 * Split out of `load.ts` because that module globs every `resources.csv` **eagerly, at module
 * scope**. Importing anything from it — a region name, a label table — pulls the entire
 * directory into the importing page's bundle, and Vite has no way to tree-shake a glob whose
 * side effect is the import itself.
 *
 * That was costing real bytes on the two pages least able to afford them. `terminal/find`
 * asked for a list of region names and shipped all 507 shelter records to render it: 41 kB
 * gzipped of addresses and phone numbers, on the heaviest page in the app, none of it read.
 * `terminal/card` did the same. Neither page displays a record.
 *
 * So: **anything that needs only regions imports this file, and only this file.** `load.ts`
 * builds on it rather than repeating it, so there is one definition of what a published
 * region is and no way for the two to drift.
 */

import { parseRegion, type Region } from '@navcom/core';

const regionFiles = import.meta.glob('../../../../data/regions/*/region.json', {
  eager: true
}) as Record<string, { default: unknown }>;

export const slugOf = (path: string): string =>
  path.replace(/.*\/regions\/([^/]+)\/.*/, '$1');

/**
 * Folders starting with `_` are scaffolding, not regions — `_template` exists to be copied
 * and its manifest is deliberately invalid so nobody ships it unedited.
 */
const isRegion = (path: string): boolean => !slugOf(path).startsWith('_');

/**
 * Regions whose slugs must never reach a reader, resolved once from the manifests.
 *
 * `_template` was excluded by its folder name and `status: 'example'` was not excluded at
 * all, so **two fixture shelters were published as live directory entries** — searchable at
 * the root console, each with a full record page carrying an address and a phone number, and
 * both present in `directory.json` for anybody consuming the export. Only the `/directory/`
 * index labelled them; the three surfaces a person in trouble actually meets did not.
 *
 * Excluded rather than labelled in three more places. A person scanning for a bed at 2am
 * should not have to read a badge to find out a shelter is not real, and one filter cannot be
 * got wrong the way three separate markers can. The folder stays: it is what
 * `packages/core/test/directory.test.ts` reads by path, and it is the worked example a
 * contributor copies.
 */
const FIXTURE_STATUS = 'example';

const fixtureSlugs = new Set(
  Object.entries(regionFiles)
    .filter(([path]) => isRegion(path))
    .filter(([, mod]) => (mod.default as { status?: string } | null)?.status === FIXTURE_STATUS)
    .map(([path]) => slugOf(path))
);

/** A real region: not scaffolding, and not a fixture. */
export const isPublished = (path: string): boolean =>
  isRegion(path) && !fixtureSlugs.has(slugOf(path));

let cache: Region[] | null = null;

/** Every published region, by slug. Throws during build if a manifest is invalid. */
export function loadRegions(): Region[] {
  if (cache) return cache;
  const regions: Region[] = [];
  for (const [path, mod] of Object.entries(regionFiles)) {
    if (!isPublished(path)) continue;
    regions.push(parseRegion(slugOf(path), mod.default));
  }
  regions.sort((a, b) => a.slug.localeCompare(b.slug));
  cache = regions;
  return cache;
}

export type { Region };
