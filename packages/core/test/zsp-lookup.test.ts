/**
 * Which Sector a point is in, answered on the phone [the owner's map decision D7: nothing is sent].
 *
 * In longitude and latitude, never projected: the partition runs pole to pole, and a lookup done in
 * Web Mercator could not place anything past 85°. Against the fixture, which covers the whole Earth
 * with both polar caps and a Sector split across the antimeridian.
 */

import { describe, expect, it } from 'vitest';
import { checkPartition, placeAt, zspIndex } from '../src/zones/index.js';
import { fixturePartition } from './helpers/zsp.js';

const { files } = fixturePartition();
const { ['manifest.json']: manifest, ...rest } = files;
const { partition } = checkPartition({ manifest: manifest!, files: rest, stage: 'final' });
const index = zspIndex(partition!.sectors);

describe('which Sector a point is in', () => {
  it('puts every point of a 2° grid in exactly one Sector', () => {
    for (let lat = -89; lat <= 89; lat += 2) {
      for (let lon = -179; lon <= 179; lon += 2) {
        const { inside } = placeAt(index, lon, lat, 0);
        expect(inside, `${lon},${lat}`).not.toBeNull();
      }
    }
  });

  it('answers at 89.9°, where a lookup in Web Mercator would have answered nothing', () => {
    expect(placeAt(index, 10, 89.9).inside).toBe('zone:arcticum-east/sector:north');
    expect(placeAt(index, -10, -89.9).inside).toBe('zone:antarctica-west/sector:south');
    // The poles themselves, which every ring meets along its edge.
    expect(placeAt(index, 0, 90).inside).toMatch(/^zone:arcticum-/);
    expect(placeAt(index, 0, -90).inside).toMatch(/^zone:antarctica-/);
  });

  it('finds the same Sector either side of the antimeridian, where it is split', () => {
    const east = placeAt(index, 179.99, 10).inside;
    const west = placeAt(index, -179.99, 10).inside;
    expect(east).toBe('zone:pacificum-north/sector:dateline');
    expect(west).toBe(east);
    expect(placeAt(index, 180, 10).inside).toBe(east);
    expect(placeAt(index, -180, 10).inside).toBe(east);
  });

  it('offers both Sectors for a point 500 m from the edge between them, because edges are simplified to about a kilometre', () => {
    // 30°N is the line between Laurentia West's two Sectors; 500 m north of it is 0.0045°.
    const near = placeAt(index, -120, 30.0045);
    expect(near.inside).toBe('zone:laurentia-west/sector:north');
    expect(near.near).toEqual(['zone:laurentia-west/sector:south']);
    // 50 km from it, there is no doubt.
    expect(placeAt(index, -120, 30.45).near).toEqual([]);
  });

  it('says nothing for a place that is not one', () => {
    for (const [lon, lat] of [[NaN, 0], [0, NaN], [0, 91], [0, -91], [181, 0], [-181, 0]]) {
      expect(placeAt(index, lon!, lat!), `${lon},${lat}`).toEqual({ inside: null, near: [] });
    }
  });
});
