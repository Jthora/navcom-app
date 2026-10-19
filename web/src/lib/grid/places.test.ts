/**
 * The map's only points: places on public record [map.md §6; invariant 1].
 *
 * The constructors first, on records made here — including a refuge carrying coordinates it must
 * never carry, which the parser would refuse, so that the rule is tested where a parser cannot
 * help. Then the file every phone fetches when Places is switched on, read from `build/`, because
 * this project has three times shipped a rule the logic honoured and the output did not.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Mission, ResourceRecord } from '@navcom/core';
import { RESOURCE_TYPES, atPrecision, decimalsOf, isConfidential } from '@navcom/core';
import { project } from './topology';
import {
  ON_THE_MAP,
  PLACES_DECIMALS,
  PLACES_MAX_GZ,
  onTheMap,
  placesFileOf,
  placesOfDirectory,
  placesOfMissions,
  type PlacesFile
} from './places';

const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));

function record(over: Partial<ResourceRecord> & { id: string; type: ResourceRecord['type'] }): ResourceRecord {
  return { name: over.id, region: 'testville', ...over } as ResourceRecord;
}

function mission(point: Mission['placement']['point'], address = '30079:abc:d'): Mission {
  return { address, title: 'Water at the library', placement: { jurisdiction: 'us-ca', point } } as Mission;
}

describe('a mission’s ring', () => {
  it('is drawn where a package locates a subject on public record, as wide as its precision', () => {
    const [ring] = placesOfMissions([
      mission({ lat: 36.77, lon: -119.41, precision: '1km', kind: 'subject_location', coarsened: false })
    ]);
    expect(ring).toMatchObject({ kind: 'mission', address: '30079:abc:d', title: 'Water at the library', lat: 36.77, lon: -119.41 });
    const [x, y] = project(-119.41, 36.77);
    expect(ring!.x).toBeCloseTo(x, 9);
    expect(ring!.y).toBeCloseTo(y, 9);
    const metres = (p: (typeof ring)) => (p?.kind === 'mission' ? p.metres : NaN);
    expect(metres(ring)).toBeGreaterThan(1_000);
    const [city] = placesOfMissions([mission({ lat: 36.8, lon: -119.4, precision: 'city', kind: 'subject_location', coarsened: false })]);
    expect(metres(city)).toBeGreaterThan(10_000);
  });

  it('is drawn no finer than a kilometre for a package placed at an address, until D5 and Q19 are answered', () => {
    /*
     * A package carries no resource type, so a youth shelter and a library look alike here: the hold
     * on the directory's shelters is a hold on this path too [map.md §6]. The mission keeps its point
     * at five places [core: missions/package.ts]; only what the map draws is coarser, and the ring
     * is drawn at the 1 km point it rounds to, so its centre gives nothing finer away.
     */
    const [ring] = placesOfMissions([
      mission({ lat: 36.73781, lon: -119.78714, precision: 'address', kind: 'subject_location', coarsened: false })
    ]);
    expect(ring).toMatchObject({ kind: 'mission', lat: 36.74, lon: -119.79 });
    expect(ring?.kind === 'mission' ? ring.metres : NaN).toBeGreaterThanOrEqual(1_000);
  });

  it('is not drawn for a point that only stands for a jurisdiction, or for none: a circle there would invent a location', () => {
    expect(placesOfMissions([mission({ lat: 39.4, lon: -104.9, precision: 'city', kind: 'jurisdiction', coarsened: true })])).toEqual([]);
    expect(placesOfMissions([mission(null)])).toEqual([]);
  });
});

describe('the directory’s points', () => {
  const refuge = record({ id: 'testville-dv-1', type: 'dv', lat: 39.95233, lon: -75.16523 } as never);
  const meal = record({ id: 'testville-meal-1', type: 'meal', lat: 39.95233, lon: -75.16523 });
  const shelter = record({ id: 'testville-shelter-1', type: 'shelter', lat: 39.9, lon: -75.1 });
  const nowhere = record({ id: 'testville-meal-2', type: 'meal' });

  it('keeps a refuge off the map whatever it carries, through the rule that withholds its address', () => {
    expect(isConfidential('dv')).toBe(true);
    expect(onTheMap(refuge)).toBe(false);
    expect(placesFileOf([{ region: 'testville', records: [refuge, meal] }]).regions['testville']).toEqual([
      null,
      [-75.1652, 39.9523]
    ]);
  });

  it('decides every type there is, so a new one is a decision before it is a point [D5]', () => {
    // A deny-list drew any type added later by default; this one fails to compile until a person decides.
    expect(Object.keys(ON_THE_MAP).sort()).toEqual([...RESOURCE_TYPES].sort());
    // Held back: the places people sleep, overnight warming and residential detox among them, and refuges.
    expect(RESOURCE_TYPES.filter((t) => !ON_THE_MAP[t]).sort()).toEqual(['detox', 'dv', 'shelter', 'warming', 'youth']);
    expect(onTheMap(shelter)).toBe(false);
    expect(onTheMap(record({ id: 'testville-warming-1', type: 'warming', lat: 39.9, lon: -75.1 }))).toBe(false);
    expect(onTheMap(record({ id: 'testville-detox-1', type: 'detox', lat: 39.9, lon: -75.1 }))).toBe(false);
    expect(onTheMap(meal)).toBe(true);
  });

  it('keeps each region’s records in the order its index lists them, with a gap for each one not drawn', () => {
    const file = placesFileOf([{ region: 'testville', records: [nowhere, meal, shelter] }]);
    expect(file.decimals).toBe(PLACES_DECIMALS);
    expect(file.regions['testville']).toEqual([null, [-75.1652, 39.9523], null]);
  });

  it('becomes region circles with their counts, and record points that know their place in the list', () => {
    const file: PlacesFile = { v: 1, decimals: 4, regions: { testville: [null, [-75.1652, 39.9523]] } };
    const { regions, records } = placesOfDirectory(
      {
        centroids: [{ region: 'testville', name: 'Testville', lat: 39.95, lon: -75.17 }],
        figures: { testville: { region: 'testville', name: 'Testville', records: 2, confirmedByPerson: 0, freshest: null, languages: ['en'] } }
      },
      file
    );
    // One of its two is not drawn, and its ring says so where the records take over [invariant 7].
    expect(regions).toEqual([
      expect.objectContaining({ kind: 'region', region: 'testville', name: 'Testville', records: 2, unmapped: 1, reach: 24 })
    ]);
    // Without the places file nobody knows how many are drawn: unknown, never none.
    expect(placesOfDirectory({ centroids: [{ region: 'testville', name: 'Testville', lat: 39.95, lon: -75.17 }], figures: {} }, null).regions).toEqual([
      expect.objectContaining({ region: 'testville', unmapped: null })
    ]);
    expect(records).toEqual([expect.objectContaining({ kind: 'record', region: 'testville', regionName: 'Testville', index: 1, lat: 39.9523, lon: -75.1652 })]);
  });
});

