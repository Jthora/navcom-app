/**
 * Rings in longitude and latitude, as ZSP 2.0 draws them: WGS 84, split at the antimeridian, and a
 * ring that meets a pole runs along it [RFC 7946 §3.1.9]. Never projected, because the partition runs
 * pole to pole and a projection that stops short of one (Web Mercator stopped at 85°) cannot place
 * what is past it.
 *
 * A ring is packed as lon0, lat0, lon1, lat1, … and closed: its last point is its first. Float32 is
 * enough for a ring decoded from a quantised file on the phone, about 2 m at a longitude of 180°.
 */

export type LonLatRing = Float64Array | Float32Array;
/** West, south, east, north, in degrees. */
export type LonLatBox = [number, number, number, number];

/** The radius the published areas are measured with: WGS 84's equatorial, as Starcom's checks measure them. */
const R = 6_378_137;
/** The Earth's whole surface, in square metres, at that radius. */
export const EARTH_AREA = 4 * Math.PI * R * R;

const RAD = Math.PI / 180;

/**
 * A ring's area on the sphere, in square metres, positive when it runs counter-clockwise as RFC 7946
 * winds an outer ring. Each edge is taken along its own segment in longitude and latitude, which for a
 * box is the box's exact area [the spherical-excess sum of Chamberlain and Duquette, 2007].
 */
export function ringArea(ring: LonLatRing): number {
  let sum = 0;
  for (let i = 0; i + 3 < ring.length; i += 2) {
    sum += (ring[i + 2]! - ring[i]!) * RAD * (2 + Math.sin(ring[i + 1]! * RAD) + Math.sin(ring[i + 3]! * RAD));
  }
  return (-sum * R * R) / 2;
}

/** A polygon's area: its outer rings' less its holes', each ring signed by its winding. */
export function areaOf(rings: readonly LonLatRing[]): number {
  let a = 0;
  for (const r of rings) a += ringArea(r);
  return a;
}

/** The box round every ring. */
export function boxOf(rings: readonly LonLatRing[]): LonLatBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      if (r[i]! < w) w = r[i]!;
      if (r[i]! > e) e = r[i]!;
      if (r[i + 1]! < s) s = r[i + 1]!;
      if (r[i + 1]! > n) n = r[i + 1]!;
    }
  }
  return [w, s, e, n];
}

/**
 * Whether a point is inside: even-odd across every ring, with each crossing counted on one side
 * only, so a point on the edge two neighbours share is in exactly one of them.
 */
export function holds(rings: readonly LonLatRing[], lon: number, lat: number): boolean {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/**
 * How far a point is from the nearest edge, in metres, measured flat around the point: ample at the
 * kilometre this is asked about. An edge on the antimeridian is a seam, not an edge, when the same
 * shape continues on its other side, so a caller asking about neighbours passes `seams: false`.
 */
export function edgeMetres(rings: readonly LonLatRing[], lon: number, lat: number, seams = true): number {
  const kx = 111_320 * Math.max(Math.cos(lat * RAD), 1e-6);
  const ky = 110_574;
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j]!, ay = r[j + 1]!, bx = r[i]!, by = r[i + 1]!;
      if (!seams && Math.abs(ax) === 180 && ax === bx) continue;
      const px = (ax - lon) * kx, py = (ay - lat) * ky;
      const dx = (bx - ax) * kx, dy = (by - ay) * ky;
      const len = dx * dx + dy * dy;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(px * dx + py * dy) / len));
      const d = Math.hypot(px + t * dx, py + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Where a line at constant latitude (`across`) or longitude crosses the rings' edges, sorted. */
function crossings(rings: readonly LonLatRing[], at: number, across: boolean): number[] {
  const out: number[] = [];
  const [u, v] = across ? [1, 0] : [0, 1];
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const a = r[j + u]!, b = r[i + u]!;
      if (a > at !== b > at) out.push(r[j + v]! + ((r[i + v]! - r[j + v]!) * (at - a)) / (b - a));
    }
  }
  return out.sort((x, y) => x - y);
}

