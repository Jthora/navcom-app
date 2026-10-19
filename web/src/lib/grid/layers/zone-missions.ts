/**
 * Open missions counted by Zone and by Sector, on the Zones layer [docs/design/map.md, Missions on
 * Zones]. **Missions only, never people**: a count of packages open in an area, from the missions
 * already on this phone, with the feed's own age.
 *
 * The map line `zone-missions` in `scripts/lib/budget.mjs`: loaded by `import()` when Zones is chosen,
 * and fetching nothing. It reads what the map already holds, `layerData.missions` and the outlines,
 * so no layer's code reads the mission feed itself.
 *
 * **Only a mission whose package locates its subject can be placed in a Zone**, by the ring the map
 * draws for it, at about a kilometre or coarser [places.ts MISSION_FINEST]. A mission filed only by
 * jurisdiction says which country or province, and no Zone: putting it in one would invent a place,
 * so it is counted apart and said to be. NavCom's packages carry no Zone of their own.
 *
 * A point is counted in every area whose outline as drawn holds it: its Terra or Mare, its Zone, and
 * an open container's Sector. The outlines are simplified for the world view, so a mission closer to an
 * area's edge than the vendoring measured that file drifts, plus its own precision, is **near that
 * edge**, at that level, with the neighbour across it: the Zones' by `outlines.json`'s drift, a Sector's
 * by its own container file's, which is simplified apart. It is still counted where its drawn point
 * falls, since a count has to fall somewhere, and **the count says so**: its badge is dashed, a hover
 * says how many are near an edge, and the area's screen names each and its neighbour.
 */

import { METRES_PER_UNIT, project, unproject, type Shape } from '../topology';
import { layerData, mapLayers, type Overlay } from '../layer.svelte';
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

export interface Counted {
  /** By area id, at every level it is in: the missions whose drawn point that area's outline holds. */
  in: Map<string, Placed[]>;
  /** By area id, at every level it was counted in: a mission near that area's edge, and the neighbours across it. */
  near: Map<string, { mission: Placed; with: string[] }[]>;
  placed: number;
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
  sectorDrift: Readonly<Record<string, number | undefined>> = {}
): Counted {
  const counted: Counted = { in: new Map(), near: new Map(), placed: 0 };
  const add = (id: string, m: Placed) => counted.in.set(id, [...(counted.in.get(id) ?? []), m]);
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
    counted = countsOf(outlines, sectors, missions.rings.flatMap((p) => (p.kind === 'mission' ? [p] : [])), sectorDrift);
    from = { outlines, sectors, missions: missions.rings };
  }
  return counted;
}

/**
 * A count on the map: a pill of the ground, ringed in ink, its figure in ink. Never a hue. **Dashed when
 * any mission it counts is near the area's edge**, where the drawn lines cannot say which side it is on.
 */
function badge(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, unsettled: boolean): void {
  const text = n > 99 ? '99+' : String(n);
  const w = Math.max(18, ctx.measureText(text).width + 10);
  const h = 18;
  const [l, t, r] = [x - w / 2, y - h / 2, h / 2];
  ctx.beginPath();
  ctx.moveTo(l + r, t);
  ctx.lineTo(l + w - r, t);
  ctx.arc(l + w - r, y, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(l + r, t + h);
  ctx.arc(l + r, y, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
  ctx.fill();
  if (unsettled) ctx.setLineDash([3, 2.5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

/** Where an area's count hangs: its label point, from the vendoring; its box's middle in files without one. */
function labelOf(s: Shape): [number, number] {
  const at = s.props.label;
  if (Array.isArray(at) && typeof at[0] === 'number' && typeof at[1] === 'number') return project(at[0], at[1]);
  return [(s.bbox[0] + s.bbox[2]) / 2, (s.bbox[1] + s.bbox[3]) / 2];
}

/** A Sector's count replaces its Zone's once the Sector is this wide on screen, in CSS px. */
const SECTOR_PX = 48;

export const overlay: Overlay = {
  load: () => void (mapLayers.counts = 'ready'),
  marks(ctx, v, ink) {
    const c = sync();
    const o = layerData.outlines;
    // Unknown is not none: with the missions not read, no badge is drawn, and the key says why.
    if (!c || !o || layerData.missions?.age == null) return;
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
        const wide = sectors.length > 0 && sectors.every((s) => (s.bbox[2] - s.bbox[0]) * v.scale >= SECTOR_PX);
        if (wide) for (const s of sectors) shown.push([s, c.in.get(s.id ?? '')!.length]);
        else shown.push([zone, n]);
      }
    }
    if (shown.length === 0) return;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = ink.ground;
    ctx.strokeStyle = ink.ink;
    for (const [s, n] of shown) {
      const [ux, uy] = labelOf(s);
      const x = (ux - v.cx) * v.scale + v.width / 2;
      const y = (uy - v.cy) * v.scale + v.height / 2;
      if (x < -20 || y < -20 || x > v.width + 20 || y > v.height + 20) continue;
      badge(ctx, x, y, n, (c.near.get(s.id ?? '')?.length ?? 0) > 0);
    }
  },
  legend() {
    const m = layerData.missions;
    if (!layerData.outlines) return '';
    if (!m || m.age === null) return 'Missions by Zone · not read yet';
    const placed = sync()?.placed ?? 0;
    return `Missions by Zone · ${placed} placed, ${m.unplaced} by jurisdiction only · ${m.age}`;
  },
  about(shape) {
    const c = sync();
    if (!c || layerData.missions?.age == null) return 'missions not read';
    const near = c.near.get(shape.id ?? '')?.length ?? 0;
    return `${openSaid(c.in.get(shape.id ?? '')?.length ?? 0)}${near > 0 ? ` · ${near} near an edge` : ''}`;
  }
};
