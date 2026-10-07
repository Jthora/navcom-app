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

type Props = { properties?: { iso_3166_2?: string } };
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

/** One province or country: its ISO 3166-2 code where the file carries one, and its rings. */
export interface Shape {
  /** Lower-case, as a mission files it: `us-ca`. Null where the file has no code. */
  id: string | null;
  rings: Ring[];
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
      shapes.push({ id: g.properties?.iso_3166_2?.toLowerCase() ?? null, rings: own });
    }
    out[name] = { rings, shapes };
  }
  return out;
}
