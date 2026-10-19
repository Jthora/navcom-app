/**
 * The Spheres on the map: domains of influence, a language's, a civilisation's or a political
 * community's, each a cited list of countries, overlapping [docs/design/map.md, Spheres; the owner's
 * map decision D9].
 *
 * The map line `spheres` in `scripts/lib/budget.mjs`: loaded by `import()` when somebody chooses
 * Spheres, with its one file, `/grid/spheres.json`, fetched whole then and never by what is on screen,
 * and not in the service worker's install precache. **Vendored by digest, never fetched from Starcom**
 * [scripts/spheres-vendor.mjs]; until Mecha Jono's lists are vendored the build has none, and the map
 * says so rather than drawing anything synthetic.
 *
 * A member is drawn over the world's own outline for its code; a small state with no outline at the
 * map's scale is a circle at Natural Earth's label point (D9). In the neutrals only, every hue being a
 * watch state. **One Sphere at a time is shaded, the one somebody opened, and it is hatched**, so it is
 * never mistaken for a mission's solid lift, with a thin ink outline; the hatch is kept in screen space,
 * so it reads the same at every zoom. With none opened nothing is shaded, and the key says to open one:
 * Spheres overlap, and with the real lists nearly every country is in one, so a lift for "a member of
 * some Sphere" would be a faint wash over the whole world that tells nobody anything. A small state is a
 * dotted circle until its Sphere is opened, then a filled one: Places' rings are solid, so the two are
 * never taken for each other. The key names the Sphere hatched, after Back and across a pan, since the
 * hatch outlives the screen that chose it.
 */

import { areaAt, countryName, project, type Shape } from '../topology';
import { layerData, loaded, mapLayers, type DrawnLayer } from '../layer.svelte';

/** `/grid/spheres.json`, as `scripts/spheres-vendor.mjs` writes it. */
export interface SpheresFile {
  navcom: {
    source: string;
    manifest_sha256: string;
    generated: string | null;
    lists: string;
    /** The oldest and the newest day any list was read, and how many lists do not say; null when none says. */
    read: { oldest: string; newest: string; unsaid: number } | null;
    /** Until the lists' author says they are final: shown, and labelled draft. */
    draft: boolean;
    licence: string | null;
    credit: string;
    unread: number;
  };
  spheres: {
    id: string;
    name: string;
    family: 'language' | 'civilisation' | 'political';
    members: { code: string; source?: string }[];
    groups: { id: string; name: string; members: string[] }[];
    sources: { name: string; url?: string; licence?: string }[];
    read: string | null;
  }[];
  /** Label points, `[lon, lat]`, for the members with no outline at the world's scale. */
  points: Record<string, [number, number]>;
}

/** A Sphere as the map draws it: the outlines it shades, and the circles it draws, projected. */
export interface DrawnSphere {
  id: string;
  name: string;
  members: number;
  shapes: Shape[];
  circles: { code: string; x: number; y: number }[];
}

/** Each Sphere's members on the map: an outline by its code where the world has one, else a circle. */
export function spheresOf(file: SpheresFile, countries: readonly Shape[]): DrawnSphere[] {
  const byCode = new Map(countries.flatMap((c) => (c.id ? [[c.id, c] as const] : [])));
  return file.spheres.map((s) => ({
    id: s.id,
    name: s.name,
    members: s.members.length,
    shapes: s.members.flatMap((m) => (byCode.has(m.code) ? [byCode.get(m.code)!] : [])),
    circles: s.members.flatMap((m) => {
      const at = byCode.has(m.code) ? null : file.points[m.code];
      if (!at) return [];
      const [x, y] = project(at[0], at[1]);
      return [{ code: m.code, x, y }];
    })
  }));
}

let asked: Promise<void> | null = null;

