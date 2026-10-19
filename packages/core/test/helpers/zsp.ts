/**
 * A whole-Earth ZSP 2.0 partition, written by NavCom for its own tests and never shipped.
 *
 * In the exact format of the handoff to Mecha Jono [Starcom D-ZR, ZR9]: one manifest, and one GeoJSON
 * FeatureCollection per Terra or Mare, holding the container's own outline, its Zones and its
 * Sectors, with ids `terra:<slug>`, `mare:<slug>`, `zone:<slug>` and `zone:<slug>/sector:<slug>`. The
 * containers carry the names Stage 1 will use, the four renamed on 2026-10-18 among them (Terra
 * Sahulica, Laurentia, Amazonia and Europaea), so nothing here is built against a name that went.
 *
 * The shapes are not the Earth's. Each is a box in longitude and latitude, with a vertex at every 5°
 * along every edge so that neighbours share every vertex, as the format asks. Between them they
 * cover the Earth once: both polar caps run along their pole, as RFC 7946 draws a ring that meets
 * one, and Mare Pacificum straddles the antimeridian, split at ±180° the way the format splits it,
 * with one Sector on both sides of it. A box is far larger than a real Sector, so each says why.
 *
 * Written by NavCom; nothing here is Starcom's code. The committed files in `fixtures/zsp/` are what
 * this builds: `zsp-partition.test.ts` fails when they differ, and rewrites them with UPDATE_ZSP_FIXTURE=1.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

type LonLat = [number, number];

/** A counter-clockwise box, closed, with a vertex at every 5° along each edge. */
export function box(w: number, s: number, e: number, n: number): LonLat[] {
  const along = (from: number, to: number): number[] => {
    const out: number[] = [];
    const step = Math.sign(to - from) * 5;
    for (let v = from; step > 0 ? v < to : v > to; v += step) out.push(v);
    return out;
  };
  return [
    ...along(w, e).map((x): LonLat => [x, s]),
    ...along(s, n).map((y): LonLat => [e, y]),
    ...along(e, w).map((x): LonLat => [x, n]),
    ...along(n, s).map((y): LonLat => [w, y]),
    [w, s]
  ];
}

/** A box, or two boxes either side of the antimeridian when it runs from `w` east past 180° to `e`. */
function shape(w: number, s: number, e: number, n: number): { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } {
  if (w < e) return { type: 'Polygon', coordinates: [box(w, s, e, n)] };
  return { type: 'MultiPolygon', coordinates: [[box(w, s, 180, n)], [box(-180, s, e, n)]] };
}

const feature = (properties: Record<string, unknown>, geometry: ReturnType<typeof shape>) => ({
  type: 'Feature',
  id: properties.id,
  properties,
  geometry
});

const SIZE = 'A test fixture: every box is a continent wide, far beyond a real Sector, and is never shipped.';
const SOURCES = [{ name: 'NavCom test fixture', licence: 'CC0-1.0' }];

interface Cut {
  slug: string;
  name: string;
  system: string;
  /** West, south, east, north. */
  box: [number, number, number, number];
  sectors: { slug: string; name: string; box: [number, number, number, number]; descriptor?: string }[];
}
interface Container {
  id: string;
  name: string;
  level: 'terra' | 'mare';
  box: [number, number, number, number];
  zones: Cut[];
}

/** Two Zones side by side, each cut at its middle latitude into two Sectors. */
function halves(slug: string, label: string, [w, s, e, n]: [number, number, number, number], system = 'shield'): Cut[] {
  const mid = (w + e) / 2;
  const lat = (s + n) / 2;
  return ([['west', w, mid], ['east', mid, e]] as const).map(([side, a, b]) => ({
    slug: `${slug}-${side}`,
    name: `${label} ${side[0]!.toUpperCase()}${side.slice(1)} Zone`,
    box: [a, s, b, n] as [number, number, number, number],
    system,
    sectors: [
      { slug: 'south', name: `${label} ${side}, south`, box: [a, s, b, lat] as [number, number, number, number], descriptor: 'Planitia' },
      { slug: 'north', name: `${label} ${side}, north`, box: [a, lat, b, n] as [number, number, number, number], descriptor: 'Montes' }
    ]
  }));
}

