/**
 * Open missions counted by Zone and by Sector, on the Zones layer [docs/design/map.md, Missions on
 * Zones]. **Missions only, never people**: a count of packages open in an area, from the missions
 * already on this phone, with the feed's own age.
 *
 * The map line `zone-missions` in `scripts/lib/budget.mjs`: loaded by `import()` when Zones is chosen,
 * and fetching nothing. It reads what the map already holds, `layerData.missions` and the outlines,
 * so no layer's code reads the mission feed itself.
 *
 * **A mission is placed in a Zone by its ring, or by the Zone its package names.** By the ring the map
 * draws where its package locates its subject, at about a kilometre or coarser [places.ts
 * MISSION_FINEST]; with no ring, by Starcom's `zone` and `zone_sector` tags, which a package may carry
 * since interchange rev 9 [mission-interchange.spec.md §4.2]. A mission with neither, filed only by
 * jurisdiction, says which country or province and no Zone: putting it in one would invent a place, so
 * it is counted apart and said to be. A ring wins over a name: the count is of what the map draws.
 *
 * A point is counted in every area whose outline as drawn holds it: its Terra or Mare, its Zone, and
 * an open container's Sector. The outlines are quantised for the phone, so a mission closer to an
 * area's edge than the vendoring measured that file drifts, plus its own precision, is **near that
 * edge**, at that level, with the neighbour across it: the Zones' by `outlines.json`'s drift, a Sector's
 * by its own container file's, which is quantised apart. It is still counted where its drawn point
 * falls, since a count has to fall somewhere, and **the count says so**: its badge is dashed, a hover
 * says how many are near an edge, and the area's screen names each and its neighbour.
 */

import { METRES_PER_UNIT, inside, project, unproject, type Shape } from '../topology';
import { layerData, mapLayers, overlaps, type Box, type Overlay } from '../layer.svelte';
import type { View } from '../pick';
import type { ZonesOutlines } from './zones';

/** What a count needs of a mission's ring: where it is drawn, how coarse it is, and what it opens. */
export interface Placed {
  x: number;
  y: number;
  lon: number;
  lat: number;
  metres: number;
  address: string;
  title: string;
}

/** A mission with no ring whose package names its Zone, and perhaps its Sector, by their ids. */
export interface Named {
  address: string;
  title: string;
  zone: string;
  sector: string | null;
}

export interface Counted {
  /** By area id, at every level it is in: the missions whose drawn point that area's outline holds, or that name it. */
  in: Map<string, { address: string; title: string }[]>;
  /** By area id, at every level it was counted in: a mission near that area's edge, and the neighbours across it. */
  near: Map<string, { mission: Placed; with: string[] }[]>;
  placed: number;
  /** Of `placed`, those counted by the Zone their package names rather than by a ring. */
  named: number;
}

const inBox = (s: Shape, x: number, y: number, pad = 0) => x >= s.bbox[0] - pad && x <= s.bbox[2] + pad && y >= s.bbox[1] - pad && y <= s.bbox[3] + pad;

/** Even-odd across a shape's projected rings, as the map fills it. */
function holds(s: Shape, x: number, y: number): boolean {
  if (!inBox(s, x, y)) return false;
  let c = false;
  for (const r of s.rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** A shape's rings back in longitude and latitude, once, for measuring on the ground. */
const onGround = new WeakMap<Shape, Float64Array[]>();
function groundOf(s: Shape): Float64Array[] {
  let rings = onGround.get(s);
  if (!rings) {
    rings = s.rings.map((r) => {
      const out = new Float64Array(r.length);
      for (let i = 0; i < r.length; i += 2) [out[i], out[i + 1]] = unproject(r[i]!, r[i + 1]!);
      return out;
    });
    onGround.set(s, rings);
  }
  return rings;
}

/**
 * How far (lon, lat) is from a shape's edge, in metres, measured flat around the point. An edge on
 * the antimeridian is a seam where the shape goes on, not an edge.
 */
function edgeMetres(s: Shape, lon: number, lat: number): number {
  const kx = 111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  const ky = 110_574;
  let best = Infinity;
  for (const r of groundOf(s)) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j]!, ay = r[j + 1]!, bx = r[i]!, by = r[i + 1]!;
      if (Math.abs(Math.abs(ax) - 180) < 1e-3 && Math.abs(ax - bx) < 1e-3) continue;
      const px = (ax - lon) * kx, py = (ay - lat) * ky;
      const dx = (bx - ax) * kx, dy = (by - ay) * ky;
      const len = dx * dx + dy * dy;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(px * dx + py * dy) / len));
      best = Math.min(best, Math.hypot(px + t * dx, py + t * dy));
    }
  }
  return best;
}

