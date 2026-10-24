/**
 * Day and night on the map: where the sun is down, in two steps, twilight and night, the line where it
 * is rising or setting, and the point it is overhead [docs/design/map.md, Day and night].
 *
 * The map line `daylight` in `scripts/lib/budget.mjs`: loaded by `import()` when Time zones is chosen,
 * which always draws it, or when its box is ticked over another layer. **Nothing is fetched**: the sun
 * is worked out on this phone from its own clock [../sun.ts], and the map's key says so.
 *
 * Built for the device floor's battery as much as its processor. Each edge becomes one `Path2D` in map
 * units once a minute, aligned to the minute, and a pan or a zoom only redraws them; there is no
 * animation and no frame loop, one redraw a minute, and none while the page is hidden. Drawn in the
 * neutrals and never a hue.
 *
 * **Night is carried by texture, not by tone.** The land is already near black, and no darkening of it
 * gets past about 1.19:1 in WCAG's contrast (its 0.05 for flare caps what any shade of #141920 can
 * reach against black): four steps of the deepest neutral at a fifth each left full night the colour
 * of the daytime ocean, and on a cheap screen in sunlight nothing at all. So each step darkens by over
 * a third, and lays a sparse grid of dots, in screen space so it is the same at every zoom: twilight,
 * from sunset to the end of civil twilight, one dot every 6 px; night, after it, twice as many. Dots read
 * on any screen in either signature, and nothing else on the map is dotted over an area.
 */

import { project } from '../topology';
import { TWILIGHT, nightRing, subsolar, terminator, type SunPoint } from '../sun';
import { layerData, loaded, mapLayers, type Overlay } from '../layer.svelte';
import type { View } from '../pick';

/** The two steps: where the sun has set, and where civil twilight has ended too, which is night. */
export const STEPS = [TWILIGHT[0], TWILIGHT[1]] as const;
/** How much each step darkens, of the deepest neutral: night is both, a little over half. */
export const SHADE = 0.35;
/** The dots' spacing, in CSS px: one a tile in twilight, a second at the tile's middle at night. */
export const DOTS_PX = 6;

/** Each step of the night, from sunset in: its cap, drawn three times a world's width apart. */
let caps: Path2D[] = [];
let line: Path2D | null = null;
let sun: SunPoint | null = null;
/** The minute the drawing is for, in ms: what the key says, and what a tick compares against. */
let minute = 0;

/**
 * One ring of longitude and latitude, projected, at each copy that can fall on the Earth.
 *
 * **A run along a meridian is drawn in 2° steps, never as one chord.** A cap that holds a pole is
 * closed along ±180° from its edge up to the pole, and Equal Earth draws those meridians as the Earth's
 * own bulging edge: as one straight line each they cut the bulge off, and the night stopped at a
 * vertical line a third of the way in from either side, leaving Australia and the Americas' west in
 * daylight at midnight. `e2e/daylight.spec.ts` looks for night at the Earth's edge.
 */
function pathOf(ring: readonly number[], closed: boolean, path: Path2D = new Path2D()): Path2D {
  const shifts = ring.every((v, i) => i % 2 === 1 || (v >= -180 && v <= 180)) ? [0] : [-360, 0, 360];
  const n = ring.length / 2;
  for (const k of shifts) {
    let [lon, lat] = [ring[0]! + k, ring[1]!];
    const [x0, y0] = project(lon, lat);
    path.moveTo(x0, y0);
    for (let i = 1; i <= (closed ? n : n - 1); i++) {
      const [to, toLat] = [ring[2 * (i % n)]! + k, ring[2 * (i % n) + 1]!];
      const steps = to === lon ? Math.ceil(Math.abs(toLat - lat) / 2) : 1;
      for (let s = 1; s <= steps; s++) {
        const [x, y] = project(to, lat + ((toLat - lat) * s) / steps);
        path.lineTo(x, y);
      }
      [lon, lat] = [to, toLat];
    }
    if (closed) path.closePath();
  }
  return path;
}

