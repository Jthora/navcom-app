/**
 * Reading a ZSP 2.0 partition, and the checks it has to pass before NavCom vendors it [docs/design/map.md,
 * Zones; the owner's map decision D6].
 *
 * The set is one manifest and one GeoJSON file per Terra or Mare. Each file holds the container's own
 * outline, its Zones, and its Sectors; the outlines are dissolved from the Sectors, and only Sectors
 * count toward coverage [Starcom D-ZR, ZR9]. NavCom reads the format as published and runs the same
 * kinds of check Starcom's build runs, with its own code: hashes and lengths against the manifest,
 * ids and levels, rings, sizes, licences, landform words, retired ids, and coverage, where every point
 * of a 2° grid is in exactly one Sector and the Sectors' areas add up to the Earth's. And one check
 * Starcom's does not run: every edge, at every level, so a strip narrower than the grid, or a Sector
 * moved sideways, which keeps its area, is refused too [tiles].
 *
 * A partition arrives in stages until Starcom's swap (D6): the outlines alone, then one Terra with its
 * Zones and Sectors, then the rest. So the coverage asked for depends on the stage: at every stage the
 * Terrae and Maria cover the Earth once; a container that has Zones has them cover it, with Sectors
 * covering each; and only the final set must have Zones and Sectors everywhere.
 *
 * Nothing fails quietly. A problem is a line saying what and where, and a partition with any problem
 * is not handed back at all.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { EARTH_AREA, areaOf, boxOf, selfCrosses, type LonLatBox, type LonLatRing } from './geometry.js';
import { isContainerLevel, zoneOfSector, zspLevelOf, type ZspContainerLevel, type ZspLevel } from './ids.js';

/** Which stage a set is, as D6 vendors them: drafts 1 to 3 as Mecha Jono publishes each, and the set Starcom swaps to. */
export type ZspStage = '1' | '2' | '3' | 'final';
export const ZSP_STAGES: readonly ZspStage[] = ['1', '2', '3', 'final'];

/** The systems a Zone is bound by [ZR6]. A word not here is a word nobody has defined yet. */
export const ZSP_SYSTEMS: ReadonlySet<string> = new Set(['rift', 'belt', 'orogen', 'basin', 'shield', 'plateau', 'delta', 'arc', 'ridge', 'gyre']);

/**
 * The IAU's descriptor terms for planetary surface features, singular and plural, the only words a
 * Sector's landform may be named in [ZR14]. From the IAU's Gazetteer of Planetary Nomenclature.
 */
export const IAU_DESCRIPTORS: ReadonlySet<string> = new Set([
  'Arcus', 'Arcūs', 'Astrum', 'Astra', 'Catena', 'Catenae', 'Cavus', 'Cavi', 'Chaos', 'Chasma', 'Chasmata', 'Collis', 'Colles',
  'Corona', 'Coronae', 'Crater', 'Craters', 'Dorsum', 'Dorsa', 'Facula', 'Faculae', 'Farrum', 'Farra', 'Flexus', 'Flexūs',
  'Fluctus', 'Fluctūs', 'Flumen', 'Flumina', 'Fossa', 'Fossae', 'Fretum', 'Freta', 'Insula', 'Insulae', 'Labes', 'Labyrinthus',
  'Labyrinthi', 'Lacuna', 'Lacunae', 'Lacus', 'Lenticula', 'Lenticulae', 'Linea', 'Lineae', 'Lingula', 'Lingulae', 'Macula',
  'Maculae', 'Mare', 'Maria', 'Mensa', 'Mensae', 'Mons', 'Montes', 'Oceanus', 'Palus', 'Paludes', 'Patera', 'Paterae',
  'Planitia', 'Planitiae', 'Planum', 'Plana', 'Promontorium', 'Promontoria', 'Regio', 'Regiones', 'Reticulum', 'Reticula',
  'Rima', 'Rimae', 'Rupes', 'Saxum', 'Saxa', 'Scopulus', 'Scopuli', 'Serpens', 'Serpentes', 'Sinus', 'Sulcus', 'Sulci',
  'Terra', 'Terrae', 'Tessera', 'Tesserae', 'Tholus', 'Tholi', 'Unda', 'Undae', 'Vallis', 'Valles', 'Vastitas', 'Virga', 'Virgae'
]);

