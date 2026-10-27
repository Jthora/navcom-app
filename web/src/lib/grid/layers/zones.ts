/**
 * Starcom's Zones, read from the files NavCom vendors and drawn on the map [docs/design/map.md, Zones;
 * D6, D10].
 *
 * The map line `zones` in `scripts/lib/budget.mjs`: loaded by `import()` when somebody chooses Zones
 * or opens a Zone, never at first paint or mount. Every Terra, Mare and Zone comes in one file,
 * fetched whole; a container's Sectors come in its own file, fetched when somebody opens that
 * container, by a tap or from a list, and never because of what is on screen or where anybody is.
 * Opening one tells NavCom's host which container was opened, as picking a region in the search does;
 * looking at the map tells it nothing [map.md §2].
 *
 * Drawn in three neutral weights, with no hue: a Terra's or Mare's edge heaviest, a Zone's lighter, a
 * Sector's faint, and a container's Sectors only once it is opened [layer.svelte.ts DrawnLayer].
 *
 * Nothing is fetched from starcom.app. The files are vendored by digest at each stage
 * (`scripts/zsp-vendor.mjs`), and while a stage is a draft the map says so and keeps nothing (D6).
 */

import { absoluteArcs, areaAt, decode, project, type Ring, type Shape, type Topology } from '../topology';
import { ZSP_DIR, layerData, loaded, mapLayers, type DrawnLayer, type Ink, type Loading } from '../layer.svelte';

/** What the vendoring script records in every file it writes. */
export interface ZspProvenance {
  source: string;
  manifest_sha256: string;
  generated: string | null;
  stage: '1' | '2' | '3' | 'final';
  /** Every stage before Starcom's swap: shown, labelled draft, and never kept (D6). */
  draft: boolean;
  licence: string;
  /** The attribution CC BY 4.0 asks for. */
  credit: string;
  /**
   * How far the drawn outlines drift from the source at worst, in metres, as the vendoring measured
   * it: within this of a drawn edge, which side a point is on is not something the drawn lines can say.
   * Absent from files vendored before it was measured.
   */
  simplified_m?: number;
  containers: { id: string; name: string; level: 'terra' | 'mare'; file: string; sectors: number; source_sha256: string; source_bytes: number }[];
  retired: { id: string; name: string; covered_by: string[] }[];
}

export interface ZonesOutlines {
  navcom: ZspProvenance;
  containers: Shape[];
  zones: Shape[];
  /** What the map strokes, each edge once: a Terra's or Mare's, and a Zone's that is not also one. */
  edges: { containers: Ring[]; zones: Ring[] };
}

/**
 * Every edge of one object's shapes, once, projected, as open lines: what stroking each shape's rings
 * draws, without stroking an edge two shapes share twice. Leaves out the arcs `over` uses, for a
 * coarser object whose own lines are drawn over these: the Zones' lines skip the edges their Terrae
 * and Maria draw. Stroked ring by ring, an edge between two Zones was drawn twice and one between two
 * Terrae four times, which under Starcom's whole draft was 40 ms of a pan's last frame at a sixth of
 * the speed [map.md, Zones]. Here and not beside `coastOf`, whose module every visit loads.
 */
export function edgesOf(topology: Topology, object: string, over?: string): Ring[] {
  const arcs = absoluteArcs(topology);
  const uses = (name: string) => {
    const seen = new Set<number>();
    const walk = (a: unknown): void => {
      if (typeof a === 'number') seen.add(a < 0 ? ~a : a);
      else if (Array.isArray(a)) a.forEach(walk);
    };
    for (const g of topology.objects[name]?.geometries ?? []) if (g.type) walk(g.arcs);
    return seen;
  };
  const drawn = over ? uses(over) : null;
  return [...uses(object)].filter((i) => !drawn?.has(i)).map((i) => Float32Array.from(arcs[i]!.flatMap(([lon, lat]) => project(lon!, lat!))));
}

/** The outlines file, decoded and projected for drawing. */
export function outlinesOf(topology: Topology): ZonesOutlines {
  const layers = decode(topology);
  return {
    navcom: topology.navcom as unknown as ZspProvenance,
    containers: layers['containers']?.shapes ?? [],
    zones: layers['zones']?.shapes ?? [],
    edges: { containers: edgesOf(topology, 'containers'), zones: edgesOf(topology, 'zones', 'containers') }
  };
}

/** One container's file of Sectors, decoded and projected. */
export function sectorsOf(topology: Topology): Shape[] {
  return decode(topology)['sectors']?.shapes ?? [];
}

