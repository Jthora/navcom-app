/**
 * The grid's geometry, decoded and projected once.
 *
 * `static/grid/world.json` is quantised TopoJSON: shared borders stored once as delta-encoded
 * integer arcs, which is most of why the whole world fits in 59 KB. This turns it into rings of
 * projected points the canvas can draw without doing any trigonometry per frame — the device
 * floor is a prepaid Android 8, and a map that projects every vertex on every pan is a map that
 * stutters under somebody's thumb.
 *
 * Pure: no DOM, no fetch. Tested directly. [docs/design/map.md §3]
 */

/*
 * Equal Earth [Šavrič, Patterson and Jenny, 2018], decided 2026-10-18 (D1) in place of Web Mercator.
 *
 * Mercator stopped at 85°, left Antarctica out, and drew Greenland larger than Brazil. Its one reason
 * was a road layer that would have to line up with this one, and that layer was never built
 * [map.md §3, §4]. Starcom's partition runs pole to pole and defines a Sector by its area on the
 * ground, so the grid draws the whole Earth, at its true areas, in one projection everything here
 * shares: the geometry, the points, the tap, and the browser tests that tap by longitude and latitude.
 */
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
/** Half the world's width and height in the projection's own units, Earth radii. */
const X_MAX = Math.PI / (M * A1);
const Y_MAX = yOf(Math.PI / 3);

function yOf(t: number): number {
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  return t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
}

/** How tall the whole world is when it is one unit wide: about 0.487, so a map 2.05 times as wide as it is tall. */
export const HEIGHT = Y_MAX / X_MAX;

/**
 * How many metres on the ground one unit of the map stands for, by area: a circle of r metres is drawn
 * with the area of a circle of `r / METRES_PER_UNIT` units, wherever it is, because the projection is
 * equal-area. About 34,500 km.
 */
export const METRES_PER_UNIT = 2 * X_MAX * 6_371_008.8;

/**
 * Longitude and latitude to Equal Earth, as a rectangle one unit wide and `HEIGHT` tall: x in [0, 1],
 * y in [0, HEIGHT], downward, with the equator across the middle and both poles drawn as lines.
 */
export function project(lon: number, lat: number): [number, number] {
  const phi = (Math.max(-90, Math.min(90, lat)) * Math.PI) / 180;
  const t = Math.asin(M * Math.sin(phi));
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  const x = ((lon * Math.PI) / 180) * Math.cos(t) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  return [(x + X_MAX) / (2 * X_MAX), (Y_MAX - yOf(t)) / (2 * X_MAX)];
}

/**
 * The inverse, for turning a tap back into a place. Newton's method on the latitude, as the authors
 * give it. A point off the edge of the Earth comes back with a longitude beyond ±180, which no place has.
 */
