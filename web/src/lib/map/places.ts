/**
 * A place on record, by its id, as a destination: the one an answer came from (2026-11-03).
 *
 * A record's id starts with its area's, so the area is the longest one whose id is its start, and its
 * records are that area screen's own data, as the watch's lookup reads them. Never a confidential
 * record, and never one whose location is withheld: no hand-off is ever offered for those [map.md §1].
 */
import { preloadData } from '$app/navigation';
import { isConfidential, locatingLeaks, type ResourceRecord } from '@navcom/core';
import type { ConsoleCentroid } from '$lib/console/types';
import type { Destination } from './blips';

let centroids: ConsoleCentroid[] | null = null;

export function areaOf(id: string, regions: readonly string[]): string | null {
  return regions.filter((r) => id.startsWith(`${r}-`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

export function destinationOf(r: ResourceRecord): Destination | null {
  if (r.lat === undefined || r.lon === undefined || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return null;
  if (isConfidential(r.type) || locatingLeaks(r).length > 0) return null;
  return { id: r.id, name: r.name, lat: r.lat, lon: r.lon };
}

export async function placeById(id: string): Promise<Destination | null> {
  try {
    centroids ??= ((await (await fetch('/console-regions.json')).json()) as { centroids: ConsoleCentroid[] }).centroids;
    const area = areaOf(id, centroids.map((c) => c.region));
    if (!area) return null;
    const got = await preloadData(`/terminal/directory/${area}/`);
    if (got.type !== 'loaded' || got.status !== 200) return null;
    const record = ((got.data as { records?: ResourceRecord[] }).records ?? []).find((r) => r.id === id);
    return record ? destinationOf(record) : null;
  } catch {
    return null;
  }
}