/** A Sector of 50,000 to 500,000 km², or one that says why it is not [ZR7]. */
export const SECTOR_KM2 = { min: 50_000, max: 500_000 } as const;

/**
 * A licence NavCom may vendor, for the set or for a source a Sector's lines were drawn from: public
 * domain, CC0, or attribution only. Share-alike would bind what NavCom derives from it, and
 * non-commercial would bind who may use it; neither may draw a line here.
 */
export function licenceAllowed(licence: unknown): boolean {
  if (typeof licence !== 'string' || licence.trim() === '') return false;
  if (/(-SA\b|-NC\b|ShareAlike|NonCommercial|-ND\b)/i.test(licence)) return false;
  return /^(CC0(-1\.0)?|CC-BY(-[34]\.0)?|ODC-BY(-1\.0)?|PDDL(-1\.0)?|OGL-UK-3\.0|NLOD(-2\.0)?|public domain)$/i.test(licence.trim());
}

export interface ZspManifestEntry {
  id: string;
  name: string;
  level: ZspContainerLevel;
  file: string;
  sha256: string;
  bytes: number;
}
export interface ZspRetired {
  id: string;
  name: string;
  covered_by: string[];
}
export interface ZspManifest {
  zsp: '2.0';
  generated?: string;
  generator?: string;
  licence: string;
  containers: ZspManifestEntry[];
  retired: ZspRetired[];
}

/** One Terra, Mare, Zone or Sector, read: its rings in longitude and latitude, and what its file says of it. */
export interface ZspArea {
  id: string;
  name: string;
  level: ZspLevel;
  /** A Zone's container, a Sector's Zone; null for a container. */
  parent: string | null;
  /** The container whose file it came from. */
  container: string;
  rings: LonLatRing[];
  bbox: LonLatBox;
  /** In square metres, on the sphere. */
  area: number;
  /** Every property as the file gives it, for what a reader shows: a Zone's system, a Sector's landform. */
  properties: Record<string, unknown>;
}

export interface ZspPartition {
  manifest: ZspManifest;
  containers: ZspArea[];
  zones: ZspArea[];
  sectors: ZspArea[];
}

const decoder = new TextDecoder();
const bytesOf = (x: Uint8Array | string): Uint8Array => (typeof x === 'string' ? new TextEncoder().encode(x) : x);

/** The Zones that now cover a retired ZSP 1.0 id, so a report naming it still finds its places; null when it is not retired. */
export function coveringZones(manifest: Pick<ZspManifest, 'retired'> | Record<string, unknown>, id: string): string[] | null {
  const retired = (manifest as { retired?: unknown }).retired;
  if (!Array.isArray(retired)) return null;
  const hit = (retired as { id?: unknown; covered_by?: unknown }[]).find((r) => r?.id === id);
  return hit && Array.isArray(hit.covered_by) ? (hit.covered_by as string[]).slice() : null;
}

/** A GeoJSON Polygon's or MultiPolygon's rings, packed, or the reason they cannot be read. */
function ringsOf(geometry: unknown): LonLatRing[] | string {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!g || typeof g !== 'object') return 'has no geometry';
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' && Array.isArray(g.coordinates) ? g.coordinates : null;
  if (!polygons) return `has a ${String(g.type)}, not a Polygon or MultiPolygon`;
  const out: LonLatRing[] = [];
  for (const polygon of polygons as unknown[]) {
    if (!Array.isArray(polygon) || polygon.length === 0) return 'has an empty polygon';
    for (const ring of polygon as unknown[]) {
      if (!Array.isArray(ring)) return 'has a ring that is not a list of positions';
      const packed = new Float64Array(ring.length * 2);
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i] as unknown;
        if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
          return 'has a position that is not a longitude and a latitude';
        }
        if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return `has a position off the Earth (${p[0]}, ${p[1]})`;
        packed[2 * i] = p[0];
        packed[2 * i + 1] = p[1];
      }
      out.push(packed);
    }
  }
  return out;
}

