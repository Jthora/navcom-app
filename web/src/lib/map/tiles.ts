/**
 * The live map's streets: one extract of OpenStreetMap, ours, hosted beside the app and saved onto the
 * phone for the night (the owner's map decisions, 2026-11-03).
 *
 * Saved, the streets draw with no network at all, so a crowd taking the cell network does not blank
 * the map, and no tile server learns where anybody is looking. Not saved, the map reads the same file
 * from navcom.app a range at a time. Its provenance is in `/map/NOTICE.txt`.
 *
 * Kept in a cache of its own, outside the Wipeable tier: it is a public map of Manhattan, nothing of
 * anybody's, so a panic wipe leaves it [invariant 5], and a burn takes it with every other cache.
 */
export const STREETS = {
  url: '/tiles/manhattan-20261103.pmtiles',
  area: 'Manhattan',
  built: '2026-11-03',
  bytes: 21_640_397,
  sha256: '1f1e55a2844a0944d0d2e192f78f8be8e4df7563bcc83117c5e16036780df192',
  /** West, south, east, north. */
  bbox: [-74.03, 40.69, -73.9, 40.89] as const
};

const CACHE = 'navcom-streets';

/** Whether this extract has streets where `p` is. */
export function covers(p: { lat: number; lon: number }): boolean {
  const [w, s, e, n] = STREETS.bbox;
  return p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
}

/** The extract, as this phone saved it, or null. */
export async function savedStreets(): Promise<Blob | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const hit = await (await caches.open(CACHE)).match(STREETS.url);
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Saves the extract whole, checked: the size and the digest it shipped with, or nothing is kept, so a
 * download cut off in a subway is not mistaken for streets. Drops any older extract saved before it.
 */
export async function saveStreets(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const got = await fetch(STREETS.url, { cache: 'no-store' });
    if (!got.ok) return false;
    const bytes = await got.arrayBuffer();
    if (bytes.byteLength !== STREETS.bytes || hex(await crypto.subtle.digest('SHA-256', bytes)) !== STREETS.sha256) return false;
    const cache = await caches.open(CACHE);
    for (const old of await cache.keys()) if (new URL(old.url).pathname !== STREETS.url) await cache.delete(old);
    await cache.put(STREETS.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
    return true;
  } catch {
    return false;
  }
}

export async function forgetStreets(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(CACHE);
}
