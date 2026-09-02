/**
 * Build-time directory load.
 *
 * Every region's CSV is inlined by Vite at build time, so the published site is static HTML
 * with no data fetch and no runtime dependency on anything.
 *
 * **Importing this module costs the whole directory.** The glob below is eager and runs at
 * module scope, so there is no such thing as importing one function from here cheaply. That
 * is fine for a page that renders records and expensive for one that does not — see
 * `regions.ts`, which exists so the second kind has somewhere to import from. If you need
 * only region names, or only the label tables from `@navcom/core`, do not import this file.
 */

import { parseDirectoryOrThrow } from '@navcom/core';
import type { ResourceRecord } from '@navcom/core';
import { isPublished, loadRegions, slugOf, type Region } from './regions';

const csvFiles = import.meta.glob('../../../../data/regions/*/resources.csv', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

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

  const regions = loadRegions();
  const records: ResourceRecord[] = [];
  const seen = new Map<string, string>();

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

export function regionOf(record: ResourceRecord): Region | undefined {
  return loadAll().regions.find((r) => r.slug === record.region);
}

export { loadRegions };

export {
  FIELD_LABELS, INTAKE_FIELDS, AVAILABILITY_FIELDS, VALUE_LABELS, labelValue, labelValues
} from '@navcom/core';
