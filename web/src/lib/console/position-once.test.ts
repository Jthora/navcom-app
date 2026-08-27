import { describe, expect, it } from 'vitest';
import { nearest } from './position-once';
import type { ConsoleCentroid } from './types';

const c = (region: string, lat: number, lon: number): ConsoleCentroid => ({
  region, name: region, lat, lon
});

describe('nearest region — never sent anywhere, computed once on this device', () => {
  it('picks the closer of two candidates', () => {
    const centroids = [c('far', 40, -100), c('near', 38.6, -90.2)];
    // St. Louis-ish fix
    expect(nearest({ lat: 38.63, lon: -90.2 }, centroids)?.region).toBe('near');
  });

  it('returns null when there are no candidates at all', () => {
    expect(nearest({ lat: 0, lon: 0 }, [])).toBeNull();
  });

  it('returns the only candidate when there is exactly one', () => {
    const centroids = [c('only', 10, 10)];
    expect(nearest({ lat: 50, lon: 50 }, centroids)?.region).toBe('only');
  });
});