/** The lists, once: `absent` when this build carries none, which until the lists are vendored is every build. */
export function loadSpheres(): Promise<void> {
  asked ??= (async () => {
    mapLayers.spheres = 'loading';
    try {
      const r = await fetch('/grid/spheres.json');
      if (r.status === 404) {
        mapLayers.spheres = 'absent';
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      layerData.spheres = (await r.json()) as SpheresFile;
      loaded();
      mapLayers.spheres = 'ready';
    } catch {
      mapLayers.spheres = 'failed';
      asked = null;
    }
  })();
  return asked;
}

/** The Spheres a country is in, the most specific first: the one with the fewest members. */
export function spheresAt(code: string): SpheresFile['spheres'] {
  const file = layerData.spheres;
  if (!file) return [];
  return file.spheres.filter((s) => s.members.some((m) => m.code === code)).sort((a, b) => a.members.length - b.members.length);
}

// ─── On the map ───────────────────────────────────────────────────────────────────────────────

const pathOf = (shapes: readonly Shape[]) => {
  const p = new Path2D();
  for (const s of shapes) {
    for (const r of s.rings) {
      p.moveTo(r[0]!, r[1]!);
      for (let i = 2; i < r.length; i += 2) p.lineTo(r[i]!, r[i + 1]!);
      p.closePath();
    }
  }
  return p;
};

/** What is drawn, rebuilt only when the lists, the countries or the Sphere picked out change. */
let from: { file: SpheresFile | null; countries: Shape[] | null; chosen: string | null } = { file: null, countries: null, chosen: null };
let drawn: { all: DrawnSphere[]; borders: Path2D | null; chosen: DrawnSphere | null; chosenPath: Path2D | null; circles: Map<string, { x: number; y: number }> } = {
  all: [],
  borders: null,
  chosen: null,
  chosenPath: null,
  circles: new Map()
};
function sync() {
  const { spheres: file, countries } = layerData;
  const chosen = mapLayers.sphere;
  if (file === from.file && countries === from.countries && chosen === from.chosen) return;
  from = { file, countries, chosen };
  if (!file || !countries) {
    drawn = { all: [], borders: countries ? pathOf(countries) : null, chosen: null, chosenPath: null, circles: new Map() };
    return;
  }
  const all = spheresOf(file, countries);
  const one = all.find((s) => s.id === chosen) ?? null;
  drawn = {
    all,
    borders: pathOf(countries),
    chosen: one,
    chosenPath: one ? pathOf(one.shapes) : null,
    circles: new Map(all.flatMap((s) => s.circles.map((c) => [c.code, c] as const)))
  };
}

/** The hatch, a tile per ink, so Low signature hatches in its own colours. */
let hatch: { ink: string; pattern: CanvasPattern | null } | null = null;
function hatchOf(ctx: CanvasRenderingContext2D, ink: string): CanvasPattern | null {
  if (hatch?.ink === ink) return hatch.pattern;
  const tile = document.createElement('canvas');
  tile.width = tile.height = 6;
  const t = tile.getContext('2d');
  if (t) {
    t.strokeStyle = ink;
    t.lineWidth = 1;
    t.beginPath();
    // 45°, wrapping at the tile's corners so the lines run on unbroken.
    for (const o of [-6, 0, 6]) {
      t.moveTo(o, 6);
      t.lineTo(o + 6, 0);
    }
    t.stroke();
  }
  hatch = { ink, pattern: t ? ctx.createPattern(tile, 'repeat') : null };
  return hatch.pattern;
}

/** `3 Aug`, for the key. */
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * When the lists were read, by the oldest first: `read 3 Aug–19 Oct`, or one day when they agree, and
 * how many say nothing, so the freshest list's date is never passed off as all of them [invariant 7].
 */
export function readSaid(read: SpheresFile['navcom']['read']): string {
  if (!read) return 'read: not said';
  const days = read.oldest === read.newest ? shortDay(read.oldest) : `${shortDay(read.oldest)}–${shortDay(read.newest)}`;
  return `read ${days}${read.unsaid > 0 ? `, ${read.unsaid} not said` : ''}`;
}

/** A circle's reach for a thumb, in CSS px: a small state is a few pixels wide, a thumb is not. */
const CIRCLE_SLOP = 12;
const CIRCLE_PX = 5;

/** A small member as a shape a hover can lift and a tap can open: a ring the size it is drawn, at this zoom. */
function circleShape(code: string, at: { x: number; y: number }, scale: number): Shape {
  const r = (CIRCLE_PX + 2) / scale;
  const ring = new Float32Array(34);
  for (let i = 0; i <= 16; i++) {
    ring[2 * i] = at.x + r * Math.cos((i * Math.PI) / 8);
    ring[2 * i + 1] = at.y + r * Math.sin((i * Math.PI) / 8);
  }
  return { id: code, name: countryName(code) ?? code.toUpperCase(), rings: [ring], bbox: [at.x - r, at.y - r, at.x + r, at.y + r], props: { circle: true } };
}

export const layer: DrawnLayer = {
  load: () => void loadSpheres(),
  fill(ctx, ink) {
    sync();
    // Only the Sphere opened is shaded: with none, nothing is, and the key says to open one.
    if (drawn.chosenPath) {
      const pattern = hatchOf(ctx, ink.ink);
      const t = ctx.getTransform();
      if (pattern && typeof pattern.setTransform === 'function') {
        // Undo the map's own transform, then the device's pixel ratio, so the hatch is 6 CSS px apart at every zoom.
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        pattern.setTransform(new DOMMatrix([Math.min(dpr, 2) / t.a, 0, 0, Math.min(dpr, 2) / t.d, -t.e / t.a, -t.f / t.d]));
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = pattern;
      } else {
        // A phone too old to place a pattern: a plain lift, stronger than the members' and still no hue.
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = ink.ink;
      }
      ctx.fill(drawn.chosenPath, 'evenodd');
      ctx.globalAlpha = 1;
    }
  },
  lines(ctx, scale, ink) {
    sync();
    if (drawn.borders) {
      ctx.lineWidth = 0.6 / scale;
      ctx.strokeStyle = ink.strong;
      ctx.stroke(drawn.borders);
    }
    if (drawn.chosenPath) {
      ctx.lineWidth = 1.25 / scale;
      ctx.strokeStyle = ink.ink;
      ctx.stroke(drawn.chosenPath);
    }
    if (drawn.circles.size === 0) return;
    /*
     * The small states, a circle each, the same size at every zoom (D9): filled in the Sphere opened,
     * and otherwise dotted, which nothing else on the map is, so it is never read as a region of Places.
     */
    const r = CIRCLE_PX / scale;
    const chosen = new Set(drawn.chosen?.circles.map((c) => c.code) ?? []);
    const dotted = new Path2D();
    for (const [code, c] of drawn.circles) {
      if (!chosen.has(code)) {
        dotted.moveTo(c.x + r, c.y);
        dotted.arc(c.x, c.y, r, 0, Math.PI * 2);
        continue;
      }
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ink.ink;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = ink.ink;
      ctx.stroke();
    }
    // Eight dots to a circle, each about 1.75 px, nearly 4 px apart: plainly dotted, and still round.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.75 / scale;
    ctx.setLineDash([0.01 / scale, (Math.PI * 2 * CIRCLE_PX) / 8 / scale]);
    ctx.strokeStyle = ink.muted;
    ctx.stroke(dotted);
    ctx.restore();
  },
  hit(v, at) {
    if (!layerData.spheres) return undefined;
    sync();
    // A small state's circle first, within a thumb's reach, then any member's outline.
    let best: { code: string; c: { x: number; y: number }; d: number } | null = null;
    for (const [code, c] of drawn.circles) {
      const d = Math.hypot((c.x - v.cx) * v.scale + v.width / 2 - at[0], (c.y - v.cy) * v.scale + v.height / 2 - at[1]);
      if (d <= CIRCLE_SLOP && (!best || d < best.d)) best = { code, c, d };
    }
    if (best) return circleShape(best.code, best.c, v.scale);
    // A country in no Sphere answers as Nation States would: a tap is never dead.
    return areaAt(v, at, [...new Set(drawn.all.flatMap((s) => s.shapes))]) ?? undefined;
  },
  say(shape) {
    const there = spheresAt(shape.id ?? '');
    return `${shape.name ?? shape.id ?? 'Unnamed'} · ${there.length === 0 ? 'in no Sphere' : there.map((s) => s.name).join(', ')}`;
  },
  open: (shape) => ({ kind: 'sphere', id: null, code: shape.id }),
  legend() {
    if (mapLayers.spheres === 'absent') return 'Spheres · not in this build yet';
    const file = layerData.spheres;
    if (!file) return 'Spheres · loading';
    const n = file.navcom;
    // What is shaded first, since the hatch outlives the screen that chose it; then whose, and how old.
    const one = file.spheres.find((s) => s.id === mapLayers.sphere);
    const licence = n.licence === 'CC-BY-4.0' ? 'CC BY 4.0' : (n.licence ?? '');
    return `Spheres · ${one ? `${one.name} hatched` : 'open one to hatch it'} · ${n.draft ? 'draft lists' : 'lists'}, ${readSaid(n.read)} · ${n.credit}${licence ? `, ${licence}` : ''}`;
  },
  lifted(current) {
    // A country opened from a list, lifted by its outline; a small state's circle is lifted by the tap that took it.
    const top = current as { kind?: unknown; code?: unknown } | null;
    if (top?.kind !== 'sphere' || typeof top.code !== 'string') return null;
    return layerData.countries?.find((c) => c.id === top.code) ?? null;
  }
};