/**
 * Counts each placed mission in every area that holds its drawn point, and says, at each level, which
 * are near that area's edge. `sectors` are the containers somebody opened, by id: a container's Sectors
 * count only once it is. `sectorDrift` is each opened container file's own drift, as the vendoring
 * measured it; a file from before it was measured is held to the Zones' drift instead.
 */
export function countsOf(
  outlines: ZonesOutlines,
  sectors: Readonly<Record<string, readonly Shape[]>>,
  missions: readonly Placed[],
  sectorDrift: Readonly<Record<string, number | undefined>> = {},
  named: readonly Named[] = []
): Counted {
  const counted: Counted = { in: new Map(), near: new Map(), placed: 0, named: 0 };
  const add = (id: string, m: { address: string; title: string }) => counted.in.set(id, [...(counted.in.get(id) ?? []), m]);
  const drift = outlines.navcom.simplified_m ?? 0;
  /** Near its edge: within what that level's drawn lines drift, plus the mission's own precision. */
  const nearAt = (area: Shape, level: readonly Shape[], m: Placed, metres: number) => {
    const reach = metres + m.metres;
    if (edgeMetres(area, m.lon, m.lat) > reach) return;
    // A box test first, padded by twice the reach in map units: Equal Earth keeps areas, not distances.
    const pad = (2 * reach) / METRES_PER_UNIT;
    const across = level.filter((s) => s !== area && inBox(s, m.x, m.y, pad) && edgeMetres(s, m.lon, m.lat) <= reach).map((s) => s.name ?? s.id ?? '');
    if (across.length > 0) counted.near.set(area.id!, [...(counted.near.get(area.id!) ?? []), { mission: m, with: across }]);
  };
  for (const m of missions) {
    const container = outlines.containers.find((c) => holds(c, m.x, m.y));
    if (!container?.id) continue;
    counted.placed += 1;
    add(container.id, m);
    nearAt(container, outlines.containers, m, drift);
    const zones = outlines.zones.filter((z) => z.props.parent === container.id);
    const zone = zones.find((z) => holds(z, m.x, m.y)) ?? null;
    if (!zone?.id) continue;
    add(zone.id, m);
    nearAt(zone, outlines.zones, m, drift);
    const level = sectors[container.id] ?? [];
    const sector = level.find((s) => s.id?.startsWith(`${zone.id}/`) && holds(s, m.x, m.y)) ?? null;
    if (!sector?.id) continue;
    add(sector.id, m);
    nearAt(sector, level, m, sectorDrift[container.id] ?? drift);
  }
  /*
   * By the name its package gives: in that Zone and its Terra or Mare, and in the Sector it names, near
   * no edge, since its publisher said which. A Zone these outlines do not hold places it nowhere, and
   * it stays with those filed by jurisdiction.
   */
  for (const m of named) {
    const zone = outlines.zones.find((z) => z.id === m.zone);
    const container = zone?.props.parent;
    if (!zone || typeof container !== 'string') continue;
    counted.placed += 1;
    counted.named += 1;
    add(container, m);
    add(m.zone, m);
    if (m.sector?.startsWith(`${m.zone}/`)) add(m.sector, m);
  }
  return counted;
}

/** `1 open mission`, `3 open missions`, `Nothing open`. */
export const openSaid = (n: number) => (n === 0 ? 'Nothing open' : n === 1 ? '1 open mission' : `${n} open missions`);

// ─── On the map ───────────────────────────────────────────────────────────────────────────────

