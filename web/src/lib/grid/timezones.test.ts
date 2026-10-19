/**
 * The time zones layer [the owner's map decision D8; docs/design/map.md, Layers].
 *
 * Natural Earth's 1:10m zones, as committed: standard offsets only, drawn in 2012, so the layer says
 * so. Exact local time is a different thing, and comes from each directory region's own IANA zone
 * through the phone's `Intl`, which knows daylight saving and the bands do not. Both read from what
 * ships: the committed file, and the prerendered region file in `build/`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAP_LINES } from '../../../scripts/lib/budget.mjs';
import { clockAt, labelOf, localTime } from './clock';
import { decode, inside, project, type Topology } from './topology';
import { bandsOf, type RegionTimes } from './layers/timezones';

const FILE = fileURLToPath(new URL('../../../static/grid/timezones.json', import.meta.url));
const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));
const raw = () => readFileSync(FILE);
const topology = () => JSON.parse(raw().toString('utf8')) as Topology;

function built(path: string): string {
  const file = join(BUILD, path);
  if (!existsSync(file)) throw new Error(`${path} was not built`);
  return readFileSync(file, 'utf8');
}

describe('the bands, as committed', () => {
  it('is Natural Earth’s 1:10m layer at the pinned commit, and says it is standard time as drawn in 2012', () => {
    expect(topology().navcom).toMatchObject({
      source: 'natural-earth@ca96624a56bd078437bca8184e78163e5039ad19',
      layer: 'ne_10m_time_zones',
      drawn: '2012',
      standard: expect.stringMatching(/no daylight saving/)
    });
  });

  it('has one band per standard offset, every offset between UTC−12 and UTC+14', () => {
    const bands = bandsOf(topology());
    const offsets = bands.map((b) => b.offset);
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets.length).toBe(40);
    for (const o of offsets) {
      expect(o).toBeGreaterThanOrEqual(-12);
      expect(o).toBeLessThanOrEqual(14);
    }
  });

  it('puts real places in their own standard offsets, the quarter-hours included', () => {
    const bands = bandsOf(topology());
    const at = (lon: number, lat: number) => bands.filter((b) => inside(b.shape.rings, project(lon, lat))).map((b) => b.offset);
    for (const [name, lon, lat, offset] of [
      ['Nairobi', 36.82, -1.29, 3],
      ['Kathmandu', 85.32, 27.71, 5.75],
      ['Delhi', 77.21, 28.61, 5.5],
      ['London', -0.13, 51.51, 0],
      ['New York', -74.0, 40.71, -5],
      ['Adelaide', 138.6, -34.93, 9.5],
      ['Kiritimati', -157.4, 1.87, 14],
      ['the Chatham Islands', -176.56, -43.95, 12.75]
    ] as const) {
      expect(at(lon, lat), name).toEqual([offset]);
    }
  });

  it('stays inside the ceiling its line was given, paid only by somebody who chooses Time zones', () => {
    // As the budget measures it: zlib's default level [scripts/lib/budget.mjs].
    expect(gzipSync(raw()).length).toBeLessThanOrEqual(MAP_LINES.timezones.data!.limit);
  });

  it('gives every band its offset as a number, so none is drawn and left unlabelled', () => {
    const shapes = decode(topology())['bands']!.shapes;
    expect(shapes.every((s) => typeof s.props.zone === 'number')).toBe(true);
    expect(bandsOf(topology())).toHaveLength(shapes.length);
  });
});

describe('what a band says, from the phone’s clock', () => {
  const SUMMER = Date.UTC(2026, 6, 1, 11, 5);
  const WINTER = Date.UTC(2026, 0, 15, 11, 5);

  it('names an offset the way a person reads one', () => {
    expect(labelOf(3)).toBe('UTC+3');
    expect(labelOf(5.75)).toBe('UTC+5:45');
    expect(labelOf(-9.5)).toBe('UTC−9:30');
    expect(labelOf(0)).toBe('UTC±0');
    expect(labelOf(-12)).toBe('UTC−12');
  });

  it('gives standard time at an offset, which the bands know, and not daylight saving, which they do not', () => {
    expect(clockAt(3, SUMMER)).toBe('14:05');
    expect(clockAt(5.75, SUMMER)).toBe('16:50');
    expect(clockAt(-9.5, SUMMER)).toBe('01:35');
    expect(clockAt(14, WINTER)).toBe('01:05');
    // London's band is UTC±0 all year; its clocks are not, in July.
    expect(clockAt(0, SUMMER)).toBe('11:05');
  });

  it('gives a place’s own local time from its IANA zone, daylight saving and all', () => {
    expect(localTime('Europe/London', SUMMER)).toEqual({ time: '12:05', abbr: 'BST' });
    expect(localTime('Europe/London', WINTER)).toEqual({ time: '11:05', abbr: 'GMT' });
    expect(localTime('America/New_York', SUMMER)).toMatchObject({ time: '07:05' });
    expect(localTime('Not/AZone', SUMMER)).toBeNull();
  });
});

describe('each region’s own time zone, as built', () => {
  it('names a valid IANA zone for every region the map draws a ring for, and nothing else', () => {
    const file = JSON.parse(built('grid/region-times.json')) as RegionTimes;
    const { centroids } = JSON.parse(built('console-regions.json')) as { centroids: { region: string }[] };
    expect(file.v).toBe(1);
    const missing = centroids.filter((c) => typeof file.regions[c.region] !== 'number').map((c) => c.region);
    expect(missing).toEqual([]);
    for (const zone of file.zones) expect(localTime(zone, Date.now()), zone).not.toBeNull();
    expect(file.zones[file.regions['birmingham-uk']!]).toBe('Europe/London');
    // Keyed by region and nothing else: no record, no coordinate.
    expect(Object.keys(file).sort()).toEqual(['regions', 'v', 'zones']);
  });
});
