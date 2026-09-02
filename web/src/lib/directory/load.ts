/**
 * Build-time directory load.
 *
 * Every region's CSV and manifest is inlined by Vite at build time, so the published site
 * is static HTML with no data fetch and no runtime dependency on anything.
 */

import { parseDirectoryOrThrow } from '@navcom/core';
import { parseRegion, type Region } from '@navcom/core';
import type { ResourceRecord } from '@navcom/core';

const csvFiles = import.meta.glob('../../../../data/regions/*/resources.csv', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

const regionFiles = import.meta.glob('../../../../data/regions/*/region.json', {
  eager: true
}) as Record<string, { default: unknown }>;

const slugOf = (path: string): string => path.replace(/.*\/regions\/([^/]+)\/.*/, '$1');

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
const isPublished = (path: string): boolean => isRegion(path) && !fixtureSlugs.has(slugOf(path));

export interface LoadedDirectory {
  regions: Region[];
  records: ResourceRecord[];
}

let cache: LoadedDirectory | null = null;

/**
 * Throws during build if any CSV is malformed, any manifest is invalid, or two regions
 * claim the same record id — see data/regions/README.md on why ids are global.
 */
export function loadAll(): LoadedDirectory {
  if (cache) return cache;

  const regions: Region[] = [];
  const records: ResourceRecord[] = [];
  const seen = new Map<string, string>();

  for (const [path, mod] of Object.entries(regionFiles)) {
    if (!isPublished(path)) continue;
    regions.push(parseRegion(slugOf(path), mod.default));
  }
  regions.sort((a, b) => a.slug.localeCompare(b.slug));

  for (const [path, csv] of Object.entries(csvFiles)) {
    if (!isPublished(path)) continue;
    const slug = slugOf(path);
    if (!regions.some((r) => r.slug === slug)) {
      throw new Error(`data/regions/${slug}/ has resources.csv but no region.json`);
    }
    for (const record of parseDirectoryOrThrow(csv)) {
      const already = seen.get(record.id);
      if (already) {
        throw new Error(
          `Record id "${record.id}" is claimed by both "${already}" and "${slug}". ` +
            `Ids are global because URLs are flat — prefix with the region slug.`
        );
      }
      seen.set(record.id, slug);
      // Region is attached here, never read from the CSV, so a row cannot claim to be
      // somewhere it is not.
      records.push({ ...record, region: slug });
    }
  }

  records.sort((a, b) => a.name.localeCompare(b.name));
  cache = { regions, records };
  return cache;
}

/** Records across every region. */
export function loadDirectory(): ResourceRecord[] {
  return loadAll().records;
}

export function loadRegions(): Region[] {
  return loadAll().regions;
}

export function regionOf(record: ResourceRecord): Region | undefined {
  return loadAll().regions.find((r) => r.slug === record.region);
}

export {
  FIELD_LABELS, INTAKE_FIELDS, AVAILABILITY_FIELDS, VALUE_LABELS, labelValue, labelValues
} from '@navcom/core';
