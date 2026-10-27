/**
 * NavCom's own reader for Starcom's Zone and Sector Protocol 2.0, and the checks it runs before a
 * partition is vendored [docs/design/map.md, Zones; the owner's map decisions D6 and D10].
 *
 * Every check is tested twice: the fixture passes it, and the fixture broken one way at a time is
 * refused by it, by name. A check that has never refused anything has not been shown to check.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';
import {
  IAU_DESCRIPTORS,
  checkPartition,
  coveringZones,
  isZspId,
  licenceAllowed,
  zoneOfSector,
  zspLevelOf,
  type ZspStage
} from '../src/zones/index.js';
import { CONTAINERS, box, fixturePartition } from './helpers/zsp.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/zsp/', import.meta.url));
const SOURCE = fileURLToPath(new URL('../src/zones/', import.meta.url));

type Doc = { type: string; zsp: string; container: string; features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };

/** The fixture, as text, with one file changed by `edit` and the manifest re-hashed to match unless told not to. */
function broken(edit: (docs: Record<string, Doc>, manifest: Record<string, unknown>) => void, rehash = true) {
  const { files } = fixturePartition();
  const manifest = JSON.parse(files['manifest.json']!) as Record<string, unknown> & { containers: { file: string; sha256: string; bytes: number }[] };
  const docs: Record<string, Doc> = {};
  for (const c of manifest.containers) docs[c.file] = JSON.parse(files[c.file]!) as Doc;
  edit(docs, manifest);
  const out: Record<string, string> = {};
  for (const c of manifest.containers) {
    const text = JSON.stringify(docs[c.file]);
    out[c.file] = text;
    if (rehash) {
      const bytes = new TextEncoder().encode(text);
      c.sha256 = bytesToHex(sha256(bytes));
      c.bytes = bytes.length;
    }
  }
  return { manifest: JSON.stringify(manifest), files: out };
}

const check = (input: { manifest: string; files: Record<string, string> }, stage: ZspStage = 'final') => checkPartition({ ...input, stage });
const sector = (docs: Record<string, Doc>, id: string) =>
  Object.values(docs).flatMap((d) => d.features).find((f) => f.properties.id === id)!;

describe('the ids, as the format writes them', () => {
  it('knows each level by its id, and refuses one that is malformed', () => {
    expect(zspLevelOf('terra:africana')).toBe('terra');
    expect(zspLevelOf('mare:pacificum')).toBe('mare');
    expect(zspLevelOf('zone:east-african-rift')).toBe('zone');
    expect(zspLevelOf('zone:east-african-rift/sector:afar')).toBe('sector');
    for (const bad of ['terra:', 'Terra:africana', 'terra:Africana', 'zone:east_african', 'zone:x/sector:', 'sector:afar', 'terra:a/sector:b', 'zone:a/sector:b/sector:c', 'continent:x', '', 7, null, 'zone:a ', 'zone:-a', 'zone:a--b']) {
      expect(zspLevelOf(bad), String(bad)).toBeNull();
    }
  });

  it('refuses an id at a level it is not', () => {
    expect(isZspId('terra:africana', ['terra', 'mare'])).toBe(true);
    expect(isZspId('zone:afar', ['terra', 'mare'])).toBe(false);
    expect(isZspId('zone:a/sector:b', 'zone')).toBe(false);
    expect(isZspId('zone:a/sector:b', 'sector')).toBe(true);
  });

  it('reads a Sector’s Zone out of its id', () => {
    expect(zoneOfSector('zone:east-african-rift/sector:afar')).toBe('zone:east-african-rift');
    expect(zoneOfSector('zone:east-african-rift')).toBeNull();
  });
});

