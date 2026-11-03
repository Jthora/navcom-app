/**
 * Where one point is from another, at street scale: how far, which way, and where on a radar.
 *
 * Equirectangular, as `position-once.ts` measures: at a few kilometres the error is centimetres, and
 * this runs for every blip on every frame of a phone that may be six times slower than a laptop.
 */
import { metresApart } from '$lib/console/position-once';

export interface LatLon {
  lat: number;
  lon: number;
}

export { metresApart };

/** East and north of `from`, in metres. */
export function offset(from: LatLon, to: LatLon): { east: number; north: number } {
  const rad = Math.PI / 180;
  const dLon = ((to.lon - from.lon + 540) % 360) - 180;
  return {
    east: dLon * rad * Math.cos(((from.lat + to.lat) / 2) * rad) * 6_371_000,
    north: (to.lat - from.lat) * rad * 6_371_000
  };
}

/** Which way `to` is from `from`, in degrees clockwise from north. */
export function bearing(from: LatLon, to: LatLon): number {
  const { east, north } = offset(from, to);
  return (Math.atan2(east, north) * (180 / Math.PI) + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** A bearing as a person says it. */
export function compassPoint(degrees: number): string {
  return POINTS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
}

const STEPS = [50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000];
/**
 * The radar's rings: three, the last wide enough for the farthest blip with a little air, from
 * steps a person can read at a glance.
 */
export function ringsFor(farthest: number): number[] {
  const need = Math.max(farthest * 1.15, 50);
  const i = STEPS.findIndex((s) => s >= need);
  const last = i === -1 ? STEPS.length - 1 : i;
  return STEPS.slice(Math.max(0, last - 2), last + 1);
}

/** The middle of some points, for a radar with nobody at its centre: a laptop holding the watch. */
export function middle(points: readonly LatLon[]): LatLon | null {
  if (points.length === 0) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  return { lat, lon };
}
