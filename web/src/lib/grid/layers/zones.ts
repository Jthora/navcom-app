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

import { areaAt, decode, type Shape, type Topology } from '../topology';
import { ZSP_DIR, layerData, loaded, mapLayers, type DrawnLayer, type Loading } from '../layer.svelte';

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
   * How far the simplified outlines drift from the source at worst, in metres, as the vendoring measured
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
}

/** The outlines file, decoded and projected for drawing. */
export function outlinesOf(topology: Topology): ZonesOutlines {
  const layers = decode(topology);
  return {
    navcom: topology.navcom as unknown as ZspProvenance,
    containers: layers['containers']?.shapes ?? [],
    zones: layers['zones']?.shapes ?? []
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
 * The outlines, once: `absent` when this build carries no Zones yet, which until Stage 1 is vendored
 * is every build, and `failed` when they did not arrive, in which case the next choice asks again.
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
    layerData.opening = { ...layerData.opening, [id]: state };
    loaded();
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

function pathOf(shapes: readonly Shape[]): Path2D | null {
  if (shapes.length === 0) return null;
  const p = new Path2D();
  for (const s of shapes) {
    for (const r of s.rings) {
      p.moveTo(r[0]!, r[1]!);
      for (let i = 2; i < r.length; i += 2) p.lineTo(r[i]!, r[i + 1]!);
      p.closePath();
    }
  }
  return p;
}

/** Each set of lines, rebuilt only when what it is drawn from changes. */
let drawnFrom: { outlines: ZonesOutlines | null; sectors: Record<string, Shape[]> } = { outlines: null, sectors: {} };
let drawn: { containers: Path2D | null; zones: Path2D | null; sectors: Path2D | null; opened: Shape[] } = { containers: null, zones: null, sectors: null, opened: [] };
function sync() {
  const { outlines, sectors } = layerData;
  if (outlines === drawnFrom.outlines && sectors === drawnFrom.sectors) return;
  const opened = Object.values(sectors).flat();
  drawn = { containers: pathOf(outlines?.containers ?? []), zones: pathOf(outlines?.zones ?? []), sectors: pathOf(opened), opened };
  drawnFrom = { outlines, sectors };
}

export const layer: DrawnLayer = {
  load: () => void loadOutlines(),
  lines(ctx, scale, ink) {
    sync();
    // Three weights and no hue: a container's edge heaviest, a Zone's lighter, a Sector's faint.
    for (const [path, width, colour] of [
      [drawn.sectors, 0.6, ink.line],
      [drawn.zones, 1, ink.strong],
      [drawn.containers, 1.75, ink.muted]
    ] as const) {
      if (!path) continue;
      ctx.lineWidth = width / scale;
      ctx.strokeStyle = colour;
      ctx.stroke(path);
    }
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
  legend() {
    const n = layerData.outlines?.navcom;
    if (mapLayers.zones === 'absent') return 'Zones · not in this build yet';
    if (!n) return 'Zones · loading';
    return n.draft ? `Zones · draft, stage ${n.stage}, view only · ${n.credit}, CC BY 4.0` : `Zones · ${n.credit}, CC BY 4.0`;
  },
  lifted(current) {
    const top = current as { kind?: unknown; id?: unknown } | null;
    const id = top?.kind === 'zone' && typeof top.id === 'string' ? top.id : null;
    const c = id && layerData.outlines ? chainOf(layerData.outlines, id, layerData.sectors) : null;
    return c ? (id!.includes('/sector:') ? c.sector : (c.zone ?? c.container)) : null;
  }
};