/**
 * Where an id sits, in what is loaded: its Terra or Mare, its Zone, its Sector, as far down as the id
 * goes. A Sector's own shape is there once its container is open; until then it is null and the Zone
 * still answers. Null for an id the outlines do not hold.
 */
export function chainOf(
  outlines: ZonesOutlines,
  id: string,
  sectors: Readonly<Record<string, readonly Shape[]>>
): { container: Shape; zone: Shape | null; sector: Shape | null } | null {
  const slash = id.indexOf('/sector:');
  const zoneId = slash > 0 ? id.slice(0, slash) : id.startsWith('zone:') ? id : null;
  const zone = zoneId === null ? null : (outlines.zones.find((z) => z.id === zoneId) ?? null);
  if (zoneId !== null && zone === null) return null;
  const containerId = zone ? zone.props.parent : id;
  const container = outlines.containers.find((c) => c.id === containerId);
  if (!container) return null;
  const sector = slash > 0 ? (sectors[container.id ?? '']?.find((s) => s.id === id) ?? null) : null;
  return { container, zone, sector };
}

const json = (r: Response) => (r.ok ? (r.json() as Promise<Topology>) : Promise.reject(new Error(String(r.status))));

let outlinesAsked: Promise<void> | null = null;

/**
 * The outlines, once: `absent` when a build carries no Zones, as every build did until Starcom's final
 * set was vendored (26 Oct), and `failed` when they did not arrive, in which case the next choice asks again.
 */
export function loadOutlines(): Promise<void> {
  outlinesAsked ??= (async () => {
    mapLayers.zones = 'loading';
    try {
      const r = await fetch(`${ZSP_DIR}outlines.json`);
      if (r.status === 404) {
        mapLayers.zones = 'absent';
        return;
      }
      layerData.outlines = outlinesOf(await json(r));
      loaded();
      mapLayers.zones = 'ready';
    } catch {
      mapLayers.zones = 'failed';
      outlinesAsked = null;
    }
  })();
  return outlinesAsked;
}

const asked = new Map<string, Promise<void>>();

/** Opens a container: its Sectors' file, fetched once, and only for a container that has Sectors yet. */
export function openContainer(id: string): Promise<void> {
  const known = asked.get(id);
  if (known) return known;
  const set = (state: Loading) => {
    const was = layerData.opening[id];
    layerData.opening = { ...layerData.opening, [id]: state };
    // A first opening reads as loading with nothing set, and saying so again only drew the map once more.
    if (state !== 'loading' || was !== undefined) loaded();
  };
  const run = (async () => {
    await loadOutlines();
    const entry = layerData.outlines?.navcom.containers.find((c) => c.id === id);
    if (!entry || entry.sectors === 0) {
      set('absent');
      return;
    }
    set('loading');
    try {
      const topology = await json(await fetch(`${ZSP_DIR}${entry.file}`));
      const shapes = sectorsOf(topology);
      sectorEdges[id] = edgesOf(topology, 'sectors');
      // Its own drift, before its Sectors, so whatever counts them never reads one without the other.
      layerData.sectorDrift = { ...layerData.sectorDrift, [id]: (topology.navcom as { simplified_m?: number } | undefined)?.simplified_m };
      layerData.sectors = { ...layerData.sectors, [id]: shapes };
      set('ready');
    } catch {
      set('failed');
      asked.delete(id);
    }
  })();
  asked.set(id, run);
  return run;
}

// ─── On the map ───────────────────────────────────────────────────────────────────────────────

/** An opened container's Sector edges, each once, beside its shapes in `layerData.sectors`. */
const sectorEdges: Record<string, Ring[]> = {};

/**
 * One edge with the points it can lose at this zoom gone, Douglas–Peucker, in the map's projected units:
 * none moves more than `tol`, and both ends stay, so two areas' shared edge, thinned once, still meets
 * at their corners. For drawing only. Starcom's points are 8 km apart and a pixel at the whole Earth is
 * about 100 km, so stroked whole, a dozen points a pixel: opening Mare Pacificum at a sixth of the speed
 * was three tasks of 200 ms, nearly all of it rastering lines nobody could see (26 Oct). What a tap,
 * the lookup and a count read are the shapes themselves, every point.
 */