/** What is wrong with one area's rings: open, too short, wound against RFC 7946, or crossing themselves. */
function ringProblems(id: string, geometry: unknown): string[] {
  const polygons = (geometry as { type: string; coordinates: unknown[] }).type === 'Polygon'
    ? [(geometry as { coordinates: unknown[] }).coordinates]
    : ((geometry as { coordinates: unknown[] }).coordinates as unknown[]);
  const out: string[] = [];
  for (const polygon of polygons as number[][][][]) {
    polygon.forEach((ring, k) => {
      const first = ring[0]!, last = ring[ring.length - 1]!;
      if (ring.length < 4) out.push(`${id}: a ring of ${ring.length} positions, fewer than a closed ring's 4`);
      if (first[0] !== last[0] || first[1] !== last[1]) {
        out.push(`${id}: a ring is not closed`);
        return;
      }
      const packed = Float64Array.from(ring.flatMap((p) => [p[0]!, p[1]!]));
      const signed = areaOf([packed]);
      // RFC 7946 §3.1.6: an outer ring counter-clockwise, a hole clockwise.
      if (k === 0 ? signed <= 0 : signed >= 0) out.push(`${id}: ${k === 0 ? 'an outer ring' : 'a hole'} wound the wrong way for RFC 7946`);
      if (selfCrosses(packed)) out.push(`${id}: a ring crosses itself`);
    });
  }
  return out;
}

/**
 * Reads a partition and checks it. `files` are each container's file by the name the manifest gives
 * it, as bytes or text; `stage` is which stage this set is (D6), and decides how much of the Earth must
 * have Zones and Sectors yet.
 */
