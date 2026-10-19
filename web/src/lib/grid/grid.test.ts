/**
 * The grid's geometry: decoded correctly, and still covering every country that has a region.
 *
 * The second half is the one that matters over time. Detail follows the regions — provinces are
 * drawn only where a region is filed [map.md §3] — so the day somebody adds a region in Canada,
 * the committed file is stale and nothing else would notice. This test is what notices.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { HEIGHT, METRES_PER_UNIT, decode, inside, project, unproject, type Ring, type Topology } from './topology';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FILE = fileURLToPath(new URL('../../../static/grid/world.json', import.meta.url));
const raw = readFileSync(FILE);
const topology = JSON.parse(raw.toString('utf8')) as Topology;
const layers = decode(topology);


/** A shape's area on the map, in the map's own square units: even-odd, so a hole takes its area away. */
function areaOf(rings: readonly Ring[]): number {
  let a = 0;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j]! * r[i + 1]! - r[i]! * r[j + 1]!;
  }
  return Math.abs(a / 2);
}

describe('the projection: Equal Earth, the whole Earth at its true areas [map.md §3; D1]', () => {
  it('puts the equator and the meridian at the centre, and the world is about twice as wide as it is tall', () => {
    const [x, y] = project(0, 0);
    expect(x).toBeCloseTo(0.5, 12);
    expect(y).toBeCloseTo(HEIGHT / 2, 12);
    expect(project(-180, 0)[0]).toBeCloseTo(0, 12);
    expect(project(180, 0)[0]).toBeCloseTo(1, 12);
    // Šavrič, Patterson and Jenny (2018): the full map is 2.05 times as wide as it is tall.
    expect(1 / HEIGHT).toBeCloseTo(2.0546, 3);
  });

  it('reaches both poles, which Web Mercator never could: it stopped at 85°', () => {
    expect(project(0, 90)[1]).toBeCloseTo(0, 12);
    expect(project(0, -90)[1]).toBeCloseTo(HEIGHT, 12);
    // 89° and 85° are different places, so they are drawn in different places.
    expect(project(0, 89)[1]).toBeLessThan(project(0, 85.05)[1] - 1e-3);
    // A pole is a line, not a point: Equal Earth draws it about 0.59 of the equator's width.
    const pole = project(180, 90)[0] - project(-180, 90)[0];
    expect(pole).toBeGreaterThan(0.5);
    expect(pole).toBeLessThan(0.65);
  });

  it('inverts, so a tap can be turned back into a place, at the poles too', () => {
    for (const [lon, lat] of [[-83.05, 42.33], [151.21, -33.87], [0, -89.9], [179.99, 89.9], [-179.99, -60]] as const) {
      const [l, p] = unproject(...project(lon, lat));
      expect(l, `${lon},${lat}`).toBeCloseTo(lon, 6);
      expect(p, `${lon},${lat}`).toBeCloseTo(lat, 6);
    }
  });

  it('draws areas true: Greenland is about a quarter of Brazil and an eighth of Russia, as on the ground', () => {
    /*
     * Fails under Web Mercator, which drew Greenland larger than Brazil. A Sector is defined by its
     * area on the ground, 50,000 to 500,000 km² [Starcom D-ZR, ZR7], and a projection that inflates
     * the high latitudes would draw two equal Sectors as one several times the other.
     */
    const area = (id: string) => areaOf(layers['world']!.shapes.find((s) => s.id === id)!.rings) * METRES_PER_UNIT ** 2;
    // Square kilometres, as published: Greenland 2,166,086; Brazil 8,515,767; Russia 17,098,246;
    // Canada 9,984,670; Australia 7,692,024. Not Antarctica: its 1:110m outline leaves the ice shelves out.
    const truth = { gl: 2_166_086e6, br: 8_515_767e6, ru: 17_098_246e6, ca: 9_984_670e6, au: 7_692_024e6 };
    for (const [a, b] of [['gl', 'br'], ['gl', 'ru'], ['au', 'ca'], ['gl', 'au']] as const) {
      const ratio = area(a) / area(b) / (truth[a] / truth[b]);
      expect(ratio, `${a}:${b}, as drawn against as on the ground`).toBeGreaterThan(0.9);
      expect(ratio, `${a}:${b}, as drawn against as on the ground`).toBeLessThan(1.1);
    }
    // And each against the ground itself, to the 1:110m outline's accuracy.
    expect(area('br') / truth.br).toBeGreaterThan(0.9);
    expect(area('br') / truth.br).toBeLessThan(1.1);
  });
});

