/**
 * What a tap or a hover finds, against the committed geometry [map.md §6: every shape is a door].
 *
 * The view here is the whole world on a Pixel 5's width, where California is about 11 px across:
 * the case a tap that has to land inside a shape fails, and the reason a lit shape keeps a margin.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decode, inside, lightsOf, mercator, type Topology } from './topology';
import { LIT_SLOP, pick, unitAt, type View } from './pick';

const FILE = fileURLToPath(new URL('../../../static/grid/world.json', import.meta.url));
const layers = decode(JSON.parse(readFileSync(FILE, 'utf8')) as Topology);
const provinces = layers['provinces']!.shapes;
const countries = layers['world']!.shapes;

/** The whole world on a 393 px wide phone. */
const WORLD: View = { cx: 0.5, cy: 0.5, scale: 393, width: 393, height: 600 };

function screenOf(v: View, lon: number, lat: number): [number, number] {
  const [x, y] = mercator(lon, lat);
  return [(x - v.cx) * v.scale + v.width / 2, (y - v.cy) * v.scale + v.height / 2];
}

const none = new Set<string>();

describe('what is under a point on the map', () => {
  it('finds a country where no province is drawn: Nairobi is in Kenya', () => {
    const hit = pick(WORLD, screenOf(WORLD, 36.82, -1.29), { provinces, countries, lit: none });
    expect(hit).toMatchObject({ kind: 'shape', layer: 'world', shape: { id: 'ke', name: 'Kenya' } });
  });

  it('finds an unlit province itself, not the country around it', () => {
    const lit = new Set(['us-ca']);
    expect(pick(WORLD, screenOf(WORLD, -99, 31), { provinces, countries, lit })).toMatchObject({
      kind: 'shape',
      layer: 'provinces',
      shape: { id: 'us-tx', name: 'Texas' }
    });
    // Ely is 5 px from lit California at this zoom, so the slack gives it to California: what is
    // lit is what there is to do. Zoomed in, Nevada is Nevada.
    expect(pick(WORLD, screenOf(WORLD, -114.9, 39.25), { provinces, countries, lit })).toMatchObject({ shape: { id: 'us-ca' } });
    const [cx, cy] = mercator(-114.9, 39.25);
    const near: View = { ...WORLD, cx, cy, scale: 393 * 16 };
    expect(pick(near, screenOf(near, -114.9, 39.25), { provinces, countries, lit })).toMatchObject({ shape: { id: 'us-nv' } });
  });

  it('lets a national mission take no tap from the provinces it outlines: Texas is Texas at every zoom', () => {
    /*
     * Found in review (2026-10-18). Real packages are filed nationally (`recall_check-home` is `us`),
     * and when every lit shape outranked every province, the US, which holds every state, answered
     * for all of them: a tap on Texas opened the United States. Only what a mission fills outranks a
     * province, and a national mission is still listed on Texas's screen [filedUnder].
     */
    const ids = new Set(provinces.map((s) => s.id));
    const { fill, outline } = lightsOf(['us', 'us-ca'], ids);
    expect([...outline]).toEqual(['us']);
    expect([...fill]).toEqual(['us-ca']);
    for (const zoom of [1, 8, 64]) {
      const [cx, cy] = mercator(-99.9, 31.5);
      const v: View = { ...WORLD, cx, cy, scale: 393 * zoom };
      expect(pick(v, screenOf(v, -99.9, 31.5), { provinces, countries, lit: fill }), `×${zoom}`).toMatchObject({
        layer: 'provinces',
        shape: { id: 'us-tx' }
      });
    }
  });

  it('lights a subdivision the file has no outline for by its country, which then answers for it: ke-30 is Kenya', () => {
    const { fill, outline } = lightsOf(['ke-30', null], new Set(provinces.map((s) => s.id)));
    expect([...fill]).toEqual(['ke']);
    expect([...outline]).toEqual([]);
    expect(pick(WORLD, screenOf(WORLD, 36.82, -1.29), { provinces, countries, lit: fill })).toMatchObject({ shape: { id: 'ke' } });
  });

  it('finds open sea empty', () => {
    expect(pick(WORLD, screenOf(WORLD, -30, 30), { provinces, countries, lit: none })).toBeNull();
  });

  it('keeps a lit province within reach of a thumb at world zoom: 10 px off California’s coast is still California', () => {
    const california = provinces.find((s) => s.id === 'us-ca')!;
    // From inland, west along the row until the coast is crossed, then 10 px further out to sea.
    let [sx, sy] = screenOf(WORLD, -120.5, 37.5);
    while (inside(california.rings, unitAt(WORLD, [sx, sy]))) sx -= 0.5;
    const offshore: [number, number] = [sx - 10, sy];
    expect(10).toBeLessThan(LIT_SLOP);
    expect(pick(WORLD, offshore, { provinces, countries, lit: none }), 'unlit, the sea is the sea').toBeNull();
    expect(pick(WORLD, offshore, { provinces, countries, lit: new Set(['us-ca']) })).toMatchObject({
      kind: 'shape',
      layer: 'provinces',
      shape: { id: 'us-ca' }
    });
  });

  it('keeps a lit country within reach too, where a mission lights Kenya for want of its province', () => {
    const kenya = countries.find((s) => s.id === 'ke')!;
    let [sx, sy] = screenOf(WORLD, 38, 0);
    while (inside(kenya.rings, unitAt(WORLD, [sx, sy]))) sx += 0.5;
    // Just past Kenya's coast, into the Indian Ocean.
    const offshore: [number, number] = [sx + 4, sy];
    expect(pick(WORLD, offshore, { provinces, countries, lit: none })).toBeNull();
    expect(pick(WORLD, offshore, { provinces, countries, lit: new Set(['ke']) })).toMatchObject({ shape: { id: 'ke' } });
  });

  it('asks for no slack once zoomed in, where 12 px is a few hundred metres and not a state', () => {
    const near: View = { ...WORLD, scale: 393 * 512 };
    const california = provinces.find((s) => s.id === 'us-ca')!;
    // Recentred inland of the Big Sur coast, which runs straight with no bay to cross, then out to sea.
    const [ux, uy] = mercator(-121.3, 36.1);
    const v: View = { ...near, cx: ux, cy: uy };
    let [sx, sy] = [v.width / 2, v.height / 2];
    expect(inside(california.rings, unitAt(v, [sx, sy]))).toBe(true);
    while (inside(california.rings, unitAt(v, [sx, sy]))) sx -= 1;
    expect(pick(v, [sx - 30, sy], { provinces, countries, lit: new Set(['us-ca']) })).toBeNull();
  });
});
