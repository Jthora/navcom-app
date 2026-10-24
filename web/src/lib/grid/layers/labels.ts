/**
 * Names on the map: countries from ×2, provinces from ×6, Starcom's Terrae, Maria and Zones with Zones,
 * and each time zone's offset with Time zones [docs/design/map.md §3]. A touch has no hover and a tap
 * opens a screen, so without a name on the map the only way to know which state is which was its shape.
 *
 * The map line `labels` in `scripts/lib/budget.mjs`: loaded by `import()` the first time somebody zooms
 * in to ×2, or chooses Zones or Time zones, and never at first paint or mount. **It fetches nothing**: a
 * country is named from its code by the phone's own tables, a province by the name the world's file
 * already carries, a Zone by its outline's, an offset from its number [../clock.ts].
 *
 * Drawn in screen space, in the quieter neutrals and never ink, on a halo of the ground, over the
 * directory's squares so none runs through a name, and **greedy**: the largest first, each kept only if
 * it overlaps no name already placed, nothing that covers the map, no mission's ring, no Zone's count and
 * no hazard's mark, so names never print over each other, under the key or over what they would hide.
 * Each is placed once per shape at its file's label point, or else at a point well inside it, the sample
 * of its largest ring farthest from every edge, worked out the first time it is wanted.
 */

import { inside, project, type Shape } from '../topology';
import { layerData, mapLayers, type Ink } from '../layer.svelte';
import type { View } from '../pick';

type Box = { l: number; t: number; r: number; b: number };

/**
 * A point well inside a shape's largest ring, in map units, or null for one too thin to sample: the label
 * point its file gives, where it gives one, as Starcom's outlines do.
 */
const anchors = new WeakMap<Shape, [number, number] | null>();
export function anchorOf(s: Shape): [number, number] | null {
  if (anchors.has(s)) return anchors.get(s)!;
  const given = s.props.label;
  if (Array.isArray(given) && typeof given[0] === 'number' && typeof given[1] === 'number') {
    anchors.set(s, project(given[0], given[1]));
    return anchors.get(s)!;
  }
  let ring: Float32Array | null = null;
  let box: [number, number, number, number] = [0, 0, 0, 0];
  let area = -1;
  for (const r of s.rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]!);
      x1 = Math.max(x1, r[i]!);
      y0 = Math.min(y0, r[i + 1]!);
      y1 = Math.max(y1, r[i + 1]!);
    }
    if ((x1 - x0) * (y1 - y0) > area) [area, ring, box] = [(x1 - x0) * (y1 - y0), r, [x0, y0, x1, y1]];
  }
  let best: [number, number] | null = null;
  let far = -1;
  // Measured against at most about 64 of the ring's edges: a name's place needs no finer, and the
  // province rings are 1:10m, which at every vertex made the first zoom past ×6 a long frame.
  const step = ring ? Math.max(1, Math.floor(ring.length / 128)) * 2 : 2;
  for (let i = 1; ring && i < 8; i++) {
    for (let j = 1; j < 8; j++) {
      const x = box[0] + ((box[2] - box[0]) * i) / 8;
      const y = box[1] + ((box[3] - box[1]) * j) / 8;
      if (!inside([ring], [x, y])) continue;
      let d = Infinity;
      for (let k = 0, m = ring.length - step; k < ring.length - 1; m = k, k += step) {
        const ax = ring[m]!, ay = ring[m + 1]!, dx = ring[k]! - ax, dy = ring[k + 1]! - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
      }
      if (d > far) [far, best] = [d, [x, y]];
    }
  }
  anchors.set(s, best);
  return best;
}

/**
 * `+5:45`, `−3`, `±0`: an offset as the band's own name says it on the map, short, from its number. Its
 * own few lines rather than the clock's, which would split a chunk the time zones' line loads.
 */
function offsetOf(hours: number): string {
  const m = Math.round(Math.abs(hours) * 60);
  return `${hours === 0 ? '±' : hours > 0 ? '+' : '−'}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`;
}