export function checkPartition(input: {
  manifest: Uint8Array | string;
  files: Record<string, Uint8Array | string>;
  stage: ZspStage;
}): { problems: string[]; partition: ZspPartition | null } {
  const problems: string[] = [];
  const fail = (line: string) => problems.push(line);
  if (!ZSP_STAGES.includes(input.stage)) return { problems: [`stage "${String(input.stage)}" is not one of ${ZSP_STAGES.join(', ')}`], partition: null };

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(decoder.decode(bytesOf(input.manifest))) as Record<string, unknown>;
  } catch {
    return { problems: ['manifest.json: not JSON'], partition: null };
  }
  if (raw.zsp !== '2.0') fail(`manifest.json: zsp is "${String(raw.zsp)}", not "2.0"`);
  if (!licenceAllowed(raw.licence)) fail(`manifest.json: licence "${String(raw.licence)}" is not one NavCom may vendor (public domain, CC0 or attribution only)`);
  const entries = Array.isArray(raw.containers) ? (raw.containers as Record<string, unknown>[]) : [];
  if (entries.length === 0) fail('manifest.json: no containers');
  const retired = Array.isArray(raw.retired) ? (raw.retired as Record<string, unknown>[]) : null;
  if (retired === null) fail('manifest.json: retired is not a list');

  const seen = new Set<string>();
  const areas: ZspArea[] = [];
  const featureProblems: string[] = [];

  for (const entry of entries) {
    const where = `manifest.json: container ${String(entry?.id)}`;
    if (!isContainerLevel(zspLevelOf(entry?.id)) || entry.level !== zspLevelOf(entry.id)) {
      fail(`${where}: id and level do not name a Terra or a Mare`);
      continue;
    }
    if (typeof entry.name !== 'string' || entry.name === '') fail(`${where}: no name`);
    if (typeof entry.file !== 'string' || !/^[a-z0-9-]+\.zsp\.geojson$/.test(entry.file)) {
      fail(`${where}: file "${String(entry.file)}" is not a container file's name`);
      continue;
    }
    const file = entry.file;
    const body = input.files[file];
    if (body === undefined) {
      fail(`${file}: named in the manifest and not here`);
      continue;
    }
    const bytes = bytesOf(body);
    if (bytes.length !== entry.bytes) fail(`${file}: ${bytes.length} bytes, and the manifest says ${String(entry.bytes)}`);
    const digest = bytesToHex(sha256(bytes));
    if (digest !== entry.sha256) fail(`${file}: sha256 ${digest}, and the manifest says ${String(entry.sha256)}`);

    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
    } catch {
      fail(`${file}: not JSON`);
      continue;
    }
    if (doc.type !== 'FeatureCollection' || doc.zsp !== '2.0') fail(`${file}: not a ZSP 2.0 FeatureCollection`);
    if (doc.container !== entry.id) fail(`${file}: holds container "${String(doc.container)}", and the manifest says ${entry.id}`);
    const features = Array.isArray(doc.features) ? (doc.features as Record<string, unknown>[]) : [];
    let outlines = 0;
    for (const f of features) {
      const p = (f?.properties ?? {}) as Record<string, unknown>;
      const id = p.id;
      const level = zspLevelOf(id);
      const label = `${file}: ${String(id)}`;
      if (level === null) {
        featureProblems.push(`${label}: not a well-formed ZSP 2.0 id`);
        continue;
      }
      if (p.level !== level) featureProblems.push(`${label}: level "${String(p.level)}", and its id is a ${level}'s`);
      if (seen.has(id as string)) featureProblems.push(`${label}: the same id twice`);
      seen.add(id as string);
      if (typeof p.name !== 'string' || p.name === '') featureProblems.push(`${label}: no name`);
      const rings = ringsOf(f.geometry);
      if (typeof rings === 'string') {
        featureProblems.push(`${label}: ${rings}`);
        continue;
      }
      featureProblems.push(...ringProblems(id as string, f.geometry));
      const parent = typeof p.parent === 'string' ? p.parent : null;
      if (isContainerLevel(level)) {
        outlines++;
        if (id !== entry.id) featureProblems.push(`${label}: a ${level} in ${entry.id}'s file`);
        if (parent !== null) featureProblems.push(`${label}: a container has no parent`);
      } else if (level === 'zone') {
        if (parent !== entry.id) featureProblems.push(`${label}: parent "${String(p.parent)}", not its file's container ${entry.id}`);
        if (!ZSP_SYSTEMS.has(String(p.system))) featureProblems.push(`${label}: system "${String(p.system)}" is not one of ${[...ZSP_SYSTEMS].join(', ')}`);
      } else {
        if (parent !== zoneOfSector(id as string)) featureProblems.push(`${label}: parent "${String(p.parent)}", and its id names ${zoneOfSector(id as string)}`);
        if (p.descriptor !== undefined && !IAU_DESCRIPTORS.has(String(p.descriptor))) {
          featureProblems.push(`${label}: descriptor "${String(p.descriptor)}" is not one of the IAU's terms`);
        }
        const sources = Array.isArray(p.sources) ? (p.sources as Record<string, unknown>[]) : [];
        if (sources.length === 0) featureProblems.push(`${label}: no sources, so no licence`);
        for (const s of sources) {
          if (!licenceAllowed(s?.licence)) featureProblems.push(`${label}: source "${String(s?.name)}" has licence "${String(s?.licence)}", which NavCom may not vendor`);
        }
      }
      const area = areaOf(rings);
      if (level === 'sector') {
        const km2 = area / 1e6;
        if ((km2 < SECTOR_KM2.min || km2 > SECTOR_KM2.max) && (typeof p.size_reason !== 'string' || p.size_reason === '')) {
          featureProblems.push(`${label}: ${Math.round(km2).toLocaleString('en-US')} km², outside 50,000 to 500,000 km², with no size_reason`);
        }
      }
      areas.push({
        id: id as string,
        name: typeof p.name === 'string' ? p.name : (id as string),
        level,
        parent,
        container: entry.id as string,
        rings,
        bbox: boxOf(rings),
        area,
        properties: p
      });
    }
    if (outlines !== 1) featureProblems.push(`${file}: ${outlines} outlines of ${entry.id}, not 1`);
  }
  problems.push(...featureProblems);

  const containers = areas.filter((a) => isContainerLevel(a.level));
  const zones = areas.filter((a) => a.level === 'zone');
  const sectors = areas.filter((a) => a.level === 'sector');
  const byId = new Map(areas.map((a) => [a.id, a]));

  for (const z of zones) if (!sectors.some((s) => s.parent === z.id)) fail(`${z.id} has no Sectors`);
  for (const s of sectors) if (!byId.has(s.parent ?? '')) fail(`${s.id}: its Zone ${s.parent} is not in the partition`);
  for (const c of containers) {
    const has = zones.some((z) => z.parent === c.id);
    if (!has && input.stage !== '1' && input.stage !== '2' && input.stage !== '3') fail(`${c.id} has no Zones, and the final set has them everywhere`);
  }
  for (const r of retired ?? []) {
    if (zspLevelOf(r?.id) !== 'zone') fail(`retired: "${String(r?.id)}" is not a Zone's id`);
    const by = Array.isArray(r?.covered_by) ? (r.covered_by as unknown[]) : null;
    if (!by || by.length === 0) fail(`retired: ${String(r?.id)} is covered by no Zone`);
    for (const z of by ?? []) {
      if (zspLevelOf(z) !== 'zone') fail(`retired: ${String(r?.id)} is covered by "${String(z)}", not a Zone's id`);
      else if (input.stage === 'final' && !byId.has(z as string)) fail(`retired: ${String(r?.id)} is covered by ${String(z)}, which the partition does not hold`);
    }
  }

  coverage(input.stage, containers, zones, sectors, byId, fail);

  if (problems.length > 0) return { problems, partition: null };
  return {
    problems,
    partition: {
      manifest: { ...(raw as unknown as ZspManifest), retired: (retired ?? []) as unknown as ZspRetired[] },
      containers,
      zones,
      sectors
    }
  };
}

