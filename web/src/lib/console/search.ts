/**
 * A first-time visitor's own lookup.
 *
 * Plain substring match is deliberate: this project has no fuzzy-search precedent anywhere,
 * and a wrong "closest match" is worse than an honest empty result for something this small.
 *
 * ## What it searches, and why that changed
 *
 * It used to search an index of **every record**, embedded in the page. That worked with no
 * fetch at all and could not survive national coverage: 27.9 kB gzipped at 1,405 records, a
 * page at 94 kB of a 120 kB budget, and a ceiling near 4,600 no matter how the fields were
 * trimmed [`delivery.md`].
 *
 * Now it searches two things at once:
 *
 * - **every region**, always, embedded — a few kilobytes that do not grow with the directory
 * - **one region's records**, when they have been loaded — the nearest, resolved by the
 *   one-shot fix the console already takes
 *
 * The asymmetry is honest rather than apologetic. Somebody testing whether this directory is
 * real types a place in the city they are standing in, and that is the region that is loaded.
 * Somebody looking for another city finds the city, which is what the region result is for.
 * **The screen says which of the two it just did**, because a search that quietly covers less
 * than a person assumes is worse than one that covers less and says so.
 */
import type { ConsoleRecordEntry, ConsoleRegionFigures } from './types';

export const RESULT_LIMIT = 30;

export interface RegionHit {
  kind: 'region';
  region: string;
  name: string;
  records: number;
}

export interface RecordHit {
  kind: 'record';
  id: string;
  name: string;
  type: string;
  region: string;
  regionName: string;
}

export type ConsoleHit = RegionHit | RecordHit;

export interface SearchScope {
  /** Every region, always present. */
  regions: readonly ConsoleRegionFigures[];
  /** The one region whose records are loaded, if any. */
  loaded?: { region: string; name: string; entries: readonly ConsoleRecordEntry[] } | null;
}

/**
 * Records first, then regions.
 *
 * A person who typed a shelter's name wants the shelter; a person who typed a city gets the
 * city either way, because a city name rarely matches a record. Ordering by specificity
 * costs nothing and puts the exact answer at the top when there is one.
 */
export function search(scope: SearchScope, query: string, limit = RESULT_LIMIT): ConsoleHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: ConsoleHit[] = [];

  const loaded = scope.loaded;
  if (loaded) {
    for (const e of loaded.entries) {
      if (e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)) {
        out.push({
          kind: 'record',
          id: e.id,
          name: e.name,
          type: e.type,
          region: loaded.region,
          regionName: loaded.name
        });
        if (out.length >= limit) return out;
      }
    }
  }

  for (const r of scope.regions) {
    if (r.name.toLowerCase().includes(q) || r.region.toLowerCase().includes(q)) {
      out.push({ kind: 'region', region: r.region, name: r.name, records: r.records });
      if (out.length >= limit) break;
    }
  }
  return out;
}
