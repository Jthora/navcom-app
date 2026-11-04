import { describe, expect, it } from 'vitest';
import { fixDue, FIX_MOVED_METRES, FIX_STILL_SECONDS } from './session.svelte';
import { BLIP_STALE_SECONDS } from '$lib/map/blips';
import { NEAR_FRESH_SECONDS } from './floor';

/** A point `metres` north of Herald Square. */
const north = (metres: number) => ({ lat: 40.7497 + metres / 111_320, lon: -73.9877, precision_m: 0 });
const sent = (at: number, metres = 0) => ({ ...north(metres), at });

describe('when a phone tells the watch where it is (the owner’s map decisions, 2026-11-03)', () => {
  it('sends the first fix at once', () => {
    expect(fixDue(north(0), null, 1_000)).toBe(true);
  });

  it('sharing exactly, sends once it has moved past what GPS wanders on its own, and not before', () => {
    expect(fixDue(north(FIX_MOVED_METRES - 5), sent(1_000), 1_015)).toBe(false);
    expect(fixDue(north(FIX_MOVED_METRES + 5), sent(1_000), 1_015)).toBe(true);
  });

  it('standing still, says so once in four minutes and no more', () => {
    expect(fixDue(north(2), sent(1_000), 1_000 + FIX_STILL_SECONDS - 1)).toBe(false);
    expect(fixDue(north(2), sent(1_000), 1_000 + FIX_STILL_SECONDS)).toBe(true);
  });

  it('a still phone is never drawn as not heard, nor left out of the nearest, between its fixes', () => {
    expect(FIX_STILL_SECONDS).toBeLessThan(BLIP_STALE_SECONDS);
    expect(FIX_STILL_SECONDS).toBeLessThan(NEAR_FRESH_SECONDS);
  });

  it('sharing roughly, sends when its 500 m square changes, whatever the distance', () => {
    const rough = { lat: 40.75, lon: -73.99, precision_m: 500 };
    expect(fixDue(rough, { ...rough, at: 1_000 }, 1_060)).toBe(false);
    expect(fixDue({ ...rough, lat: 40.7545 }, { ...rough, at: 1_000 }, 1_060)).toBe(true);
  });
});