/**
 * A point inside a shape to hang a label on, to two places: as far in from its edges as a search along
 * 32 parallels finds. On each parallel, each stretch inside the shape (even-odd, so a hole is outside
 * and both halves of a shape split at the antimeridian count); at each stretch's middle, the stretch
 * inside along that meridian. Each middle is a candidate, and the one farthest from every edge, on the
 * ground, is the point. A box's centre, or the mean of the vertices, can fall outside a coastline; a cap
 * that runs along a pole is labelled halfway to it, not on it. Scored by the two stretches' lengths
 * until 26 Oct, a shape whose edge ran along a meridian (Starcom's are drawn on a 0.1° grid) put its
 * point on that edge: the Black Sea's Sector was labelled 0 m from its own line.
 */
export function labelPoint(rings: readonly LonLatRing[]): [number, number] {
  const [w, s, e, n] = boxOf(rings);
  let best: [number, number] = [(w + e) / 2, (s + n) / 2];
  let score = -Infinity;
  const steps = 32;
  const consider = (lon: number, lat: number) => {
    const clear = edgeMetres(rings, lon, lat);
    if (clear > score && holds(rings, lon, lat)) {
      score = clear;
      best = [lon, lat];
    }
  };
  for (let k = 0; k < steps; k++) {
    const lat = s + ((n - s) * (k + 0.5)) / steps + 1e-9;
    const xs = crossings(rings, lat, true);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const lon = (xs[i]! + xs[i + 1]!) / 2;
      consider(lon, lat);
      const ys = crossings(rings, lon, false);
      for (let j = 0; j + 1 < ys.length; j += 2) {
        if (ys[j]! > lat || ys[j + 1]! < lat) continue;
        consider(lon, (ys[j]! + ys[j + 1]!) / 2);
      }
    }
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  const rounded: [number, number] = [round(best[0]), round(best[1])];
  return holds(rings, ...rounded) ? rounded : best;
}

/** Whether segments ab and cd cross, touching at an end excepted. */
function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy), o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return true;
  // Collinear and overlapping: a ring that runs back over itself.
  if (o1 === 0 && o2 === 0) {
    const between = (p: number, q: number, r: number) => Math.min(p, q) < r && r < Math.max(p, q);
    const sameX = ax === bx;
    return sameX ? between(ay, by, cy) || between(ay, by, dy) : between(ax, bx, cx) || between(ax, bx, dx);
  }
  return false;
}

/**
 * Whether a ring crosses itself. Segments are bucketed into a coarse grid of cells first and only
 * those sharing a cell compared, so a container's outline of tens of thousands of points is checked in
 * a moment rather than in a quadrillion comparisons.
 */
export function selfCrosses(ring: LonLatRing): boolean {
  const n = ring.length / 2 - 1;
  if (n < 3) return false;
  const [w, s, e, nn] = boxOf([ring]);
  const cells = Math.max(1, Math.ceil(Math.sqrt(n)));
  const cw = (e - w) / cells || 1;
  const ch = (nn - s) / cells || 1;
  const grid = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const x0 = ring[2 * k]!, y0 = ring[2 * k + 1]!, x1 = ring[2 * k + 2]!, y1 = ring[2 * k + 3]!;
    const c0 = Math.min(cells - 1, Math.floor((Math.min(x0, x1) - w) / cw));
    const c1 = Math.min(cells - 1, Math.floor((Math.max(x0, x1) - w) / cw));
    const r0 = Math.min(cells - 1, Math.floor((Math.min(y0, y1) - s) / ch));
    const r1 = Math.min(cells - 1, Math.floor((Math.max(y0, y1) - s) / ch));
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = r * cells + c;
        const list = grid.get(key);
        if (list) list.push(k);
        else grid.set(key, [k]);
      }
    }
  }
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a]!, j = list[b]!;
        // Neighbours share a point by construction, and so do the first and the last.
        if (Math.abs(i - j) === 1 || (i === 0 && j === n - 1) || (j === 0 && i === n - 1)) continue;
        if (crosses(ring[2 * i]!, ring[2 * i + 1]!, ring[2 * i + 2]!, ring[2 * i + 3]!, ring[2 * j]!, ring[2 * j + 1]!, ring[2 * j + 2]!, ring[2 * j + 3]!)) {
          return true;
        }
      }
    }
  }
  return false;
}