describe('the committed geometry', () => {
  it('has both layers, closed rings, and nothing outside the square', () => {
    expect(layers['world']!.rings.length).toBeGreaterThanOrEqual(176);
    expect(layers['provinces']!.rings.length).toBeGreaterThan(0);
    for (const { rings } of Object.values(layers)) {
      for (const r of rings) {
        expect(r.length % 2).toBe(0);
        expect(r.length).toBeGreaterThanOrEqual(6);
        expect(r[0]).toBeCloseTo(r[r.length - 2]!, 5);
        expect(r[1]).toBeCloseTo(r[r.length - 1]!, 5);
        for (let i = 0; i < r.length; i += 2) {
          expect(r[i]! >= -1e-6 && r[i]! <= 1 + 1e-6).toBe(true);
          expect(r[i + 1]! >= -1e-6 && r[i + 1]! <= HEIGHT + 1e-6).toBe(true);
        }
      }
    }
  });

  it('puts real cities inside real provinces, which a wrongly stitched arc would not', () => {
    const provinces = layers['provinces']!.rings;
    for (const [name, lon, lat] of [
      ['Detroit', -83.05, 42.33],
      ['London', -0.12, 51.5],
      ['Melbourne', 144.96, -37.81],
      ['San Juan', -66.1, 18.46]
    ] as const) {
      expect(inside(provinces, project(lon, lat)), name).toBe(true);
    }
    // And somewhere with no region, so no provinces: Paris sits in a country outline only.
    expect(inside(provinces, project(2.35, 48.86))).toBe(false);
    expect(inside(layers['world']!.rings, project(2.35, 48.86))).toBe(true);
  });

  it('keeps each province’s code, so a mission’s jurisdiction finds the right shape', () => {
    const california = layers['provinces']!.shapes.find((s) => s.id === 'us-ca');
    expect(california).toBeDefined();
    // The shape filed as us-ca is the one Los Angeles is in, and Phoenix is not.
    expect(inside(california!.rings, project(-118.24, 34.05))).toBe(true);
    expect(inside(california!.rings, project(-112.07, 33.45))).toBe(false);
  });

  it('keeps Antarctica, which Mercator stretched across the whole bottom edge and Equal Earth draws at its size', () => {
    /*
     * Rewritten on purpose (2026-10-18, D1). It was "leaves out Antarctica": under Web Mercator the
     * continent was the largest shape on screen, so it was dropped as scenery that misleads. Equal
     * Earth draws it at its true area, and Starcom's Terra Antarctica and Mare Australe run to the pole.
     */
    const antarctica = layers['world']!.shapes.find((s) => s.id === 'aq');
    expect(antarctica?.name).toBe('Antarctica');
    expect(inside(antarctica!.rings, project(0, -85))).toBe(true);
    expect(inside(antarctica!.rings, project(135, -89.5))).toBe(true);
    // Its ring runs along the pole, which Equal Earth draws as the map's bottom edge.
    expect(antarctica!.bbox[3]).toBeCloseTo(HEIGHT, 4);
  });

  it('stays inside the budget map.md set for it', () => {
    expect(gzipSync(raw).length).toBeLessThanOrEqual(250 * 1024);
  });
});

describe('every shape says what it is', () => {
  // Hover and tap name what is under them [map.md §6]: a shape with no id or name is a dead tap.
  it('gives every country an id, in the form a mission files it, except the two Natural Earth leaves without one', () => {
    const countries = layers['world']!.shapes;
    for (const s of countries) if (s.id !== null) expect(s.id, s.name ?? '').toMatch(/^[a-z]{2}$/);
    // Disputed, and coded -99 at the source: named here so a third becomes a decision, not a drift.
    expect(countries.filter((s) => s.id === null).map((s) => s.name).sort()).toEqual(['N. Cyprus', 'Somaliland']);
    expect(countries.every((s) => typeof s.name === 'string' && s.name.length > 0)).toBe(true);
  });

  it('puts Nairobi inside the shape filed as Kenya, which no region is in', () => {
    const kenya = layers['world']!.shapes.find((s) => s.id === 'ke');
    expect(kenya?.name).toBe('Kenya');
    expect(inside(kenya!.rings, project(36.82, -1.29))).toBe(true);
    expect(inside(kenya!.rings, project(39.28, -6.8))).toBe(false); // Dar es Salaam
  });

  it('names each province beside its code', () => {
    expect(layers['provinces']!.shapes.find((s) => s.id === 'us-ca')?.name).toBe('California');
    expect(layers['provinces']!.shapes.every((s) => typeof s.name === 'string' && s.name.length > 0)).toBe(true);
  });

  it('gives every shape a box that holds all of its rings, so a tap can skip it cheaply', () => {
    for (const { shapes } of Object.values(layers)) {
      for (const s of shapes) {
        const [x0, y0, x1, y1] = s.bbox;
        for (const r of s.rings) {
          for (let i = 0; i < r.length; i += 2) {
            expect(r[i]! >= x0 && r[i]! <= x1 && r[i + 1]! >= y0 && r[i + 1]! <= y1).toBe(true);
          }
        }
      }
    }
  });
});

describe('detail follows the regions', () => {
  it('has provinces for every country a region is filed in', () => {
    const dir = join(ROOT, 'data', 'regions');
    const filed = new Set<string>();
    for (const slug of readdirSync(dir)) {
      const f = join(dir, slug, 'region.json');
      if (slug.startsWith('_') || !existsSync(f)) continue;
      const c = (JSON.parse(readFileSync(f, 'utf8')) as { country: string }).country;
      if (c !== 'XX' && c !== 'ZZ') filed.add(c);
    }
    const covered = new Set((topology.navcom?.regionCountries as string[] | undefined) ?? []);
    const missing = [...filed].filter((c) => !covered.has(c));
    expect(missing, `regions exist in ${missing.join(', ')} but the grid has no provinces there — run node scripts/grid-geometry.mjs`).toEqual([]);
  });
});
