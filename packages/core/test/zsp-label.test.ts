/**
 * Where a Terra, Mare, Zone or Sector is labelled: a point inside it, as far from its edges as a
 * simple search finds, for the map to hang a count on [web: grid/layers/zone-missions.ts]. A centre of
 * the box or a mean of the vertices can fall outside a shape that is not convex, and the partition's
 * shapes are coastlines and ridges.
 */

import { describe, expect, it } from 'vitest';
import { edgeMetres, holds, labelPoint } from '../src/zones/index.js';

const ring = (...points: [number, number][]) => Float64Array.from([...points, points[0]!].flat());

describe('a label point', () => {
  it('is inside a C, in one of its arms, not in the hollow its box centres on', () => {
    // A C open to the east: its box's centre (5, 5) is in the hollow.
    const c = [ring([0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10])];
    const [lon, lat] = labelPoint(c);
    expect(holds(c, lon, lat)).toBe(true);
    expect(holds(c, 5, 5)).toBe(false);
    // And not hard against an edge: at least half the arm's width in.
    expect(edgeMetres(c, lon, lat)).toBeGreaterThan(0.5 * 111_000 * 0.9);
  });

  it('is inside a cap that runs to the pole along it, away from the pole line', () => {
    // A polar cap as ZSP draws one: round the parallel, then along the pole.
    const cap = [ring([-180, 60], [180, 60], [180, 90], [-180, 90])];
    const [lon, lat] = labelPoint(cap);
    expect(holds(cap, lon, lat)).toBe(true);
    expect(lat).toBeGreaterThan(65);
    expect(lat).toBeLessThan(85);
    // The south pole too, wound the other way.
    const south = [ring([-180, -90], [180, -90], [180, -70], [-180, -70])];
    const [, s] = labelPoint(south);
    expect(holds(south, ...labelPoint(south))).toBe(true);
    expect(s).toBeLessThan(-72);
  });

  it('takes the larger piece of a shape split at the antimeridian, and keeps out of a hole', () => {
    const split = [ring([170, -10], [180, -10], [180, 10], [170, 10]), ring([-180, -10], [-150, -10], [-150, 10], [-180, 10])];
    const [lon] = labelPoint(split);
    expect(lon).toBeLessThan(-150);
    expect(lon).toBeGreaterThan(-180);
    const holed = [ring([0, 0], [10, 0], [10, 10], [0, 10]), ring([3, 3], [7, 3], [7, 7], [3, 7])];
    const p = labelPoint(holed);
    expect(holds(holed, ...p)).toBe(true);
  });

  it('is given to two places, as a map key is', () => {
    const [lon, lat] = labelPoint([ring([0.123, 0.456], [3.789, 0.456], [3.789, 2.987], [0.123, 2.987])]);
    expect(lon).toBe(Math.round(lon * 100) / 100);
    expect(lat).toBe(Math.round(lat * 100) / 100);
  });
});
