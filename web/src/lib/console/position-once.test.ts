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

  it('picks a genuinely close region across the antimeridian over a merely far one (found in robustness audit)', () => {
    // A raw longitude difference used to make a region a few km away, on the other side of
    // +/-180, compute as roughly the earth's circumference away -- so a candidate that was
    // actually thousands of km off could win by comparison. Latent today (no current region
    // is near the dateline), cheap to close.
    const centroids = [c('across-the-line', 0, 179.95), c('actually-far', 0, 0)];
    expect(nearest({ lat: 0, lon: -179.95 }, centroids)?.region).toBe('across-the-line');
  });
});
