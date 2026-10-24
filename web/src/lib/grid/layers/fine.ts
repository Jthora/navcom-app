/**
 * The land at the finer of the world file's two scales, from ×2 in [docs/design/map.md §3]: the map line
 * `fine` in `scripts/lib/budget.mjs`, loaded by `import()` the first time somebody zooms in that far, and
 * never at first paint or mount. It fetches nothing: it is worked out from the file every visit already
 * has, the provinces that file carries for the countries with regions.
 */

import { absoluteArcs, project, stitch, type Ring, type Topology } from '../topology';

/**
 * The land at the finer of the file's two scales [map.md §3]: the world's 1:110m outlines of every
 * country but those it has 1:10m provinces for, whose land is their provinces' instead, and the coast to
 * match. With the land lifted off the sea far enough to read, a 1:110m US under 1:10m states put records
 * in the sea of Delaware Bay and drew Galveston Bay's coast twice (audit, 2026-10-24).
 *
 * `others` are those other countries' rings, closed, projected. `own` is open lines, the provinces' own
 * outer edge where it meets the sea, which is every arc only one province uses **less the stretches along a
 * land border**, within `BORDER_DEG` of an arc the world's file
 * gives a country with provinces and one without. Those borders stay the neighbour's 1:110m line, drawn
 * once, so Canada and Mexico meet the US on one line, not two. `coast` is the others' coast as `coastOf`
 * finds it. `own` and `inner` are kept by country, so a country out of view can be left out whole.
 *
 * **Drawn as few edges as it can be**, since filling every province and stroking every province's whole
 * outline made the frame a gesture ends on 45 ms longer under a CPU six times slower: `outline` is the
 * provinces' union, closed rings of the arcs only one province uses, chained end to start, which is what
 * is filled; and `inner` the arcs two provinces share, the lines between them, which is all the provinces'
 * own lines need to add to the coast and the borders.
 */
const BORDER_DEG = 0.35;
/** Some lines or rings drawn together, and their box in map units, so the map can leave them out whole where they are out of view. */
export interface Group {
  rings: Ring[];
  box: [number, number, number, number];
}
const group = (rings: Ring[]): Group => {
  const box: Group['box'] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (let i = 0; i < r.length; i += 2) [box[0], box[1], box[2], box[3]] = [Math.min(box[0], r[i]!), Math.min(box[1], r[i + 1]!), Math.max(box[2], r[i]!), Math.max(box[3], r[i + 1]!)];
  return { rings, box };
};

/** What `fineOf` works out. */
export interface Fine {
  fine: Set<string>;
  others: Group[];
  outline: Group[];
  inner: Group[];
  coast: Group[];
  own: Group[];
}

