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
import { MAX_LAT, decode, mercator, unmercator, type Ring, type Topology } from './topology';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FILE = fileURLToPath(new URL('../../../static/grid/world.json', import.meta.url));
const raw = readFileSync(FILE);
const topology = JSON.parse(raw.toString('utf8')) as Topology;
const layers = decode(topology);

/** Even-odd across every ring in a layer: inside one province, or inside none. */
function inside(rings: Ring[], [x, y]: [number, number]): boolean {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

describe('the projection', () => {
  it('puts the equator and the meridian at the centre', () => {
    expect(mercator(0, 0)).toEqual([0.5, 0.5]);
    expect(mercator(-180, 0)[0]).toBe(0);
    expect(mercator(180, 0)[0]).toBe(1);
  });

  it('clamps at its own limit instead of running to infinity', () => {
    expect(mercator(0, 89)).toEqual(mercator(0, MAX_LAT));
    expect(mercator(0, 89)[1]).toBeCloseTo(0, 6);
  });

  it('inverts, so a tap can be turned back into a place', () => {
    const [lon, lat] = unmercator(...mercator(-83.05, 42.33));
    expect(lon).toBeCloseTo(-83.05, 6);
    expect(lat).toBeCloseTo(42.33, 6);
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
        for (const v of r) expect(v >= 0 && v <= 1).toBe(true);
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
      expect(inside(provinces, mercator(lon, lat)), name).toBe(true);
    }
    // And somewhere with no region, so no provinces: Paris sits in a country outline only.
    expect(inside(provinces, mercator(2.35, 48.86))).toBe(false);
    expect(inside(layers['world']!.rings, mercator(2.35, 48.86))).toBe(true);
  });

  it('keeps each province’s code, so a mission’s jurisdiction finds the right shape', () => {
    const california = layers['provinces']!.shapes.find((s) => s.id === 'us-ca');
    expect(california).toBeDefined();
    // The shape filed as us-ca is the one Los Angeles is in, and Phoenix is not.
    expect(inside(california!.rings, mercator(-118.24, 34.05))).toBe(true);
    expect(inside(california!.rings, mercator(-112.07, 33.45))).toBe(false);
  });

  it('leaves out Antarctica, which Mercator would stretch across the whole bottom edge', () => {
    const south = mercator(0, -60)[1];
    const anyPolar = layers['world']!.rings.some((r) => {
      for (let i = 1; i < r.length; i += 2) if (r[i]! < south) return false;
      return true;
    });
    expect(anyPolar).toBe(false);
  });

  it('stays inside the budget map.md set for it', () => {
    expect(gzipSync(raw).length).toBeLessThanOrEqual(250 * 1024);
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
    const covered = new Set(topology.navcom?.regionCountries ?? []);
    const missing = [...filed].filter((c) => !covered.has(c));
    expect(missing, `regions exist in ${missing.join(', ')} but the grid has no provinces there — run node scripts/grid-geometry.mjs`).toEqual([]);
  });
});
