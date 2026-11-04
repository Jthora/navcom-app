/**
 * The live map's streets: extracts of OpenStreetMap, ours, hosted beside the app and saved onto the
 * phone for the night (the owner's map decisions, 2026-11-03).
 *
 * New York City's five boroughs and the New Jersey side of the harbour, one file each, so a phone
 * saves the area it patrols and not 139 MB of a city (the owner, 2026-11-03: "all 5 boroughs should be
 * covered for patrols, just in case", and New Jersey with them). The map reads all of them as one
 * street map: each tile comes from whichever area holds it [streets.ts], and all six are cut from one
 * Protomaps build, so where two areas overlap their tiles are the same tile.
 *
 * Saved, an area's streets draw with no network at all, so a crowd taking the cell network does not
 * blank the map, and no tile server learns where anybody is looking. Not saved, the map reads the same
 * file from navcom.app a range at a time. Their provenance is in `/map/NOTICE.txt`.
 *
 * Kept in a cache of their own, outside the Wipeable tier: a public map of a city, nothing of
 * anybody's, so a panic wipe leaves it [invariant 5], and a burn takes it with every other cache.
 *
 * **A new extract takes a new name.** `vercel.json` serves `/tiles/` as immutable for a year, so a
 * phone that has not saved the streets reads tiles it already fetched from its own cache rather than
 * asking again for each one on a congested cell; a file changed under the same name would never reach
 * it. Each name carries the day it was built, and `map.test.ts` holds the two together.
 */
export interface StreetArea {
  id: string;
  /** What the person reading the screen calls it. */
  name: string;
  url: string;
  built: string;
  bytes: number;
  sha256: string;
  /** West, south, east, north. */
  bbox: readonly [number, number, number, number];
}

const BUILT = '2026-11-03';
const area = (id: string, name: string, bytes: number, sha256: string, bbox: StreetArea['bbox']): StreetArea => ({
  id, name, url: `/tiles/${id}-${BUILT.replaceAll('-', '')}.pmtiles`, built: BUILT, bytes, sha256, bbox
});

/** In the order a point on two of them is given to: the borough before the river's far bank. */
export const STREET_AREAS: readonly StreetArea[] = [
  area('manhattan', 'Manhattan', 21_640_397, '1f1e55a2844a0944d0d2e192f78f8be8e4df7563bcc83117c5e16036780df192', [-74.03, 40.69, -73.9, 40.89]),
  area('brooklyn', 'Brooklyn', 29_937_045, '22d09185aa274b04410a5619731799a6c35af491332b6134fe1dc6d0d60980f9', [-74.05, 40.56, -73.83, 40.74]),
  area('queens', 'Queens', 43_444_181, '0c001c34712c2a9044b883db7122f13eb920720543e611f4d2968dea8299192a', [-73.97, 40.54, -73.7, 40.81]),
  area('bronx', 'The Bronx', 15_598_490, '7d88ecfe1d4ff59b1386c46d47679e3e304e67c9f5dc64ec70667cd4e0ef6d21', [-73.94, 40.78, -73.76, 40.92]),
  area('staten-island', 'Staten Island', 13_121_564, '3eb8cae554e5b29bd14c4941a600e07254924ed1c13b875ac1146a90bf112e53', [-74.26, 40.49, -74.05, 40.65]),
  area('new-jersey', 'Jersey City and Newark', 14_704_471, '3c5e4c4b24d14ae809ca51fa6165c4ffd4a1af2af9a957852509aa904c3475ea', [-74.25, 40.64, -74.02, 40.8])
];

/** What all of them cover together, said where somebody is outside it. */
export const STREETS_COVER = 'New York City and the New Jersey side';

const CACHE = 'navcom-streets';

type Point = { lat: number; lon: number };

/** How far inside an area `p` is, in degrees to its nearest edge; below zero is outside it. */
function inside(a: StreetArea, p: Point): number {
  const [w, s, e, n] = a.bbox;
  return Math.min(p.lon - w, e - p.lon, p.lat - s, n - p.lat);
}

/** The area `p` is in: the one it is deepest inside, so a point by the river is the borough it is in. */
export function areaAt(p: Point): StreetArea | null {
  let best: StreetArea | null = null;
  let depth = 0;
  for (const a of STREET_AREAS) {
    const d = inside(a, p);
    if (d >= 0 && (best === null || d > depth)) {
      best = a;
      depth = d;
    }
  }
  return best;
}

/** Whether any of our extracts has streets where `p` is. */
export function covers(p: Point): boolean {
  return areaAt(p) !== null;
}

/** The areas this phone saved, by id, each as the file it saved. */
export async function savedAreas(): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  if (typeof caches === 'undefined') return out;
  try {
    const cache = await caches.open(CACHE);
    for (const a of STREET_AREAS) {
      const hit = await cache.match(a.url);
      if (hit) out.set(a.id, await hit.blob());
    }
  } catch {
    /* no cache to read: nothing saved */
  }
  return out;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Saves one area whole, checked: the size and the digest it shipped with, or nothing is kept, so a
 * download cut off in a subway is not mistaken for streets. Keeps the other areas saved, and drops any
 * file saved from an earlier build that no area names any more.
 */
export async function saveArea(a: StreetArea): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const got = await fetch(a.url, { cache: 'no-store' });
    if (!got.ok) return false;
    const bytes = await got.arrayBuffer();
    if (bytes.byteLength !== a.bytes || hex(await crypto.subtle.digest('SHA-256', bytes)) !== a.sha256) return false;
    const cache = await caches.open(CACHE);
    const named = new Set(STREET_AREAS.map((x) => x.url));
    for (const old of await cache.keys()) if (!named.has(new URL(old.url).pathname)) await cache.delete(old);
    await cache.put(a.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
    return true;
  } catch {
    return false;
  }
}

export async function forgetStreets(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(CACHE);
}
