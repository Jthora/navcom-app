/**
 * What is under a point on the map: the hit-test a tap, a hover and the keyboard's reticle share
 * [docs/design/map.md §6: every shape is a door].
 *
 * Pure: no DOM, no canvas. Tested directly against the committed geometry.
 *
 * One fixed order, topmost first: a point (a mission's ring, a directory record, a region's
 * ring), then a shape a mission fills, then any province, then any country. A lit shape counts within
 * `LIT_SLOP` CSS px of its edge, because at the whole-world zoom on a phone California is about 10 px
 * across and a thumb is not; zoomed in, the same 12 px is a street, and nothing is gained. The 12 px
 * is the finger's and does not shrink with the world, so at the phone's opening view, about 317 px
 * wide, it reaches 13.6° at the equator and the middle of Texas takes a lit California; that is kept,
 * and what a tap took stays lifted [map.md §6].
 *
 * This names the shape that was tapped. It never decides which country a *place* is in: the
 * place screen lists missions by the jurisdiction their packages are filed under, and directory
 * regions by distance, never by which outline holds them [map.md §3].
 */

import type { Shape } from './topology';
import type { PlaceOfRecord } from './places';

/** Which point of the map's rectangle sits at the centre of the canvas, and how many CSS px its width spans. */
export interface View {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}

/** How far outside its edge a lit shape still answers a tap, in CSS px, at every zoom: a thumb's slack, not a distance on the ground. */
export const LIT_SLOP = 12;

export type Hit =
  | { kind: 'shape'; layer: 'provinces' | 'world'; shape: Shape }
  /** An area of the chosen layer: one of Starcom's Terrae, Maria, Zones or Sectors, or a time zone [layer.svelte.ts]. */
  | { kind: 'area'; shape: Shape }
  | { kind: 'point'; place: PlaceOfRecord }
  /**
   * Hazards' own marks, found by its overlay and never by `pick`: every mark in reach, nearest first,
   * by id, and what a hover says of them [layers/hazards.ts].
   */
  | { kind: 'mark'; ids: string; say: string; of: number };

/** A screen point, in CSS px from the canvas's top left, as a point of the map's rectangle [topology.ts project]. */
export function unitAt(v: View, [sx, sy]: readonly [number, number]): [number, number] {
  return [v.cx + (sx - v.width / 2) / v.scale, v.cy + (sy - v.height / 2) / v.scale];
}

/** A point of the map's rectangle, on screen. */
export function screenAt(v: View, [ux, uy]: readonly [number, number]): [number, number] {
  return [(ux - v.cx) * v.scale + v.width / 2, (uy - v.cy) * v.scale + v.height / 2];
}

function inBox(b: Shape['bbox'], x: number, y: number, pad: number): boolean {
  return x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;
}

/** Even-odd across every ring, as the fill draws it: a hole is outside, an island inside. */
function holds(rings: Shape['rings'], x: number, y: number): boolean {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** The shortest distance from (x, y) to any edge of any ring, in the map's units. */
function edgeDistance(rings: Shape['rings'], x: number, y: number): number {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j]!, ay = r[j + 1]!, bx = r[i]!, by = r[i + 1]!;
      const dx = bx - ax, dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * The nearest point within its own reach, by kind: a mission's ring before a directory record, a
 * record before a region's circle. A mission is what the map opens on; a record is finer than the
 * region it sits in.
 */
function nearestPoint(v: View, sx: number, sy: number, points: readonly PlaceOfRecord[]): PlaceOfRecord | null {
  const rank = { mission: 0, record: 1, region: 2 } as const;
  let best: PlaceOfRecord | null = null;
  let bestKey = Infinity;
  for (const p of points) {
    const [px, py] = screenAt(v, [p.x, p.y]);
    const d = Math.hypot(px - sx, py - sy);
    if (d > p.reach) continue;
    // Kind first, then distance: a ring 20 px away still beats a circle under the finger.
    const key = rank[p.kind] * 1e6 + d;
    if (key < bestKey) {
      best = p;
      bestKey = key;
    }
  }
  return best;
}

/**
 * What a tap at (sx, sy) on screen would open, topmost first, or null for open sea.
 *
 * `lit` holds the codes of the shapes a mission **fills**, provinces and countries alike — `fill`
 * from `lightsOf`, never its national outlines, which would answer for every province inside them
 * [topology.ts]. `points` are only ever places of record [places.ts]: nothing else can be handed to
 * the map to find.
 */
export function pick(
  v: View,
  [sx, sy]: readonly [number, number],
  layers: {
    provinces: readonly Shape[];
    countries: readonly Shape[];
    lit: ReadonlySet<string>;
    points?: readonly PlaceOfRecord[];
  }
): Hit | null {
  if (v.scale <= 0) return null;
  const point = layers.points?.length ? nearestPoint(v, sx, sy, layers.points) : null;
  if (point) return { kind: 'point', place: point };

  const [x, y] = unitAt(v, [sx, sy]);
  const slop = LIT_SLOP / v.scale;

  // A lit shape: inside it, or the nearest within the slop.
  if (layers.lit.size > 0) {
    let near: Hit | null = null;
    let nearest = slop;
    for (const [layer, shapes] of [['provinces', layers.provinces], ['world', layers.countries]] as const) {
      for (const shape of shapes) {
        if (shape.id === null || !layers.lit.has(shape.id) || !inBox(shape.bbox, x, y, slop)) continue;
        if (holds(shape.rings, x, y)) return { kind: 'shape', layer, shape };
        const d = edgeDistance(shape.rings, x, y);
        if (d <= nearest) {
          nearest = d;
          near = { kind: 'shape', layer, shape };
        }
      }
      // A lit province near the tap outranks a lit country under it.
      if (near) return near;
    }
  }

  for (const [layer, shapes] of [['provinces', layers.provinces], ['world', layers.countries]] as const) {
    for (const shape of shapes) {
      if (inBox(shape.bbox, x, y, 0) && holds(shape.rings, x, y)) return { kind: 'shape', layer, shape };
    }
  }
  return null;
}