describe('the fixture', () => {
  it('is the one the helper builds, byte for byte, so a test and the vendoring script read the same thing', () => {
    const { files } = fixturePartition();
    if (process.env.UPDATE_ZSP_FIXTURE === '1') for (const [name, text] of Object.entries(files)) writeFileSync(join(FIXTURE, name), text);
    expect(readdirSync(FIXTURE).sort()).toEqual(Object.keys(files).sort());
    for (const [name, text] of Object.entries(files)) expect(readFileSync(join(FIXTURE, name), 'utf8'), name).toBe(text);
  });

  it('passes every check, at every stage', () => {
    const { files } = fixturePartition();
    const { ['manifest.json']: manifest, ...rest } = files;
    for (const stage of ['1', '2', '3', 'final'] as const) {
      const out = checkPartition({ manifest: manifest!, files: rest, stage });
      expect(out.problems, stage).toEqual([]);
      expect(out.partition?.containers.map((c) => c.id), stage).toEqual(CONTAINERS.map((c) => c.id));
    }
    const { partition } = checkPartition({ manifest: manifest!, files: rest, stage: 'final' });
    expect(partition!.zones.length).toBe(18);
    expect(partition!.sectors.length).toBe(38);
    // The renamed four are the names it carries [Starcom D-ZR, ZR13].
    expect(partition!.containers.map((c) => c.name)).toEqual(expect.arrayContaining(['Terra Sahulica', 'Terra Laurentia', 'Terra Amazonia', 'Terra Europaea']));
  });

  it('passes Stage 1 with outlines only, and refuses outlines only as anything later', () => {
    const outlinesOnly = broken((docs) => {
      for (const d of Object.values(docs)) d.features = d.features.filter((f) => f.properties.level === 'terra' || f.properties.level === 'mare');
    });
    expect(check(outlinesOnly, '1').problems).toEqual([]);
    expect(check(outlinesOnly, 'final').problems.join('\n')).toMatch(/terra:africana has no Zones/);
    // Stage 2 is Terra Africana with its Zones and Sectors, and every other container still an outline.
    const stage2 = broken((docs) => {
      for (const [file, d] of Object.entries(docs)) {
        if (file !== 'terra-africana.zsp.geojson') d.features = d.features.filter((f) => f.properties.level === 'terra' || f.properties.level === 'mare');
      }
    });
    expect(check(stage2, '2').problems).toEqual([]);
    expect(check(stage2, 'final').problems.join('\n')).toMatch(/has no Zones/);
  });
});