/**
 * An area's edges, bucketed by latitude for the checks: a point is tested against only the edges whose
 * latitudes span it, so a real container's tens of thousands of points cost a few dozen comparisons a
 * point rather than all of them. Each edge is kept as `holds` reads it, and tested by the same
 * expression, so the answer is `holds`'s exactly.
 */
const banded = new WeakMap<ZspArea, { s: number; h: number; bands: number[][] }>();
function bandsOf(a: ZspArea): { s: number; h: number; bands: number[][] } {
  const known = banded.get(a);
  if (known) return known;
  let edges = 0;
  for (const r of a.rings) edges += r.length / 2;
  const n = Math.max(1, Math.min(4096, Math.ceil(Math.sqrt(edges))));
  const s = a.bbox[1];
  const h = (a.bbox[3] - s) / n || 1;
  const band = (y: number) => Math.min(n - 1, Math.max(0, Math.floor((y - s) / h)));
  const bands: number[][] = Array.from({ length: n }, () => []);
  for (const r of a.rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1]!, yj = r[j + 1]!;
      for (let k = band(Math.min(yi, yj)), top = band(Math.max(yi, yj)); k <= top; k++) bands[k]!.push(r[j]!, yj, r[i]!, yi);
    }
  }
  const out = { s, h, bands };
  banded.set(a, out);
  return out;
}

