/**
 * The grid's geometry, decoded and projected once.
 *
 * `static/grid/world.json` is quantised TopoJSON: shared borders stored once as delta-encoded
 * integer arcs, which is most of why the whole world fits in 55 KB. This turns it into rings of
 * projected points the canvas can draw without doing any trigonometry per frame — the device
 * floor is a prepaid Android 8, and a map that projects every vertex on every pan is a map that
 * stutters under somebody's thumb.
 *
 * Pure: no DOM, no fetch. Tested directly. [docs/design/map.md §3]
 */

/** Web Mercator's own limit: beyond this the projection runs to infinity. */
export const MAX_LAT = 85.05112878;

/**
 * Longitude and latitude to Web Mercator, as a unit square: x and y in [0, 1], y downward.
 *
 * Mercator is wrong for a world view and is used anyway, because a road layer has to line up
 * with this one at the same viewport, and every road layer is Mercator. [map.md §3]
 */
export function mercator(lon: number, lat: number): [number, number] {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2];
}

/** The inverse, for turning a tap back into a place. */
export function unmercator(x: number, y: number): [number, number] {
  const lon = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lon, lat];
}

/**
 * What the generator keeps on each shape: a province's ISO 3166-2 code and name, a country's
 * ISO 3166-1 alpha-2 code lower-cased, and a name only for a country with no code
 * [scripts/grid-geometry.mjs].
 */
type Props = { properties?: { iso_3166_2?: string; iso_a2?: string | null; name?: string } };
type Polygon = { type: 'Polygon'; arcs: number[][] } & Props;
type MultiPolygon = { type: 'MultiPolygon'; arcs: number[][][] } & Props;
type Empty = { type: null } & Props;

export interface Topology {
  type: 'Topology';
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, { type: 'GeometryCollection'; geometries: (Polygon | MultiPolygon | Empty)[] }>;
  /** What the generator recorded about this file. See `scripts/grid-geometry.mjs`. */
  navcom?: { source: string; simplify: string; regionCountries: string[]; provincesFor: string[] };
}

/** A closed ring of projected points, packed as x0, y0, x1, y1, … in the unit square. */
export type Ring = Float32Array;

/** One province or country: its code where the file carries one, its name, and its rings. */
export interface Shape {
  /**
   * Lower-case, as a mission files it: `us-ca` for a province, `ke` for a country. Null where the
   * file has no code, which for a country means a disputed one Natural Earth leaves uncoded.
   */
  id: string | null;
  /** What a hover or a tap says is here. Null only if the file and the phone both lack one. */
  name: string | null;
  rings: Ring[];
  /** The box around every ring, in the unit square: x0, y0, x1, y1. A cheap test before a costly one. */
  bbox: [number, number, number, number];
}

let regions: Intl.DisplayNames | null | undefined;
/**
 * A country's name from its code, in English, from the phone's own tables: `ke` → `Kenya`. The file
 * carries no country names, which saves every visit 1.1 KB [grid-geometry.mjs]. Null where the
 * phone has no such table or no name for the code, and never a guess.
 */