export function fineOf(topology: Topology): Fine {
  const arcs = absoluteArcs(topology);
  const owners = (object: string, key: (p: Record<string, unknown>) => string) => {
    const uses = new Map<number, string[]>();
    const walk = (a: unknown, who: string): void => {
      if (typeof a === 'number') uses.set(a < 0 ? ~a : a, [...(uses.get(a < 0 ? ~a : a) ?? []), who]);
      else if (Array.isArray(a)) a.forEach((x) => walk(x, who));
    };
    for (const g of topology.objects[object]?.geometries ?? []) if (g.type) walk(g.arcs, key(g.properties ?? {}));
    return uses;
  };
  const provinces = owners('provinces', (p) => String(p.iso_3166_2 ?? '').split('-')[0]!.toLowerCase());
  const fine = new Set([...provinces.values()].flat());
  const world = owners('world', (p) => String(p.iso_a2 ?? ''));
  // The land borders between a country with provinces and one without, as segments in a 1° grid.
  const grid = new Map<string, number[][]>();
  for (const [i, who] of world) {
    if (who.length !== 2 || who.filter((c) => fine.has(c)).length !== 1) continue;
    const a = arcs[i]!;
    for (let k = 1; k < a.length; k++) {
      const seg = [a[k - 1]![0]!, a[k - 1]![1]!, a[k]![0]!, a[k]![1]!];
      for (let x = Math.floor(Math.min(seg[0]!, seg[2]!) - BORDER_DEG); x <= Math.max(seg[0]!, seg[2]!) + BORDER_DEG; x++)
        for (let y = Math.floor(Math.min(seg[1]!, seg[3]!) - BORDER_DEG); y <= Math.max(seg[1]!, seg[3]!) + BORDER_DEG; y++) grid.set(`${x} ${y}`, [...(grid.get(`${x} ${y}`) ?? []), seg]);
    }
  }
  const onBorder = ([x, y]: number[]): boolean =>
    (grid.get(`${Math.floor(x!)} ${Math.floor(y!)}`) ?? []).some(([ax, ay, bx, by]) => {
      const [dx, dy] = [bx! - ax!, by! - ay!];
      const t = Math.max(0, Math.min(1, ((x! - ax!) * dx + (y! - ay!) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x! - ax! - t * dx, y! - ay! - t * dy) < BORDER_DEG;
    });
  const line = (pts: number[][]) => Float32Array.from(pts.flatMap(([lon, lat]) => project(lon!, lat!)));
  // Each country's own lines kept together, so the map can leave out a country that is not in view.
  const byCountry = new Map<string, Ring[]>();
  const of = (code: string) => byCountry.get(code) ?? (byCountry.set(code, []).get(code) as Ring[]);
  for (const [i, who] of provinces) {
    if (who.length !== 1) continue;
    // Runs of the arc's segments that are not along a land border: a segment is, where both its ends are.
    const a = arcs[i]!;
    const near = a.map(onBorder);
    let run: number[][] = [];
    for (let k = 0; k < a.length; k++) {
      if (k > 0 && near[k - 1] && near[k]) {
        if (run.length > 1) of(who[0]!).push(line(run));
        run = [];
      }
      run.push(a[k]!);
    }
    if (run.length > 1) of(who[0]!).push(line(run));
  }
  const own = [...byCountry.values()];
  const coast: Ring[] = [];
  for (const [i, who] of world) if (who.length === 1 && !fine.has(who[0]!)) coast.push(line(arcs[i]!));
  const others: Ring[] = [];
  for (const g of topology.objects['world']?.geometries ?? []) {
    if (fine.has(String(g.properties?.iso_a2 ?? ''))) continue;
    if (g.type === 'Polygon') for (const r of g.arcs) others.push(stitch(r, arcs, project));
    else if (g.type === 'MultiPolygon') for (const p of g.arcs) for (const r of p) others.push(stitch(r, arcs, project));
  }
  // The union: each arc one province uses, the way its ring walks it, chained from where one ends to where the next starts.
  const signed = new Map<number, number>();
  for (const g of topology.objects['provinces']?.geometries ?? []) {
    const rings = g.type === 'Polygon' ? g.arcs : g.type === 'MultiPolygon' ? g.arcs.flat() : [];
    for (const ring of rings) for (const ref of ring) if (provinces.get(ref < 0 ? ~ref : ref)?.length === 1) signed.set(ref < 0 ? ~ref : ref, ref);
  }
  const walked = (ref: number) => (ref >= 0 ? arcs[ref]! : [...arcs[~ref]!].reverse());
  const at = (p: number[]) => `${p[0]} ${p[1]}`;
  const starts = new Map<string, number[]>();
  for (const ref of signed.values()) starts.set(at(walked(ref)[0]!), [...(starts.get(at(walked(ref)[0]!)) ?? []), ref]);
  const outline: Ring[] = [];
  const done = new Set<number>();
  for (const first of signed.values()) {
    if (done.has(first)) continue;
    const ring: number[][] = [];
    for (let ref: number | undefined = first; ref !== undefined && !done.has(ref); ) {
      done.add(ref);
      const p = walked(ref);
      ring.push(...(ring.length === 0 ? p : p.slice(1)));
      ref = starts.get(at(p.at(-1)!))?.find((n) => !done.has(n));
    }
    outline.push(line(ring));
  }
  const between = new Map<string, Ring[]>();
  for (const [i, who] of provinces) if (who.length > 1) between.set(who[0]!, [...(between.get(who[0]!) ?? []), line(arcs[i]!)]);
  const inner = [...between.values()];
  const one = (rings: Ring[]) => rings.map((r) => group([r]));
  return { fine, others: one(others), outline: one(outline), inner: inner.map(group), coast: one(coast), own: own.map(group) };
}
