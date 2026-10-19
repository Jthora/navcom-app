/**
 * Which Sector a point is in, answered on the device that asks [the owner's map decision D7].
 *
 * The question is where somebody works, so it is never put to anyone else: the index is fetched
 * whole, the same file for everybody, and the point never leaves the phone. In longitude and
 * latitude, so the polar Sectors, which run to ±90°, are answered like any other.
 *
 * Edges are simplified to about a kilometre [Starcom D-ZR, ZR9], so near one the answer is not
 * certain: within `nearMetres` of an edge, the Sector on its other side is offered too, and the
 * person chooses.
 */

import { boxOf, edgeMetres, holds, type LonLatBox, type LonLatRing } from './geometry.js';

export interface ZspIndex {
  areas: { id: string; rings: LonLatRing[]; bbox: LonLatBox }[];
}

/** An index over Sectors (or any areas that tile what they cover), each by its id and rings. */
export function zspIndex(areas: readonly { id: string; rings: LonLatRing[] }[]): ZspIndex {
  return { areas: areas.map((a) => ({ id: a.id, rings: a.rings, bbox: boxOf(a.rings) })) };
}

/** About how far an edge may be from where it is drawn: the simplification's kilometre, and half again. */
export const NEAR_METRES = 1_500;

/**
 * The Sector holding (lon, lat), and the others within `nearMetres` of it, nearest first. A pole is
 * answered just short of it, where every ring that meets it runs; 180° is answered as -180°, the
 * same meridian, on the side the format draws it.
 */
export function placeAt(index: ZspIndex, lon: number, lat: number, nearMetres = NEAR_METRES): { inside: string | null; near: string[] } {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { inside: null, near: [] };
  const x = lon >= 180 ? lon - 360 : lon;
  const y = Math.min(lat, 90 - 1e-7);
  const padLat = nearMetres / 110_574;
  const padLon = Math.min(360, nearMetres / (111_320 * Math.max(Math.cos((y * Math.PI) / 180), 1e-6)));
  let inside: string | null = null;
  const near: { id: string; d: number }[] = [];
  for (const a of index.areas) {
    const [w, s, e, n] = a.bbox;
    if (y < s - padLat || y > n + padLat) continue;
    // A box can reach the point across the antimeridian, where -179.99 and 179.99 are neighbours.
    const inLon = (v: number) => v >= w - padLon && v <= e + padLon;
    if (!inLon(x) && !inLon(x - 360) && !inLon(x + 360)) continue;
    if (inside === null && holds(a.rings, x, y)) {
      inside = a.id;
      continue;
    }
    if (nearMetres <= 0) continue;
    const d = Math.min(edgeMetres(a.rings, x, y, false), edgeMetres(a.rings, x + 360, y, false), edgeMetres(a.rings, x - 360, y, false));
    if (d <= nearMetres) near.push({ id: a.id, d });
  }
  return { inside, near: near.filter((n) => n.id !== inside).sort((a, b) => a.d - b.d).map((n) => n.id) };
}