function thin(line: Ring, tol: number): Ring {
  const n = line.length / 2;
  if (n <= 2) return line;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [0, n - 1];
  while (stack.length > 0) {
    const b = stack.pop()!, a = stack.pop()!;
    const ax = line[2 * a]!, ay = line[2 * a + 1]!, dx = line[2 * b]! - ax, dy = line[2 * b + 1]! - ay, len = dx * dx + dy * dy;
    let far = -1, worst = tol * tol;
    for (let i = a + 1; i < b; i++) {
      const px = line[2 * i]! - ax, py = line[2 * i + 1]! - ay;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len));
      const d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d > worst) [worst, far] = [d, i];
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push(a, far, far, b);
    }
  }
  return Float32Array.from(Array.from({ length: n }, (_, i) => i).filter((i) => keep[i]).flatMap((i) => [line[2 * i]!, line[2 * i + 1]!]));
}

/** A set of edges, each with its box, west, north, east, south, in projected units, and thinned once for each doubling of zoom. */
interface Edges {
  lines: readonly Ring[];
  boxes: Float32Array;
  thinned: Map<number, Ring[]>;
}
const edgesFor = (lines: readonly Ring[]): Edges => {
  const boxes = new Float32Array(lines.length * 4);
  lines.forEach((r, k) => {
    let [w, n, e, s] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < r.length; i += 2) [w, e, n, s] = [Math.min(w, r[i]!), Math.max(e, r[i]!), Math.min(n, r[i + 1]!), Math.max(s, r[i + 1]!)];
    boxes.set([w, n, e, s], k * 4);
  });
  return { lines, boxes, thinned: new Map() };
};

/**
 * One set's path for the canvas as it is: at this zoom, no point moved more than a pixel, and only the
 * edges whose box is on the canvas, read back from its own transform. At ×4 most of a whole-Earth
 * partition is off the canvas, and its edges were the stroke that cost most of a frame (26 Oct). Half a
 * pixel kept 5,700 points at the whole Earth, where the draft that drew in time kept 4,100; a pixel keeps
 * 4,700, and a line a pixel wide moved by at most its own width.
 */
function pathOf(set: Edges, ctx: CanvasRenderingContext2D, scale: number): Path2D | null {
  if (set.lines.length === 0) return null;
  const level = Math.floor(Math.log2(scale));
  let lines = set.thinned.get(level);
  if (!lines) set.thinned.set(level, (lines = set.lines.map((l) => thin(l, 1 / 2 ** (level + 1)))));
  const m = ctx.getTransform().inverse();
  const [a, b] = [m.transformPoint({ x: 0, y: 0 }), m.transformPoint({ x: ctx.canvas.width, y: ctx.canvas.height })];
  const p = new Path2D();
  lines.forEach((r, k) => {
    const [w, n, e, s] = set.boxes.subarray(k * 4, k * 4 + 4);
    if (w! > Math.max(a.x, b.x) || e! < Math.min(a.x, b.x) || n! > Math.max(a.y, b.y) || s! < Math.min(a.y, b.y)) return;
    p.moveTo(r[0]!, r[1]!);
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i]!, r[i + 1]!);
  });
  return p;
}

/** Each set of edges, rebuilt only when what it is drawn from changes, and how many times each has been. */
let drawnFrom: { outlines: ZonesOutlines | null; sectors: Record<string, Shape[]> } = { outlines: null, sectors: {} };
const stamps = { outlines: 0, sectors: 0 };
let drawn: { containers: Edges; zones: Edges; sectors: Edges; opened: Shape[] } = {
  containers: edgesFor([]),
  zones: edgesFor([]),
  sectors: edgesFor([]),
  opened: []
};
function sync() {
  const { outlines, sectors } = layerData;
  if (outlines === drawnFrom.outlines && sectors === drawnFrom.sectors) return;
  if (outlines !== drawnFrom.outlines) stamps.outlines++;
  if (sectors !== drawnFrom.sectors) stamps.sectors++;
  drawn = {
    containers: outlines === drawnFrom.outlines ? drawn.containers : edgesFor(outlines?.edges.containers ?? []),
    zones: outlines === drawnFrom.outlines ? drawn.zones : edgesFor(outlines?.edges.zones ?? []),
    sectors: edgesFor(Object.keys(sectors).flatMap((id) => sectorEdges[id] ?? [])),
    opened: Object.values(sectors).flat()
  };
  drawnFrom = { outlines, sectors };
}

