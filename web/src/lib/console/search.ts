/**
 * A first-time visitor's own lookup, working the instant they land — no fetch, no watch,
 * against the already-embedded index built in `routes/+page.server.ts`.
 *
 * Plain substring match is deliberate: this project has no fuzzy-search precedent anywhere,
 * and a wrong "closest match" is worse than an honest empty result for something this small.
 */
import type { ConsoleIndexEntry } from './types';

export const RESULT_LIMIT = 30;

export function search(
  index: ConsoleIndexEntry[],
  query: string,
  limit = RESULT_LIMIT
): ConsoleIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: ConsoleIndexEntry[] = [];
  for (const entry of index) {
    if (
      entry.name.toLowerCase().includes(q) ||
      entry.type.toLowerCase().includes(q) ||
      entry.regionName.toLowerCase().includes(q)
    ) {
      out.push(entry);
      if (out.length >= limit) break;
    }
  }
  return out;
}