/** What may be named at this zoom, largest first: `zoom` is how many times the whole map's width. */
function wanted(zoom: number): { s: Shape; text: string; size: number }[] {
  const out: { s: Shape; text: string; size: number }[] = [];
  const add = (list: readonly Shape[] | null | undefined, size: number, text = (s: Shape) => s.name) => {
    for (const s of list ?? []) {
      const t = text(s);
      if (t) out.push({ s, text: t, size });
    }
  };
  const chosen = mapLayers.chosen;
  if (chosen === 'zones') {
    const o = layerData.outlines;
    add(o?.containers, 12);
    if (zoom >= 2) add(o?.zones, 11);
    if (zoom >= 6) add(Object.values(layerData.sectors).flat(), 10);
  } else if (chosen === 'timezones') {
    add(layerData.bands?.map((b) => b.shape), 11, (s) => offsetOf(Number(s.props.zone)));
  } else if (chosen !== 'none' && zoom >= 2) {
    add(layerData.countries, 11);
  }
  if (chosen === 'nations' && zoom >= 6) add(layerData.provinces, 10);
  // Largest first, by box: the name of a large place matters more than a small one's.
  const span = (s: Shape) => (s.bbox[2] - s.bbox[0]) * (s.bbox[3] - s.bbox[1]);
  return out.sort((a, b) => b.size - a.size || span(b.s) - span(a.s));
}

export const labels = {
  /**
   * The names that fit, in CSS px. `covers` are what lies over the canvas, the key and the controls, which
   * no name is put under; `zoom` is the scale over the whole map's; `foot` is how far down the canvas
   * nothing covers; `marks` are where the rings, counts and hazards are drawn, which no name is put over.
   */
  draw(ctx: CanvasRenderingContext2D, v: View, ink: Ink, covers: readonly Box[], zoom: number, foot: number, marks: readonly Box[] = []): void {
    const placed: Box[] = [...covers, { l: 0, t: foot, r: v.width, b: v.height }, ...marks];
    ctx.save();
    if (zoom >= 4 && mapLayers.chosen !== 'zones') {
      /*
       * From ×4 in, what the outlines are, at the foot of what is in view: outside the countries with
       * regions, land, coast and borders are Natural Earth's 1:110m, and a small island left out reads as
       * no land at all; within them, from ×2 in, they are the provinces' 1:10m [GridMap.svelte fineLines].
       * The shorter of the two where the longer would run under the controls, and none where neither fits.
       */
      ctx.font = '500 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ink.ground;
      ctx.fillStyle = ink.faint;
      for (const note of ['1:110m outside US, UK, AU · islands may be missing', '1:110m outside US, UK, AU']) {
        const box = { l: 0, t: foot - 20, r: 8 + ctx.measureText(note).width + 4, b: foot };
        if (box.r > v.width || covers.some((c) => box.l < c.r && box.r > c.l && box.t < c.b && box.b > c.t)) continue;
        ctx.strokeText(note, 8, foot - 6);
        ctx.fillText(note, 8, foot - 6);
        placed.push(box);
        break;
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const { s, text, size } of wanted(zoom)) {
      const w = (s.bbox[2] - s.bbox[0]) * v.scale;
      const h = (s.bbox[3] - s.bbox[1]) * v.scale;
      ctx.font = `${size === 12 ? 600 : 500} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      const tw = ctx.measureText(text).width;
      // A name wider than its place, or on a place too small to see, says nothing it could be read for.
      if (Math.max(w, h) < tw * 0.9 || h < size) continue;
      // A place mostly off screen is named where it is in view, if anywhere: its box's middle, in view.
      const x0 = (s.bbox[0] - v.cx) * v.scale + v.width / 2;
      const y0 = (s.bbox[1] - v.cy) * v.scale + v.height / 2;
      if (x0 > v.width || y0 > v.height || x0 + w < 0 || y0 + h < 0) continue;
      const at = anchorOf(s);
      if (!at) continue;
      let x = (at[0] - v.cx) * v.scale + v.width / 2;
      let y = (at[1] - v.cy) * v.scale + v.height / 2;
      if (x < 0 || y < 0 || x > v.width || y > v.height) {
        // Its anchor is off screen: the middle of what of its box is on screen, if that is inside it.
        const mx = (Math.max(0, x0) + Math.min(v.width, x0 + w)) / 2;
        const my = (Math.max(0, y0) + Math.min(v.height, y0 + h)) / 2;
        if (!inside(s.rings, [v.cx + (mx - v.width / 2) / v.scale, v.cy + (my - v.height / 2) / v.scale])) continue;
        [x, y] = [mx, my];
      }
      const box = { l: x - tw / 2 - 3, t: y - size / 2 - 2, r: x + tw / 2 + 3, b: y + size / 2 + 2 };
      if (box.l < 0 || box.r > v.width || box.t < 0 || box.b > v.height) continue;
      if (placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) continue;
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = ink.ground;
      ctx.strokeText(text, x, y);
      // Never ink, which is what a hover, a tap and a mission's ring are drawn in: a name is read, not lifted.
      ctx.fillStyle = size === 10 ? ink.faint : ink.muted;
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }
};