export function countryName(code: string): string | null {
  if (regions === undefined) {
    try {
      regions = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regions = null;
    }
  }
  try {
    const name = regions?.of(code.toUpperCase());
    return name && name.toLowerCase() !== code.toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

/**
 * Whether a mission filed under `jurisdiction` belongs to the place `code`, by the codes alone —
 * the place screen's whole test and the map's count, because a jurisdiction is a fact and a drawn
 * border is not [map.md §3]. A country holds its subdivisions (`ke-30` is in `ke`), and a national
 * mission is filed for every province of its country (`us` is in `us-ca`).
 */
export function filedUnder(jurisdiction: string | null, code: string): boolean {
  if (!jurisdiction) return false;
  if (jurisdiction === code) return true;
  const [country, sub] = code.split('-');
  return sub === undefined ? jurisdiction.startsWith(`${code}-`) : jurisdiction === country;
}

/**
 * What the open missions light, by the codes they are filed under [map.md §6: every mission lands
 * somewhere]. `fill` is a province the file has, or the country of a subdivision it has none for
 * (`ke-30` fills `ke`); `outline` is a country filed nationally, outlined because filling it would
 * light everything.
 *
 * **Only `fill` outranks a province under a tap** [pick.ts]. An outline holds every province inside
 * it, so letting it answer first opened the United States for a tap on Texas whenever a national
 * mission was open (review, 2026-10-18). Falling through loses nothing: Texas's screen lists the
 * national mission, because `us` is filed under `us-tx`.
 */
export function lightsOf(
  jurisdictions: Iterable<string | null>,
  provinceIds: ReadonlySet<string | null>
): { fill: Set<string>; outline: Set<string> } {
  const fill = new Set<string>();
  const outline = new Set<string>();
  for (const j of jurisdictions) {
    if (!j) continue;
    if (!j.includes('-')) outline.add(j);
    else fill.add(provinceIds.has(j) ? j : j.split('-')[0]!);
  }
  return { fill, outline };
}

function boxOf(rings: readonly Ring[]): Shape['bbox'] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      if (r[i]! < x0) x0 = r[i]!;
      if (r[i]! > x1) x1 = r[i]!;
      if (r[i + 1]! < y0) y0 = r[i + 1]!;
      if (r[i + 1]! > y1) y1 = r[i + 1]!;
    }
  }
  return [x0, y0, x1, y1];
}

/** Every ring in one layer, and the same rings grouped by shape so one can be picked out. */
export interface Layer {
  rings: Ring[];
  shapes: Shape[];
}

/** Arcs from delta-encoded integers to absolute longitude and latitude. */
function absoluteArcs(topology: Topology): number[][][] {
  const t = topology.transform;
  if (!t) return topology.arcs;
  const [sx, sy] = t.scale;
  const [tx, ty] = t.translate;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx!;
      y += dy!;
      return [x * sx + tx, y * sy + ty];
    });
  });
}

/**
 * Stitches arc indices into one ring.
 *
 * A negative index `~i` means arc `i` walked backwards, which is how a border shared by two
 * shapes is stored once and used by both. Consecutive arcs share an endpoint, so every arc after
 * the first contributes all but its first point.
 */
function stitch(indices: number[], arcs: number[][][]): Ring {
  const points: number[] = [];
  for (const index of indices) {
    const arc = index >= 0 ? arcs[index]! : [...arcs[~index]!].reverse();
    for (let k = points.length === 0 ? 0 : 1; k < arc.length; k++) {
      const [x, y] = mercator(arc[k]![0]!, arc[k]![1]!);
      points.push(x, y);
    }
  }
  return Float32Array.from(points);
}

/**
 * Whether a projected point is inside a shape: even-odd across every ring, so a hole and an
 * island count the way the fill draws them. How a tap on the map finds the province under it.
 */
export function inside(rings: readonly Ring[], [x, y]: readonly [number, number]): boolean {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** Every layer in the file, decoded and projected. */
export function decode(topology: Topology): Record<string, Layer> {
  const arcs = absoluteArcs(topology);
  const out: Record<string, Layer> = {};
  for (const [name, collection] of Object.entries(topology.objects)) {
    const rings: Ring[] = [];
    const shapes: Shape[] = [];
    for (const g of collection.geometries) {
      const own: Ring[] = [];
      if (g.type === 'Polygon') for (const r of g.arcs) own.push(stitch(r, arcs));
      else if (g.type === 'MultiPolygon') for (const p of g.arcs) for (const r of p) own.push(stitch(r, arcs));
      rings.push(...own);
      const p = g.properties ?? {};
      const id = p.iso_3166_2?.toLowerCase() ?? p.iso_a2 ?? null;
      shapes.push({ id, name: p.name ?? (id ? countryName(id) : null), rings: own, bbox: boxOf(own) });
    }
    out[name] = { rings, shapes };
  }
  return out;
}