export function unproject(x: number, y: number): [number, number] {
  const px = x * 2 * X_MAX - X_MAX;
  const py = Math.max(-Y_MAX, Math.min(Y_MAX, Y_MAX - y * 2 * X_MAX));
  let t = py;
  for (let i = 0; i < 12; i++) {
    const t2 = t * t;
    const t6 = t2 * t2 * t2;
    const delta = (yOf(t) - py) / (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2));
    t -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  const lam = (M * px * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / Math.cos(t);
  return [(lam * 180) / Math.PI, (Math.asin(Math.min(1, Math.max(-1, Math.sin(t) / M))) * 180) / Math.PI];
}

/** The Earth's own edge, the two halves of the antimeridian from pole to pole: what the map draws round it. */
export function edgeOfEarth(): Ring {
  const out: number[] = [];
  for (let lat = -90; lat <= 90; lat += 2) out.push(...project(-180, lat));
  for (let lat = 90; lat >= -90; lat -= 2) out.push(...project(180, lat));
  return Float32Array.from(out);
}

/**
 * What the generator keeps on each shape: a province's ISO 3166-2 code and name, a country's
 * ISO 3166-1 alpha-2 code lower-cased, and a name only for a country with no code
 * [scripts/grid-geometry.mjs].
 */
type Props = { properties?: { iso_3166_2?: string; iso_a2?: string | null; name?: string; id?: string } & Record<string, unknown> };
type Polygon = { type: 'Polygon'; arcs: number[][] } & Props;
type MultiPolygon = { type: 'MultiPolygon'; arcs: number[][][] } & Props;
type Empty = { type: null } & Props;

export interface Topology {
  type: 'Topology';
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, { type: 'GeometryCollection'; geometries: (Polygon | MultiPolygon | Empty)[] }>;
  /**
   * What the generator recorded about this file: `scripts/grid-geometry.mjs` for the world's and the
   * time zones', `scripts/zsp-vendor.mjs` for the Zones'. Read by each file's own reader and its tests.
   */
  navcom?: Record<string, unknown>;
}

/** A closed ring of projected points, packed as x0, y0, x1, y1, … in the map's unit rectangle [project]. */
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
  /** The box around every ring, in the map's rectangle: x0, y0, x1, y1. A cheap test before a costly one. */
  bbox: [number, number, number, number];
  /** Every property the file gives it, as it gives them: a Zone's parent and system, a time zone's offset. */
  props: Readonly<Record<string, unknown>>;
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
function stitch(indices: number[], arcs: number[][][], toPoint: ToPoint): Ring {
  const points: number[] = [];
  for (const index of indices) {
    const arc = index >= 0 ? arcs[index]! : [...arcs[~index]!].reverse();
    for (let k = points.length === 0 ? 0 : 1; k < arc.length; k++) {
      const [x, y] = toPoint(arc[k]![0]!, arc[k]![1]!);
      points.push(x, y);
    }
  }
  return Float32Array.from(points);
}

/** Where a longitude and latitude goes: onto the map [project] for drawing, or nowhere, for a lookup on the ground. */
export type ToPoint = (lon: number, lat: number) => [number, number];
/** Longitude and latitude as they are, for a lookup that must not be projected: Sectors run to the poles. */
export const lonLat: ToPoint = (lon, lat) => [lon, lat];

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

/**
 * The first of `shapes` holding a point on screen, in a view as `pick.ts` describes one: its box, then
 * its rings. For a layer whose areas tile what they cover, as Starcom's partition and the time zones do,
 * there is one, and no slack is given: a thumb near an edge takes whichever side it is on, and what it
 * took stays lifted while it is open. Here rather than in `pick.ts`, which only the map's own chunk
 * holds, so a layer's code that answers a tap does not pull the map in with it [budget.mjs MAP_LINES].
 */
export function areaAt(
  v: { cx: number; cy: number; scale: number; width: number; height: number },
  [sx, sy]: readonly [number, number],
  shapes: readonly Shape[]
): Shape | null {
  if (v.scale <= 0) return null;
  const x = v.cx + (sx - v.width / 2) / v.scale;
  const y = v.cy + (sy - v.height / 2) / v.scale;
  for (const s of shapes) {
    const b = s.bbox;
    if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inside(s.rings, [x, y])) return s;
  }
  return null;
}

/**
 * Every layer in the file, decoded and projected, or decoded and left in longitude and latitude
 * (`lonLat`). A shape's rings are Float32 either way: about 2 m at a longitude of 180°, far finer than
 * any file here was quantised to.
 */
export function decode(topology: Topology, toPoint: ToPoint = project): Record<string, Layer> {
  const arcs = absoluteArcs(topology);
  const out: Record<string, Layer> = {};
  for (const [name, collection] of Object.entries(topology.objects)) {
    const rings: Ring[] = [];
    const shapes: Shape[] = [];
    for (const g of collection.geometries) {
      const own: Ring[] = [];
      if (g.type === 'Polygon') for (const r of g.arcs) own.push(stitch(r, arcs, toPoint));
      else if (g.type === 'MultiPolygon') for (const p of g.arcs) for (const r of p) own.push(stitch(r, arcs, toPoint));
      rings.push(...own);
      const p = g.properties ?? {};
      // A Zone's file names each by its own id; the world's, by its ISO code, which is how a mission files it.
      const id = typeof p.id === 'string' ? p.id : (p.iso_3166_2?.toLowerCase() ?? p.iso_a2 ?? null);
      const named = typeof p.name === 'string' ? p.name : null;
      shapes.push({ id, name: named ?? (id && typeof p.id !== 'string' ? countryName(id) : null), rings: own, bbox: boxOf(own), props: p });
    }
    out[name] = { rings, shapes };
  }
  return out;
}