/** Whether an area holds a point: its box, then the edges in the point's band, even-odd as `holds` counts them. */
function within(a: ZspArea, lon: number, lat: number): boolean {
  if (lon < a.bbox[0] || lon > a.bbox[2] || lat < a.bbox[1] || lat > a.bbox[3]) return false;
  const { s, h, bands } = bandsOf(a);
  const list = bands[Math.min(bands.length - 1, Math.max(0, Math.floor((lat - s) / h)))]!;
  let c = false;
  for (let e = 0; e < list.length; e += 4) {
    const xj = list[e]!, yj = list[e + 1]!, xi = list[e + 2]!, yi = list[e + 3]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The areas holding a point. */
function holding(areas: readonly ZspArea[], lon: number, lat: number): ZspArea[] {
  return areas.filter((a) => within(a, lon, lat));
}

/**
 * How far either side of an edge the edge check looks, in degrees: about a metre. Far below the
 * kilometre the format simplifies edges to, so a gap or an overlap anybody could draw is wider than
 * it; and far above a double's rounding at 180°, so two copies of one edge that differ in their last
 * digit are not taken for one.
 */
const PROBE = 1e-5;

/** An edge as a key. ±180° is one meridian, so a seam drawn on both sides of the antimeridian is one edge. */
const lonKey = (x: number) => (x === -180 ? 180 : x);
const keyOf = (x1: number, y1: number, x2: number, y2: number) => `${lonKey(x1)} ${y1} ${lonKey(x2)} ${y2}`;
const where = (x: number, y: number) => `(${x.toFixed(3)}, ${y.toFixed(3)})`;

/**
 * Each edge of an area's rings that is an edge at all: not of no length, and not along a pole, where
 * every point is one point and nothing lies beyond.
 */
function eachEdge(a: ZspArea, visit: (x1: number, y1: number, x2: number, y2: number) => void) {
  for (const r of a.rings) {
    for (let i = 0; i + 3 < r.length; i += 2) {
      const x1 = r[i]!, y1 = r[i + 1]!, x2 = r[i + 2]!, y2 = r[i + 3]!;
      if (y1 === y2 && Math.abs(y1) === 90) continue;
      if (lonKey(x1) === lonKey(x2) && y1 === y2) continue;
      visit(x1, y1, x2, y2);
    }
  }
}

/** A point beside an edge's middle, `side` 1 to its left, which is inside as RFC 7946 winds rings, and -1 to its right; null past a pole. */
function beside(x1: number, y1: number, x2: number, y2: number, side: 1 | -1): [number, number] | null {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const d = (side * Math.min(PROBE, len / 4)) / len;
  let x = (x1 + x2) / 2 - dy * d;
  const y = (y1 + y2) / 2 + dx * d;
  if (Math.abs(y) >= 90) return null;
  if (x > 180) x -= 360;
  else if (x < -180) x += 360;
  return [x, y];
}

/**
 * That `members` tile `domain`, or the whole Earth with no domain: no strip uncovered and none covered
 * twice, however thin, down to about a metre [PROBE]. The 2° grid misses a strip that falls between its
 * points, and areas cannot see a Sector moved sideways, which keeps its area; edges see both.
 *
 * The format cuts Sectors so that neighbours share every edge [Starcom D-ZR, ZR9], so nearly every edge
 * is found again, reversed, in the area beside it, or in the domain's own outline, which is dissolved
 * from them; that is a lookup, and costs nothing. An edge that is found in no neighbour is looked at:
 * a point just inside it must be in this area and no other, and in the domain; a point just outside it
 * must be in exactly one other area, or outside the domain. The domain's own edges, where no member
 * draws them, are looked at from inside. So a partition whose neighbours share edges passes at once,
 * and one whose neighbours only meet passes too, more slowly; one with a gap or an overlap does not.
 */
function tiles(members: readonly ZspArea[], domain: ZspArea | null, what: string, fail: (line: string) => void): void {
  const drawnBy = new Map<string, ZspArea[]>();
  for (const m of members) {
    eachEdge(m, (x1, y1, x2, y2) => {
      const k = keyOf(x1, y1, x2, y2);
      const list = drawnBy.get(k);
      if (list) list.push(m);
      else drawnBy.set(k, [m]);
    });
  }
  const bounds = new Set<string>();
  if (domain) eachEdge(domain, (x1, y1, x2, y2) => void bounds.add(keyOf(x1, y1, x2, y2)));
  const said = new Set<string>();
  const once = (key: string, line: string) => {
    if (said.has(key)) return;
    said.add(key);
    fail(line);
  };
  const ids = (list: readonly ZspArea[]) => list.map((a) => a.id).join(', ');

  for (const m of members) {
    eachEdge(m, (x1, y1, x2, y2) => {
      const same = drawnBy.get(keyOf(x1, y1, x2, y2))!;
      if (same.length > 1) {
        once(`twice ${ids(same)}`, `${ids(same)} lie on the same side of one edge, at ${where(x1, y1)}: they overlap`);
        return;
      }
      if (drawnBy.has(keyOf(x2, y2, x1, y1))) return;
      if (bounds.has(keyOf(x1, y1, x2, y2))) return;

      const inner = beside(x1, y1, x2, y2, 1);
      if (inner) {
        const here = holding(members, inner[0], inner[1]);
        const others = here.filter((a) => a !== m);
        if (!here.includes(m)) once(`wound ${m.id}`, `${m.id} does not hold the point just inside its own edge, at ${where(...inner)}`);
        else if (others.length > 0) once(`over ${m.id} ${ids(others)}`, `${m.id} overlaps ${ids(others)}, at ${where(...inner)}`);
        if (domain && !within(domain, inner[0], inner[1])) once(`out ${m.id}`, `${m.id} reaches outside ${domain.id}, at ${where(...inner)}`);
      }
      const outer = beside(x1, y1, x2, y2, -1);
      if (!outer || (domain && !within(domain, outer[0], outer[1]))) return;
      const there = holding(members, outer[0], outer[1]);
      const seam = Math.abs(x1) === 180 && Math.abs(x2) === 180;
      if (there.length === 0) once(`gap ${m.id}`, `beside ${m.id}, at ${where(...outer)}, is in no ${what}: a gap`);
      else if (there.length > 1) once(`over ${ids(there)}`, `${ids(there)} overlap, at ${where(...outer)}, beside ${m.id}`);
      else if (there[0] === m && !seam) once(`both ${m.id}`, `${m.id} lies on both sides of its own edge, at ${where(...outer)}`);
    });
  }

  if (!domain) return;
  eachEdge(domain, (x1, y1, x2, y2) => {
    if (drawnBy.has(keyOf(x1, y1, x2, y2))) return;
    const inner = beside(x1, y1, x2, y2, 1);
    if (!inner) return;
    const here = holding(members, inner[0], inner[1]);
    if (here.length === 0) once(`edge gap ${domain.id}`, `${domain.id}: at ${where(...inner)}, just inside its edge, is in no ${what}: a gap`);
    else if (here.length > 1) once(`edge over ${ids(here)}`, `${ids(here)} overlap, at ${where(...inner)}, just inside ${domain.id}'s edge`);
  });
}

/** How far the areas may be from adding up: a part in a billion. They add up exactly, to rounding, when neighbours share edges. */
const AREA_TOLERANCE = 1e-9;

/**
 * Coverage, three ways. Every edge, at each level: the Terrae and Maria tile the Earth, a container's
 * Zones tile it, and a Zone's Sectors tile the Zone, with no gap or overlap however thin [tiles]. Every
 * point of a 2° grid — the centre of each 2° cell, so no point is chosen to sit on a line — in exactly
 * one Terra or Mare, and, where a container has Zones, in exactly one of its Zones and exactly one
 * Sector of that Zone, which says where in words a person can find. And the areas, to a part in a
 * billion: the containers' and, where they are whole, the Zones' and the Sectors' add up to what holds
 * them.
 */
function coverage(
  stage: ZspStage,
  containers: ZspArea[],
  zones: ZspArea[],
  sectors: ZspArea[],
  byId: Map<string, ZspArea>,
  fail: (line: string) => void
) {
  if (containers.length === 0) return;
  const zoned = new Set(zones.map((z) => z.parent));
  const zonesOf = new Map<string, ZspArea[]>();
  const sectorsOf = new Map<string, ZspArea[]>();
  const sectorsOfZone = new Map<string, ZspArea[]>();
  for (const z of zones) zonesOf.set(z.parent ?? '', [...(zonesOf.get(z.parent ?? '') ?? []), z]);
  for (const s of sectors) {
    const c = byId.get(s.parent ?? '')?.parent ?? '';
    sectorsOf.set(c, [...(sectorsOf.get(c) ?? []), s]);
    sectorsOfZone.set(s.parent ?? '', [...(sectorsOfZone.get(s.parent ?? '') ?? []), s]);
  }

  tiles(containers, null, 'Terra or Mare', fail);
  for (const c of containers) if (zoned.has(c.id)) tiles(zonesOf.get(c.id) ?? [], c, `Zone of ${c.id}`, fail);
  for (const z of zones) tiles(sectorsOfZone.get(z.id) ?? [], z, `Sector of ${z.id}`, fail);

  const reported = new Set<string>();
  const once = (key: string, line: string) => {
    if (reported.has(key)) return;
    reported.add(key);
    fail(line);
  };
  for (let lat = -89; lat <= 89; lat += 2) {
    for (let lon = -179; lon <= 179; lon += 2) {
      const at = `${lon},${lat}`;
      const c = holding(containers, lon, lat);
      if (c.length !== 1) {
        once(`c${c.length}`, `${at} is in ${c.length === 0 ? 'no Terra or Mare' : `${c.length} containers (${c.map((x) => x.id).join(', ')})`}`);
        continue;
      }
      const container = c[0]!;
      if (!zoned.has(container.id)) continue;
      const z = holding(zonesOf.get(container.id) ?? [], lon, lat);
      if (z.length !== 1) {
        once(`z${container.id}${z.length}`, `${at} is in ${z.length === 0 ? `no Zone of ${container.id}` : `${z.length} Zones (${z.map((x) => x.id).join(', ')})`}`);
        continue;
      }
      const s = holding(sectorsOf.get(container.id) ?? [], lon, lat);
      if (s.length !== 1) {
        once(`s${container.id}${s.length}`, `${at} is in ${s.length === 0 ? 'no Sector' : `${s.length} Sectors (${s.map((x) => x.id).join(', ')})`}`);
        continue;
      }
      if (s[0]!.parent !== z[0]!.id) once(`o${s[0]!.id}`, `${s[0]!.id} reaches outside its Zone ${s[0]!.parent}, at ${at}`);
    }
  }
  const total = (list: ZspArea[]) => list.reduce((n, a) => n + a.area, 0);
  const off = (a: number, b: number) => Math.abs(a - b) / b > AREA_TOLERANCE;
  const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(9)}%`;
  if (off(total(containers), EARTH_AREA)) fail(`the Terrae and Maria add up to ${pct(total(containers), EARTH_AREA)} of the Earth's area, not 100% to a part in a billion`);
  for (const c of containers) {
    if (!zoned.has(c.id)) continue;
    const own = zonesOf.get(c.id) ?? [];
    if (off(total(own), c.area)) fail(`${c.id}: its Zones' area is ${pct(total(own), c.area)} of its own, not 100% to a part in a billion`);
    if (off(total(sectorsOf.get(c.id) ?? []), c.area)) fail(`${c.id}: its Sectors' area is ${pct(total(sectorsOf.get(c.id) ?? []), c.area)} of its own, not 100% to a part in a billion`);
  }
  for (const z of zones) {
    const own = sectorsOfZone.get(z.id) ?? [];
    if (own.length > 0 && off(total(own), z.area)) fail(`${z.id}: its Sectors' area is ${pct(total(own), z.area)} of its own, not 100% to a part in a billion`);
  }
  if (stage === 'final' && off(total(sectors), EARTH_AREA)) {
    fail(`the Sectors add up to ${pct(total(sectors), EARTH_AREA)} of the Earth's area, not 100% to a part in a billion`);
  }
}
