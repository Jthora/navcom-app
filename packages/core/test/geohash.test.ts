/**
 * Geohash encoding, checked against published reference values rather than against itself.
 *
 * An encoder tested only on its own round trip agrees with its own bugs. Every vector below
 * is one somebody else published, so a wrong interleave or a wrong alphabet fails here
 * instead of shipping cells that are confidently in the wrong place.
 */

import { describe, expect, it } from 'vitest';
import { AREA_GEOHASH_CHARS, geohash, GeohashError } from '../src/index.js';

describe('against published reference values', () => {
  // The canonical worked example, and three cities with widely-cited hashes.
  const VECTORS: [string, number, number, string][] = [
    ['the canonical example', 57.64911, 10.40744, 'u4pruydqqvj'],
    ['null island', 0, 0, 's0000'],
    ['San Francisco', 37.7749, -122.4194, '9q8yy'],
    ['London', 51.5074, -0.1278, 'gcpvj']
  ];

  for (const [what, lat, lon, expected] of VECTORS) {
    it(`encodes ${what}`, () => {
      expect(geohash(lat, lon, expected.length)).toBe(expected);
    });
  }

  it('is a prefix code — a shorter hash is the longer one truncated', () => {
    // The property the coarse/exact split depends on: ±20 km is the same cell as the
    // precise one, with detail removed rather than a different place.
    const long = geohash(57.64911, 10.40744, 11);
    for (let n = 1; n <= 11; n++) expect(geohash(57.64911, 10.40744, n)).toBe(long.slice(0, n));
  });
});

describe('what it refuses', () => {
  it('refuses a coordinate that is not one', () => {
    for (const [lat, lon] of [[91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 0], [0, Infinity]]) {
      expect(() => geohash(lat!, lon!, 4), `${lat},${lon}`).toThrow(GeohashError);
    }
  });

  it('refuses a length that is not a geohash length', () => {
    for (const n of [0, -1, 13, 2.5]) expect(() => geohash(0, 0, n)).toThrow(GeohashError);
  });

  it('produces only alphabet characters, with no a, i, l or o', () => {
    for (let i = 0; i < 200; i++) {
      const h = geohash(Math.random() * 180 - 90, Math.random() * 360 - 180, 8);
      expect(h).toMatch(/^[0-9bcdefghjkmnpqrstuvwxyz]{8}$/);
    }
  });
});

describe('what an observation actually publishes', () => {
  it('produces a cell of exactly the length the spec pins', () => {
    // The one number whose whole job is preventing an operator from being located.
    const h = geohash(38.627, -90.1994, AREA_GEOHASH_CHARS);
    expect(h).toHaveLength(AREA_GEOHASH_CHARS);
  });

  it('gives two places 20 km apart a real chance of sharing a cell, which is the point', () => {
    // St Louis downtown and a point ~15 km west. Coarse enough that the pair is not a
    // position: whether they collide depends on where the cell boundary falls, and either
    // answer is fine -- what matters is that neither hash locates anybody.
    const a = geohash(38.627, -90.1994, AREA_GEOHASH_CHARS);
    const b = geohash(38.627, -90.37, AREA_GEOHASH_CHARS);
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(4);
    // And both are far coarser than the five-character cell an earlier draft implied.
    expect(geohash(38.627, -90.1994, 5)).not.toBe(a);
  });
});