function built(path: string): string {
  const file = join(BUILD, path);
  if (!existsSync(file)) throw new Error(`${path} was not built`);
  return readFileSync(file, 'utf8');
}

describe('the places file a phone fetches when Places is switched on', () => {
  const raw = () => built('grid/places.json');
  const file = () => JSON.parse(raw()) as PlacesFile;

  it('lists every region’s records in its index’s order, each at its own coordinates rounded, or a gap', () => {
    const { regions, decimals } = file();
    expect(decimals).toBe(PLACES_DECIMALS);
    const slugs = Object.keys(regions);
    expect(slugs.length).toBeGreaterThan(1_900);
    let drawn = 0;
    const wrong: string[] = [];
    for (const slug of slugs) {
      const index = JSON.parse(built(`console-index/${slug}.json`)) as { id: string; type: string; at?: [number, number] }[];
      const points = regions[slug]!;
      if (points.length !== index.length) wrong.push(`${slug}: ${points.length} points for ${index.length} records`);
      index.forEach((entry, i) => {
        const p = points[i];
        if (p === null || p === undefined) return;
        drawn += 1;
        // Rounded the way every published coordinate is [core: directory/precision.ts]: halves up.
        const want = entry.at?.map((n) => atPrecision(n, decimals));
        if (!want || want[0] !== p[0] || want[1] !== p[1]) wrong.push(`${slug}[${i}] ${entry.id}: ${JSON.stringify(p)} vs ${JSON.stringify(entry.at)}`);
        if (!ON_THE_MAP[entry.type as keyof typeof ON_THE_MAP] || isConfidential(entry.type)) wrong.push(`${slug}[${i}] ${entry.id} is a ${entry.type}`);
      });
      // The index hands off what the map draws and nothing else: no held-back type carries its point there.
      index.forEach((entry, i) => {
        if (entry.at && !ON_THE_MAP[entry.type as keyof typeof ON_THE_MAP]) wrong.push(`console-index/${slug}[${i}] ${entry.id} is a ${entry.type} with a point`);
      });
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    // Something drawn, so a passing run means something: the meals and the rest, thousands of them.
    expect(drawn).toBeGreaterThan(5_000);
  });

  it('holds no refuge’s coordinates, checked against every refuge the directory publishes', () => {
    const { records } = JSON.parse(built('directory.json')) as { records: { id: string; region: string; type: string }[] };
    const { regions } = file();
    const refuges = records.filter((r) => isConfidential(r.type));
    for (const r of refuges) {
      const index = JSON.parse(built(`console-index/${r.region}.json`)) as { id: string }[];
      expect(regions[r.region]![index.findIndex((e) => e.id === r.id)], r.id).toBeNull();
    }
    // None today: the importer has never produced one [confidential.ts]. The rule above is what
    // holds the day one is added from the field, and the constructor test is what proves it.
    expect(refuges.length).toBeGreaterThanOrEqual(0);
  });

  it('carries no coordinate finer than the precision chosen for it', () => {
    const over = raw().match(new RegExp(`-?\\d+\\.\\d{${PLACES_DECIMALS + 1},}`, 'g')) ?? [];
    expect(over.slice(0, 5)).toEqual([]);
    for (const points of Object.values(file().regions)) {
      for (const p of points) if (p) for (const n of p) expect(decimalsOf(String(n)) ?? 99).toBeLessThanOrEqual(PLACES_DECIMALS);
    }
  });

  it('stays inside its budget, paid only by somebody who switches Places on', () => {
    expect(gzipSync(raw(), { level: 9 }).length).toBeLessThanOrEqual(PLACES_MAX_GZ);
  });
});