/** The sun and the night for the current minute, and a new picture. */
function compute(): void {
  minute = Math.floor(Date.now() / 60_000) * 60_000;
  sun = subsolar(minute);
  caps = STEPS.map((below) => pathOf(nightRing(sun!, below), true));
  line = pathOf(terminator(sun), false);
  layerData.sun = { ...sun, at: minute };
  loaded();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let every: ReturnType<typeof setInterval> | null = null;

/** Once a minute, on the minute, and never while nobody can see the page. */
function tick(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (Math.floor(Date.now() / 60_000) * 60_000 !== minute) compute();
}

/** Back in view: a new picture only if a minute has turned while it was hidden. */
function seen(): void {
  if (!document.hidden) tick();
}

/**
 * The dots, a tile in device pixels so each is crisp at any pixel ratio: one dot, about a CSS pixel
 * square, in a tile `DOTS_PX` CSS px wide. Made again only when the ink or the ratio changes.
 */
let dots: { key: string; pattern: CanvasPattern | null; px: number } | null = null;
function dotsOf(ctx: CanvasRenderingContext2D, ink: string, dpr: number): { pattern: CanvasPattern | null; px: number } {
  const key = `${ink} ${dpr}`;
  if (dots?.key === key) return dots;
  const px = Math.max(2, Math.round(DOTS_PX * dpr));
  const dot = Math.max(1, Math.round(dpr));
  const tile = document.createElement('canvas');
  tile.width = tile.height = px;
  const t = tile.getContext('2d');
  if (t) {
    t.fillStyle = ink;
    t.fillRect(0, 0, dot, dot);
  }
  dots = { key, pattern: t ? ctx.createPattern(tile, 'repeat') : null, px };
  return dots;
}

/** Where the sun is overhead on screen, in CSS px, or null when it is off it. */
function sunAt(v: View): [number, number] | null {
  if (!sun) return null;
  const [ux, uy] = project(sun.lon, sun.lat);
  const x = (ux - v.cx) * v.scale + v.width / 2;
  const y = (uy - v.cy) * v.scale + v.height / 2;
  return x < -12 || y < -12 || x > v.width + 12 || y > v.height + 12 ? null : [x, y];
}

/** `14:05` in UTC: the minute the night is drawn for. */
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

export const overlay: Overlay = {
  load() {
    if (timer || every) return;
    compute();
    mapLayers.sun = 'ready';
    timer = setTimeout(() => {
      timer = null;
      tick();
      every = setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000) + 20);
    document.addEventListener('visibilitychange', seen);
  },
  stop() {
    if (timer) clearTimeout(timer);
    if (every) clearInterval(every);
    timer = every = null;
    document.removeEventListener('visibilitychange', seen);
  },
  under(ctx, _scale, ink, edge) {
    if (caps.length === 0) return;
    ctx.save();
    if (edge) ctx.clip(edge);
    // Two steps of the deepest neutral, the second over the first: twilight is one, night both.
    ctx.fillStyle = ink.sunk;
    ctx.globalAlpha = SHADE;
    for (const cap of caps) ctx.fill(cap);
    // Then the dots, in screen space: the map's own transform undone, so they sit on device pixels.
    const t = ctx.getTransform();
    // The canvas's own pixels to a CSS px, as the map sizes it [GridMap.svelte dpr].
    // In the strong line, not ink: brighter than the borders, they swamped the coast and every line at night.
    const { pattern, px } = dotsOf(ctx, ink.strong, Math.min(window.devicePixelRatio || 1, 2));
    if (pattern && typeof pattern.setTransform === 'function') {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = pattern;
      caps.forEach((cap, i) => {
        // Night's dots at the middle of twilight's tile, so night is twice as dotted, never a heavier dot.
        const half = i === 0 ? 0 : Math.floor(px / 2);
        pattern.setTransform(new DOMMatrix([1 / t.a, 0, 0, 1 / t.d, (half - t.e) / t.a, (half - t.f) / t.d]));
        ctx.fill(cap);
      });
    }
    ctx.restore();
  },
  over(ctx, scale, ink, edge) {
    if (!line) return;
    ctx.save();
    if (edge) ctx.clip(edge);
    // The line carries the reading: on a near-black map a darker night is the quieter of the two cues.
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeStyle = ink.muted;
    ctx.stroke(line);
    ctx.restore();
  },
  // Where the sun is, so a count and a name keep off it: it is never moved, being where the sun is.
  place(_ctx, v, taken) {
    const at = sunAt(v);
    if (at) taken.push({ l: at[0] - 10, t: at[1] - 10, r: at[0] + 10, b: at[1] + 10 });
    return [];
  },
  marks(ctx, v, ink) {
    const at = sunAt(v);
    if (!at) return;
    // The point the sun is overhead: a ring and eight rays, in ink. A mark, not a place: nothing to tap.
    const [x, y] = at;
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = ink.ink;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(x + Math.cos(a) * 6.5, y + Math.sin(a) * 6.5);
      ctx.lineTo(x + Math.cos(a) * 9.5, y + Math.sin(a) * 9.5);
    }
    ctx.stroke();
  },
  legend: () => (minute ? `Day and night at ${hhmm(minute)} UTC` : 'Day and night'),
  credit: () => 'worked out on this phone from its own clock, nothing fetched',
  // What the dots mean, under the key, drawn as the canvas draws them.
  swatches: () => (minute ? [{ mark: 'dots', tone: 'faint', text: 'Night · twilight has half the dots' }] : [])
};
