/**
 * Open missions counted by Zone and Sector [docs/design/map.md, Missions on Zones]: missions, never
 * people, placed by the point a package gives its subject, at every level the phone holds, and said to
 * be near an edge, at each level, rather than counted silently on one side of a line the phone draws
 * only so precisely.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { project, type Topology } from './topology';
import { outlinesOf, sectorsOf } from './layers/zones';
import { countsOf, openSaid, type Placed } from './layers/zone-missions';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(WEB, 'e2e/fixtures/zsp');
const json = <T>(f: string) => JSON.parse(readFileSync(join(FIXTURE, f), 'utf8')) as T;
const outlines = outlinesOf(json<Topology>('outlines.json'));
const laurentia = sectorsOf(json<Topology>('terra-laurentia.json'));

const at = (lon: number, lat: number, d: string, metres = 1113): Placed => {
  const [x, y] = project(lon, lat);
  return { x, y, lon, lat, metres, address: `30079:k:${d}`, title: d };
};

describe('counting', () => {
  it('counts a mission in its Terra and its Zone, and in its Sector once its container is open', () => {
    const depot = at(-100, 55, 'depot');
    const closed = countsOf(outlines, {}, [depot]);
    expect(closed.placed).toBe(1);
    expect(closed.in.get('terra:laurentia')?.map((m) => m.title)).toEqual(['depot']);
    expect(closed.in.get('zone:laurentia-west')?.map((m) => m.title)).toEqual(['depot']);
    expect(closed.in.has('zone:laurentia-west/sector:north')).toBe(false);
    const open = countsOf(outlines, { 'terra:laurentia': laurentia }, [depot]);
    expect(open.in.get('zone:laurentia-west/sector:north')?.map((m) => m.title)).toEqual(['depot']);
    expect(open.in.has('zone:laurentia-west/sector:south')).toBe(false);
    expect(open.near.size).toBe(0);
  });

  it('counts each mission once at each level, and nothing where nothing is', () => {
    const c = countsOf(outlines, {}, [at(-100, 55, 'a'), at(-120, 20, 'b'), at(-60, 20, 'c')]);
    expect(c.in.get('zone:laurentia-west')).toHaveLength(2);
    expect(c.in.get('zone:laurentia-east')).toHaveLength(1);
    expect(c.in.get('terra:laurentia')).toHaveLength(3);
    expect(c.in.get('terra:africana')).toBeUndefined();
    expect(openSaid(0)).toBe('Nothing open');
    expect(openSaid(1)).toBe('1 open mission');
    expect(openSaid(3)).toBe('3 open missions');
  });

  it('says a mission is near its edge, and with whom, when the drawn lines cannot say which side it is on', () => {
    // 0.01° west of the line between the two Laurentian Zones at 45°N: about 790 m, inside the
    // drift the vendoring measured plus the mission's own kilometre.
    expect(outlines.navcom.simplified_m).toBeGreaterThan(0);
    const c = countsOf(outlines, {}, [at(-90.01, 45, 'edge'), at(-120, 20, 'clear')]);
    expect(c.near.get('zone:laurentia-west')?.map((n) => [n.mission.title, n.with])).toEqual([['edge', ['Laurentia East Zone']]]);
    expect([...c.near.values()].flat().some((n) => n.mission.title === 'clear')).toBe(false);
  });
});

describe('a mission with no ring, placed by the Zone its package names [interchange rev 9]', () => {
  const named = (d: string, zone: string, sector: string | null = null) => ({ address: `30079:k:${d}`, title: d, zone, sector });

  it('is counted in that Zone and its Terra, and in the Sector it names, near no edge', () => {
    const c = countsOf(outlines, { 'terra:laurentia': laurentia }, [], {}, [named('drive', 'zone:laurentia-west', 'zone:laurentia-west/sector:north')]);
    expect(c.placed).toBe(1);
    expect(c.named).toBe(1);
    expect(c.in.get('terra:laurentia')?.map((m) => m.title)).toEqual(['drive']);
    expect(c.in.get('zone:laurentia-west')?.map((m) => m.title)).toEqual(['drive']);
    expect(c.in.get('zone:laurentia-west/sector:north')?.map((m) => m.title)).toEqual(['drive']);
    expect(c.near.size).toBe(0);
  });

  it('is counted beside the missions placed by their rings, in no Sector when it names none', () => {
    const c = countsOf(outlines, { 'terra:laurentia': laurentia }, [at(-100, 55, 'depot')], {}, [named('drive', 'zone:laurentia-west')]);
    expect(c.in.get('zone:laurentia-west')?.map((m) => m.title)).toEqual(['depot', 'drive']);
    expect(c.in.get('zone:laurentia-west/sector:north')?.map((m) => m.title)).toEqual(['depot']);
    expect([c.placed, c.named]).toEqual([2, 1]);
  });

  it('is placed nowhere when the Zone it names is not in these outlines, and stays with those filed by jurisdiction', () => {
    const c = countsOf(outlines, {}, [], {}, [named('elsewhere', 'zone:not-in-these')]);
    expect([c.placed, c.named, c.in.size]).toEqual([0, 0, 0]);
  });
});

describe('near an edge, at every level it is counted in', () => {
  const sectorDrift = { 'terra:laurentia': json<Topology>('terra-laurentia.json').navcom?.simplified_m as number };

  it('is said at the Zone as well as at its Sector, once the container is open, since the Zone’s badge counts it too', () => {
    const c = countsOf(outlines, { 'terra:laurentia': laurentia }, [at(-90.01, 45, 'edge')], sectorDrift);
    expect(c.in.get('zone:laurentia-west/sector:north')?.map((m) => m.title)).toEqual(['edge']);
    expect(c.near.get('zone:laurentia-west')?.map((n) => [n.mission.title, n.with])).toEqual([['edge', ['Laurentia East Zone']]]);
    expect(c.near.get('zone:laurentia-west/sector:north')?.map((n) => [n.mission.title, n.with])).toEqual([['edge', ['Laurentia east, north']]]);
    // Its Terra's edge is a continent away: not near that.
    expect(c.near.has('terra:laurentia')).toBe(false);
  });

  it('holds a Sector to its own file’s drift, which the vendoring measured apart from the Zones’', () => {
    // Each file says its own: the Sectors are quantised apart, and here drift less than the Zones.
    expect(sectorDrift['terra:laurentia']).toBeGreaterThan(0);
    expect(sectorDrift['terra:laurentia']).toBeLessThan(outlines.navcom.simplified_m!);
    for (const f of readdirSync(FIXTURE).filter((f) => f !== 'outlines.json' && f !== 'index.json')) {
      expect(json<Topology>(f).navcom?.simplified_m, f).toBeGreaterThan(0);
    }
    // North of the line between Laurentia West's two Sectors, which the Sectors' file draws at 30.003°
    // (quantised), with a 100 m point. 30.0135° is about 1.2 km from it: inside the Zones' 1.5 km drift,
    // outside the Sectors' own 0.7 km.
    const between = (lat: number) => countsOf(outlines, { 'terra:laurentia': laurentia }, [at(-120, lat, 'between', 100)], sectorDrift);
    expect(between(30.0135).near.get('zone:laurentia-west/sector:north')).toBeUndefined();
    // About 330 m from it is within the Sectors' own drift too.
    expect(between(30.006).near.get('zone:laurentia-west/sector:north')?.map((n) => n.with)).toEqual([['Laurentia west, south']]);
    // And a file from before the Sectors' drift was measured is held to the Zones'.
    expect(countsOf(outlines, { 'terra:laurentia': laurentia }, [at(-120, 30.0135, 'old file', 100)]).near.has('zone:laurentia-west/sector:north')).toBe(true);
  });
});

describe('what the layers read', () => {
  it('never reads the mission feed or a claim: the map hands the Zones’ counts their missions', () => {
    const dir = join(WEB, 'src/lib/grid/layers');
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/from '\$lib\/missions\/|from '\.\.\/\.\.\/missions\/|claims/);
    }
  });
});