/** The nine containers: two caps, six lands in a band between 60°S and 60°N, and an ocean across the dateline. */
export const CONTAINERS: Container[] = [
  { id: 'mare:arcticum', name: 'Mare Arcticum', level: 'mare', box: [-180, 60, 180, 90], zones: halves('arcticum', 'Arcticum', [-180, 60, 180, 90], 'gyre') },
  { id: 'terra:laurentia', name: 'Terra Laurentia', level: 'terra', box: [-150, 0, -30, 60], zones: halves('laurentia', 'Laurentia', [-150, 0, -30, 60]) },
  { id: 'terra:amazonia', name: 'Terra Amazonia', level: 'terra', box: [-150, -60, -30, 0], zones: halves('amazonia', 'Amazonia', [-150, -60, -30, 0], 'basin') },
  { id: 'terra:europaea', name: 'Terra Europaea', level: 'terra', box: [-30, 0, 60, 60], zones: halves('europaea', 'Europaea', [-30, 0, 60, 60]) },
  { id: 'terra:africana', name: 'Terra Africana', level: 'terra', box: [-30, -60, 60, 0], zones: halves('africana', 'Africana', [-30, -60, 60, 0], 'rift') },
  { id: 'terra:sinica', name: 'Terra Sinica', level: 'terra', box: [60, 0, 150, 60], zones: halves('sinica', 'Sinica', [60, 0, 150, 60], 'plateau') },
  { id: 'terra:sahulica', name: 'Terra Sahulica', level: 'terra', box: [60, -60, 150, 0], zones: halves('sahulica', 'Sahulica', [60, -60, 150, 0]) },
  {
    id: 'mare:pacificum',
    name: 'Mare Pacificum',
    level: 'mare',
    box: [150, -60, -150, 60],
    zones: (['north', 'south'] as const).map((half) => {
      const [s, n] = half === 'north' ? [0, 60] : [-60, 0];
      return {
        slug: `pacificum-${half}`,
        name: `Pacificum ${half[0]!.toUpperCase()}${half.slice(1)} Zone`,
        box: [150, s, -150, n] as [number, number, number, number],
        system: 'ridge',
        sectors: [
          { slug: 'west', name: `Pacificum ${half}, west`, box: [150, s, 165, n] as [number, number, number, number] },
          // On both sides of the antimeridian: one Sector, two rings, split at ±180° [RFC 7946 §3.1.9].
          { slug: 'dateline', name: `Pacificum ${half}, on the dateline`, box: [165, s, -165, n] as [number, number, number, number], descriptor: 'Fretum' },
          { slug: 'east', name: `Pacificum ${half}, east`, box: [-165, s, -150, n] as [number, number, number, number] }
        ]
      };
    })
  },
  { id: 'terra:antarctica', name: 'Terra Antarctica', level: 'terra', box: [-180, -90, 180, -60], zones: halves('antarctica', 'Antarctica', [-180, -90, 180, -60]) }
];

/** One container's file, as the export writes it: its outline, then its Zones, then their Sectors. */
export function containerFile(c: Container): Record<string, unknown> {
  const [w, s, e, n] = c.box;
  const features: unknown[] = [feature({ id: c.id, name: c.name, level: c.level, parent: null, principle: 'A box, for tests.', plates: ['Test'] }, shape(w, s, e, n))];
  for (const z of c.zones) {
    const zone = `zone:${z.slug}`;
    features.push(feature({ id: zone, name: z.name, level: 'zone', parent: c.id, system: z.system }, shape(...z.box)));
  }
  for (const z of c.zones) {
    for (const sec of z.sectors) {
      features.push(
        feature(
          {
            id: `zone:${z.slug}/sector:${sec.slug}`,
            name: sec.name,
            level: 'sector',
            parent: `zone:${z.slug}`,
            ...(sec.descriptor ? { descriptor: sec.descriptor } : {}),
            edges: [{ follows: 'grid', name: 'the fixture grid', source: 'NavCom test fixture' }],
            size_reason: SIZE,
            sources: SOURCES
          },
          shape(...sec.box)
        )
      );
    }
  }
  return { type: 'FeatureCollection', zsp: '2.0', container: c.id, features };
}

export const fileName = (id: string) => `${id.replace(':', '-')}.zsp.geojson`;

/** The whole partition: the manifest's text and every file's, each file named in it by its hash and length. */
export function fixturePartition(): { manifest: Record<string, unknown>; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const containers = CONTAINERS.map((c) => {
    const file = fileName(c.id);
    const text = JSON.stringify(containerFile(c));
    files[file] = text;
    const bytes = new TextEncoder().encode(text);
    return { id: c.id, name: c.name, level: c.level, file, sha256: bytesToHex(sha256(bytes)), bytes: bytes.length };
  });
  const manifest = {
    zsp: '2.0',
    generated: '2026-10-18T00:00:00Z',
    generator: 'navcom-test-fixture',
    licence: 'CC-BY-4.0',
    containers,
    retired: [{ id: 'zone:sahel', name: 'Sahel Zone', covered_by: ['zone:africana-west', 'zone:europaea-west'] }]
  };
  files['manifest.json'] = JSON.stringify(manifest, null, 1);
  return { manifest, files };
}