let from: { outlines: ZonesOutlines | null; sectors: Record<string, Shape[]>; missions: unknown } = { outlines: null, sectors: {}, missions: null };
let counted: Counted | null = null;
function sync(): Counted | null {
  const { outlines, sectors, missions, sectorDrift } = layerData;
  if (!outlines || !missions) return null;
  if (outlines !== from.outlines || sectors !== from.sectors || missions.rings !== from.missions) {
    counted = countsOf(outlines, sectors, missions.rings.flatMap((p) => (p.kind === 'mission' ? [p] : [])), sectorDrift, missions.named);
    from = { outlines, sectors, missions: missions.rings };
  }
  return counted;
}

/**
 * A count on the map: a rounded rectangle of the ground, ringed in ink, its figure in ink. Never a hue,
 * and **never a circle, even for one digit**: that is a mission's, and a `1` in a round badge read as
 * one. **Dashed when any mission it counts is near the area's edge**, where the drawn lines cannot say
 * which side it is on.
 */
function badge(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, unsettled: boolean): void {
  const text = n > 99 ? '99+' : String(n);
  const w = Math.max(26, ctx.measureText(text).width + 14);
  const h = 17;
  const [l, t] = [x - w / 2, y - h / 2];
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(l, t, w, h, 4);
  else ctx.rect(l, t, w, h);
  ctx.fill();
  if (unsettled) ctx.setLineDash([3, 2.5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

/**
 * Where an area's count hangs: its label point, from the vendoring, which is worked out on the area's own
 * shape; its box's middle in files without one. The test fixture's Zones are rectangles, so Laurentia
 * West's hangs in the Pacific; a real Zone's is inside it, and a Mare's at sea is where its sea is.
 */
function labelOf(s: Shape): [number, number] {
  const at = s.props.label;
  if (Array.isArray(at) && typeof at[0] === 'number' && typeof at[1] === 'number') return project(at[0], at[1]);
  return [(s.bbox[0] + s.bbox[2]) / 2, (s.bbox[1] + s.bbox[3]) / 2];
}

/** A Sector's count replaces its Zone's once the Sector is this wide on screen, in CSS px. */
const SECTOR_PX = 48;

/** One count as drawn: where, how many, whether any it counts is near an edge, and its box. */
interface Badge {
  id: string;
  x: number;
  y: number;
  n: number;
  unsettled: boolean;
  box: Box;
}

/**
 * Where each count is drawn at this view, in CSS px: once a frame, for drawing it and for keeping the
 * names and Hazards' marks off it, each added to `taken` as it is placed.
 */
function badges(v: View, measure: (text: string) => number, taken: Box[]): Badge[] {
  const c = sync();
  const o = layerData.outlines;
  // Unknown is not none: with the missions not read, no badge is drawn, and the key says why.
  if (!c || !o || layerData.missions?.age == null) return [];
  const shown: [Shape, number][] = [];
  for (const container of o.containers) {
    const zones = o.zones.filter((z) => z.props.parent === container.id);
    if (zones.length === 0) {
      const n = c.in.get(container.id ?? '')?.length ?? 0;
      if (n > 0) shown.push([container, n]);
      continue;
    }
    for (const zone of zones) {
      const n = c.in.get(zone.id ?? '')?.length ?? 0;
      if (n === 0) continue;
      const sectors = (layerData.sectors[container.id ?? ''] ?? []).filter((s) => s.id?.startsWith(`${zone.id}/`) && (c.in.get(s.id)?.length ?? 0) > 0);
      // Only when its Sectors' counts hold all of the Zone's: one that names its Zone and no Sector is in none of them.
      const held = sectors.reduce((k, s) => k + c.in.get(s.id!)!.length, 0) === n;
      const wide = held && sectors.length > 0 && sectors.every((s) => (s.bbox[2] - s.bbox[0]) * v.scale >= SECTOR_PX);
      if (wide) for (const s of sectors) shown.push([s, c.in.get(s.id ?? '')!.length]);
      else shown.push([zone, n]);
    }
  }
  /*
   * Never under a mission's ring, which is drawn over everything, nor over another count or under the
   * key: moved the nearest step off what it would sit under, of a few each way and across, **and only
   * ever to a spot inside its own area**. A count hung on the missions it counts sat squarely under their
   * rings; moved 46 px, which at the whole Earth is about 5,000 km, one sat in the Zone next door (audit,
   * 2026-10-24). Straight up, down or across only, a Zone half a count wide between a ring and the sun
   * had nowhere to go (26 Oct); a step down and a little across had room. Where no step stays inside, it
   * stays at its label point, and the ring is drawn over it.
   */
  const at = (p: { x: number; y: number }): [number, number] => [(p.x - v.cx) * v.scale + v.width / 2, (p.y - v.cy) * v.scale + v.height / 2];
  const covers = layerData.covers;
  const out: Badge[] = [];
  for (const [s, n] of shown) {
    const [ux, uy] = labelOf(s);
    const [x0, y0] = at({ x: ux, y: uy });
    if (x0 < -20 || y0 < -20 || x0 > v.width + 20 || y0 > v.height + 20) continue;
    const w = Math.max(26, measure(String(n)) + 14) / 2 + 2;
    const boxAt = ([x, y]: number[]): Box => ({ l: x! - w, t: y! - 11, r: x! + w, b: y! + 11 });
    const clear = (p: number[]) => {
      const b = boxAt(p);
      return !taken.some((t) => overlaps(b, t)) && !covers.some((t) => overlaps(b, t));
    };
    const ownArea = ([x, y]: number[]) => inside(s.rings, [v.cx + (x! - v.width / 2) / v.scale, v.cy + (y! - v.height / 2) / v.scale]);
    const [x, y] =
      [0, 12, -12, 24, -24, w + 16, -w - 16]
        .flatMap((dx) => [0, 24, -24, 46, -46].map((dy) => [dx, dy]))
        .sort((a, b) => Math.hypot(a[0]!, a[1]!) - Math.hypot(b[0]!, b[1]!))
        .map(([dx, dy]) => [x0 + dx!, y0 + dy!])
        .find((p, i) => clear(p) && (i === 0 || ownArea(p))) ?? [x0, y0];
    const box = boxAt([x!, y!]);
    taken.push(box);
    out.push({ id: s.id ?? '', x: x!, y: y!, n, unsettled: (c.near.get(s.id ?? '')?.length ?? 0) > 0, box });
  }
  return out;
}

/** What `place` laid out for this frame, which `marks` draws. */
let laid: Badge[] = [];

const FONT = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';

export const overlay: Overlay = {
  load: () => void (mapLayers.counts = 'ready'),
  place(ctx, v, taken) {
    ctx.save();
    ctx.font = FONT;
    laid = badges(v, (t) => ctx.measureText(t).width, taken);
    ctx.restore();
    return laid.map((b) => ({ of: b.id, n: b.n, x: b.x, y: b.y, box: b.box }));
  },
  marks(ctx, _v, ink) {
    if (laid.length === 0) return;
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = ink.ground;
    ctx.strokeStyle = ink.ink;
    for (const b of laid) badge(ctx, b.x, b.y, b.n, b.unsettled);
  },
  legend() {
    const m = layerData.missions;
    if (!layerData.outlines) return '';
    if (!m || m.age === null) return 'Missions by Zone · not read yet';
    // The feed's age is the key's missions line; this says what of it is in a Zone, and what is not.
    const c = sync();
    return `Missions in Zones: ${c?.placed ?? 0} · by jurisdiction: ${m.unplaced - (c?.named ?? 0)}`;
  },
  credit() {
    const m = layerData.missions;
    const by = m ? m.unplaced - (sync()?.named ?? 0) : 0;
    return m && m.age !== null ? `missions placed by where each package puts its subject, or the Zone it names; ${by} filed by jurisdiction only, counted apart and in no Zone · ${m.age}` : '';
  },
  about(shape) {
    const c = sync();
    if (!c || layerData.missions?.age == null) return 'missions not read';
    const near = c.near.get(shape.id ?? '')?.length ?? 0;
    return `${openSaid(c.in.get(shape.id ?? '')?.length ?? 0)}${near > 0 ? ` · ${near} near an edge` : ''}`;
  }
};