describe('what the checks refuse', () => {
  const refuses = (what: string, input: { manifest: string; files: Record<string, string> }, pattern: RegExp, stage: ZspStage = 'final') => {
    const { problems, partition } = check(input, stage);
    expect(problems.join('\n'), what).toMatch(pattern);
    expect(partition, `${what}: a partition that fails a check is not handed back`).toBeNull();
  };

  it('a file whose hash or length is not the manifest’s', () => {
    refuses('a changed byte', broken((docs) => void (sector(docs, 'zone:laurentia-west/sector:south').properties.name = 'changed'), false), /terra-laurentia\.zsp\.geojson: sha256/);
    const short = broken(() => {}, true);
    const m = JSON.parse(short.manifest) as { containers: { bytes: number }[] };
    m.containers[0]!.bytes += 1;
    refuses('a wrong length', { ...short, manifest: JSON.stringify(m) }, /bytes/);
  });

  it('a manifest that is not ZSP 2.0, or not under a licence NavCom may vendor', () => {
    refuses('ZSP 1.0', broken((_, m) => void (m.zsp = '1.0')), /zsp/);
    refuses('share-alike', broken((_, m) => void (m.licence = 'CC-BY-SA-4.0')), /licence/);
    refuses('non-commercial', broken((_, m) => void (m.licence = 'CC-BY-NC-4.0')), /licence/);
    expect(licenceAllowed('CC-BY-4.0')).toBe(true);
    expect(licenceAllowed('CC0-1.0')).toBe(true);
    expect(licenceAllowed('ODC-BY-1.0')).toBe(true);
    expect(licenceAllowed('Unicode-3.0')).toBe(true);
    for (const l of ['CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'ODbL-1.0', 'GPL-3.0', 'AGPL-3.0-only', '', undefined]) expect(licenceAllowed(l), String(l)).toBe(false);
  });

  it('a Sector drawn from a share-alike or non-commercial source, or from one that states no licence', () => {
    refuses('SA source', broken((docs) => void (sector(docs, 'zone:africana-west/sector:north').properties.sources = [{ name: 'GEM faults', licence: 'CC-BY-SA-4.0' }])), /zone:africana-west\/sector:north.*licence/);
    refuses('NC source', broken((docs) => void (sector(docs, 'zone:africana-west/sector:north').properties.sources = [{ name: 'MEOW', licence: 'CC-BY-NC-4.0' }])), /licence/);
    refuses('no licence', broken((docs) => void (sector(docs, 'zone:africana-west/sector:north').properties.sources = [{ name: 'somewhere' }])), /licence/);
  });

  it('a malformed id, or one at the wrong level, or a Sector whose id names another Zone', () => {
    refuses('malformed', broken((docs) => void (sector(docs, 'zone:sinica-east').properties.id = 'zone:Sinica_East')), /zone:Sinica_East/);
    refuses('wrong level', broken((docs) => void (sector(docs, 'zone:sinica-east/sector:north').properties.level = 'zone')), /level/);
    refuses('wrong Zone', broken((docs) => void (sector(docs, 'zone:sinica-east/sector:north').properties.parent = 'zone:sinica-west')), /parent/);
    refuses('a duplicate', broken((docs) => void (sector(docs, 'zone:sinica-east/sector:north').properties.id = 'zone:sinica-east/sector:south')), /twice/);
  });

  it('a file that holds another container, or none, or a Zone with no Sectors', () => {
    refuses('another container', broken((docs) => void (docs['terra-sinica.zsp.geojson']!.container = 'terra:indica')), /container/);
    refuses('no outline', broken((docs) => void (docs['terra-sinica.zsp.geojson']!.features = docs['terra-sinica.zsp.geojson']!.features.filter((f) => f.properties.level !== 'terra'))), /outline/);
    refuses(
      'a Zone with no Sectors',
      broken((docs) => {
        const d = docs['terra-sinica.zsp.geojson']!;
        d.features = d.features.filter((f) => f.properties.parent !== 'zone:sinica-east');
      }),
      /zone:sinica-east has no Sectors/
    );
  });

  it('a gap, where a point of the Earth is in no Sector', () => {
    refuses(
      'a gap',
      broken((docs) => {
        const f = sector(docs, 'zone:europaea-east/sector:north');
        f.geometry = { type: 'Polygon', coordinates: [box(15, 30, 60, 55)] };
      }),
      /in no Sector|area/
    );
  });

  it('an overlap, where a point is in two', () => {
    refuses(
      'an overlap',
      broken((docs) => {
        const f = sector(docs, 'zone:europaea-east/sector:north');
        f.geometry = { type: 'Polygon', coordinates: [box(15, 25, 60, 60)] };
      }),
      /in 2 Sectors|area/
    );
  });

  /** A Sector moved by `dx` degrees of longitude and `dy` of latitude, every ring with it. */
  const moved = (id: string, dx: number, dy: number) =>
    broken((docs) => {
      const f = sector(docs, id);
      const shift = (ring: number[][]) => ring.map(([x, y]) => [x! + dx, y! + dy]);
      f.geometry = f.geometry.type === 'Polygon'
        ? { type: 'Polygon', coordinates: (f.geometry.coordinates as number[][][]).map(shift) }
        : { type: 'MultiPolygon', coordinates: (f.geometry.coordinates as number[][][][]).map((p) => p.map(shift)) };
    });

  it('a Sector moved sideways by less than the grid: a strip of overlap and a strip of gap, and the same area', () => {
    // 0.6° west: between the grid's odd-degree columns, so no point of it lands in either strip, and a
    // Sector moved along a parallel keeps its area to the last digit (review, 2026-10-19).
    for (const dx of [-0.6, -1.5]) {
      const input = moved('zone:europaea-west/sector:north', dx, 0);
      const { problems, partition } = check(input);
      expect(problems.join('\n'), `${dx}°`).toMatch(/zone:europaea-west\/sector:north reaches outside zone:europaea-west/);
      expect(problems.join('\n'), `${dx}°`).toMatch(/beside zone:europaea-west\/sector:north, at \([^)]*\), is in no Sector of zone:europaea-west: a gap/);
      expect(partition, `${dx}°`).toBeNull();
    }
  });

  it('a strip of overlap between two Sectors of one Zone, narrower than the grid', () => {
    // The south Sector moved 0.6° north: it runs into its neighbour from 30° to 30.6° and leaves 0° to 0.6° bare.
    const { problems, partition } = check(moved('zone:europaea-west/sector:south', 0, 0.6));
    expect(problems.join('\n')).toMatch(/zone:europaea-west\/sector:south overlaps zone:europaea-west\/sector:north/);
    expect(partition).toBeNull();
  });

  it('a Sector drawn twice, on top of itself', () => {
    const twice = broken((docs) => {
      const d = docs['terra-sinica.zsp.geojson']!;
      const f = sector(docs, 'zone:sinica-east/sector:north');
      d.features.push({ ...f, properties: { ...f.properties, id: 'zone:sinica-east/sector:again', name: 'again' } });
    });
    expect(check(twice).problems.join('\n')).toMatch(/zone:sinica-east\/sector:north, zone:sinica-east\/sector:again lie on the same side of one edge/);
  });

  it('a Sector outside its own Zone', () => {
    refuses(
      'swapped',
      broken((docs) => {
        const a = sector(docs, 'zone:sahulica-west/sector:north');
        const b = sector(docs, 'zone:sahulica-east/sector:north');
        [a.geometry, b.geometry] = [b.geometry, a.geometry];
      }),
      /outside its Zone/
    );
  });

  it('a ring that is not closed, is wound the wrong way, or crosses itself', () => {
    refuses('unclosed', broken((docs) => void (sector(docs, 'zone:amazonia-west/sector:south').geometry = { type: 'Polygon', coordinates: [box(-150, -60, -90, -30).slice(0, -1)] })), /not closed/);
    refuses('clockwise', broken((docs) => void (sector(docs, 'zone:amazonia-west/sector:south').geometry = { type: 'Polygon', coordinates: [box(-150, -60, -90, -30).reverse()] })), /wound/);
    refuses(
      'a bow tie',
      broken((docs) => {
        sector(docs, 'zone:amazonia-west/sector:south').geometry = { type: 'Polygon', coordinates: [[[-150, -60], [-90, -30], [-90, -60], [-150, -30], [-150, -60]]] };
      }),
      /crosses itself/
    );
    refuses('off the Earth', broken((docs) => void (sector(docs, 'zone:amazonia-west/sector:south').geometry = { type: 'Polygon', coordinates: [[[-150, -60], [-90, -60], [-90, -95], [-150, -60]]] })), /off the Earth|position/);
  });

  it('a Zone whose system is not one lower-case word, and takes any word that is, as ZR6 gives examples', () => {
    for (const system of ['Chain Zone', '', 'chain\u202e', 42, undefined]) {
      refuses(`system ${JSON.stringify(system)}`, broken((docs) => void (sector(docs, 'zone:laurentia-east').properties.system = system)), /system/);
    }
    for (const system of ['chain', 'transform', 'fan', 'strait']) {
      const { problems } = check(broken((docs) => void (sector(docs, 'zone:laurentia-east').properties.system = system)));
      expect(problems, system).toEqual([]);
    }
  });

  it('a Sector outside 50,000 to 500,000 km² with no reason given, and a landform not in the IAU’s words', () => {
    refuses('no size reason', broken((docs) => void delete sector(docs, 'zone:laurentia-east/sector:north').properties.size_reason), /km²/);
    refuses('not an IAU term', broken((docs) => void (sector(docs, 'zone:laurentia-east/sector:north').properties.descriptor = 'Mountains')), /descriptor/);
    expect(IAU_DESCRIPTORS.has('Planitia')).toBe(true);
    expect(IAU_DESCRIPTORS.has('Montes')).toBe(true);
    expect(IAU_DESCRIPTORS.has('Mountains')).toBe(false);
  });

  it('a retired id covered by a Zone the partition does not hold', () => {
    refuses('a missing Zone', broken((_, m) => void (m.retired = [{ id: 'zone:sahel', name: 'Sahel Zone', covered_by: ['zone:nowhere'] }])), /retired/);
  });

  it('containers that do not cover the Earth, at Stage 1 too', () => {
    const missing = broken((docs, m) => {
      delete docs['terra-sinica.zsp.geojson'];
      m.containers = (m.containers as { id: string }[]).filter((c) => c.id !== 'terra:sinica');
    });
    refuses('a hole where Terra Sinica was', missing, /in no Terra or Mare/, '1');
  });
});

describe('a retired 1.0 id', () => {
  it('finds the Zones that now cover it, so reports naming it still find their places', () => {
    const { manifest } = fixturePartition();
    expect(coveringZones(manifest, 'zone:sahel')).toEqual(['zone:africana-west', 'zone:europaea-west']);
    expect(coveringZones(manifest, 'zone:africana-west')).toBeNull();
  });
});

describe('NavCom’s reader is NavCom’s own', () => {
  it('carries no Starcom code: nothing under src/zones names Starcom’s licence', () => {
    // Starcom is AGPL-3.0-only and NavCom Apache-2.0: the reader is written against the format, not copied.
    for (const f of readdirSync(SOURCE)) {
      const text = readFileSync(join(SOURCE, f), 'utf8');
      expect(text, f).not.toMatch(/AGPL|Affero|GNU General Public/i);
      expect(text, f).not.toMatch(/Copyright.*Starcom/i);
    }
  });
});