/** The lines themselves, in three weights. */
function strokes(ctx: CanvasRenderingContext2D, scale: number, ink: Ink) {
  const at = {
    sectors: scale >= 1500 ? pathOf(drawn.sectors, ctx, scale) : null,
    zones: pathOf(drawn.zones, ctx, scale),
    containers: pathOf(drawn.containers, ctx, scale)
  };
  /*
   * Three weights and no hue, over the coast: a container's edge heaviest; a Zone's lighter; a
   * Sector's thin and dashed, once the world is 1,500 px wide (about ×4 on a phone), about 23 km a
   * pixel, where a Sector of 50,000 km² or more is ten pixels or more across. A Sector's edge in the
   * faintest line was not there at ×9. Never in ink, which is what a hover or a tap lifts.
   */
  for (const [path, width, colour] of [
    [at.sectors, 0.8, ink.strong],
    [at.zones, 1, ink.strong],
    [at.containers, 1.5, ink.muted]
  ] as const) {
    if (!path) continue;
    ctx.lineWidth = width / scale;
    ctx.strokeStyle = colour;
    if (path === at.sectors) ctx.setLineDash([4 / scale, 3 / scale]);
    ctx.stroke(path);
    ctx.setLineDash([]);
  }
}

/** The lines as last drawn, kept on a canvas of their own, and when to let them go. */
let kept: { key: string; canvas: HTMLCanvasElement } | null = null;
let letGo: ReturnType<typeof setTimeout> | undefined;

export const layer: DrawnLayer = {
  load: () => void loadOutlines(),
  lines(ctx, scale, ink) {
    sync();
    /*
     * Kept as a picture of their own, and drawn again only when the canvas has moved, what they are drawn
     * from has changed, or the inks have: the map draws its picture again for anything a layer loads,
     * and opening a Terra or Mare at the whole Earth drew it twice with every line where it was. Let go
     * after half a minute without a frame, so a layer chosen and left holds no canvas.
     */
    const m = ctx.getTransform();
    const key = [m.a, m.b, m.c, m.d, m.e, m.f, ctx.canvas.width, ctx.canvas.height, ink.strong, ink.muted, stamps.outlines, scale >= 1500 ? stamps.sectors : -1].join();
    clearTimeout(letGo);
    letGo = setTimeout(() => (kept = null), 30_000);
    if (kept?.key !== key) {
      const canvas = kept?.canvas ?? document.createElement('canvas');
      if (canvas.width !== ctx.canvas.width || canvas.height !== ctx.canvas.height) [canvas.width, canvas.height] = [ctx.canvas.width, ctx.canvas.height];
      const c = canvas.getContext('2d')!;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.setTransform(m);
      c.lineJoin = ctx.lineJoin;
      strokes(c, scale, ink);
      kept = { key, canvas };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(kept.canvas, 0, 0);
    ctx.restore();
  },
  hit(v, at) {
    const o = layerData.outlines;
    if (!o) return undefined;
    sync();
    // The Sector of an opened container, else the Zone, else its Terra or Mare.
    return areaAt(v, at, drawn.opened) ?? areaAt(v, at, o.zones) ?? areaAt(v, at, o.containers);
  },
  say(shape) {
    const c = layerData.outlines ? chainOf(layerData.outlines, shape.id ?? '', layerData.sectors) : null;
    if (c?.sector) return `${c.sector.name} · ${c.zone?.name}`;
    if (c?.zone) return `${c.zone.name} · ${c.container.name}`;
    return shape.name ?? 'Unnamed';
  },
  open: (shape) => ({ kind: 'zone', id: shape.id ?? '' }),
  // One short line in the key, the draft's stage in it (D6); the credit CC BY asks for is over the map's foot.
  legend() {
    const n = layerData.outlines?.navcom;
    if (mapLayers.zones === 'absent') return 'Zones · not in this build yet';
    if (!n) return 'Zones · loading';
    return n.draft ? `Zones · draft ${n.stage}, view only` : 'Zones';
  },
  credit() {
    const n = layerData.outlines?.navcom;
    return n ? `${n.draft ? `draft, stage ${n.stage}, view only · ` : ''}${n.credit}, CC BY 4.0` : '';
  },
  attribution() {
    const n = layerData.outlines?.navcom;
    return n ? `Zones: ${n.credit}, CC BY 4.0` : '';
  },
  lifted(current) {
    const top = current as { kind?: unknown; id?: unknown } | null;
    const id = top?.kind === 'zone' && typeof top.id === 'string' ? top.id : null;
    const c = id && layerData.outlines ? chainOf(layerData.outlines, id, layerData.sectors) : null;
    return c ? (id!.includes('/sector:') ? c.sector : (c.zone ?? c.container)) : null;
  }
};
