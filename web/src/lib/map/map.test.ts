import { describe, expect, it } from 'vitest';
import type { BoardEntry } from '@navcom/core';
import { freshness, operatorBlips, watchBlips, BLIP_STALE_SECONDS } from './blips';
import { bearing, compassPoint, middle, offset, ringsFor } from './geometry';
import { directionsTo } from './directions';
import { headingOf } from './compass.svelte';

const NOW = 1_800_000_000;
const penn = { lat: 40.7506, lon: -73.9935 };
const herald = { lat: 40.7497, lon: -73.9877 };
const entry = (over: Partial<BoardEntry>): BoardEntry => ({
  operator: 'pk', callsign: 'Raven', area: 'Midtown', signed_on: NOW - 600, expected_until: NOW + 3600,
  routine_interval: null, routine_due: null, last_contact: NOW - 60, position: null, position_at: null, status: 'active', ...over
});

describe('the watch’s blips', () => {
  it('are everybody on the board who shares where they are, with their state and what they are asking', () => {
    const blips = watchBlips(
      [
        entry({ operator: 'a', callsign: 'Kite', team: 'Rescue Rangers', position: { ...herald, precision_m: 0 }, position_at: NOW - 20 }),
        entry({ operator: 'b', callsign: 'Raven', status: 'distress', position: { ...penn, precision_m: 500 }, position_at: NOW - 5 }),
        entry({ operator: 'c', callsign: 'Quiet' })
      ],
      [{ operator: 'b', callsign: 'Raven', type: 'distress', position: null }, { operator: 'a', callsign: 'Kite', type: 'assist', position: null }]
    );
    expect(blips.map((b) => [b.label, b.team, b.state, b.asking, b.precision_m])).toEqual([
      ['Kite', 'Rescue Rangers', 'out', 'assist', 0],
      ['Raven', null, 'distress', 'distress', 500]
    ]);
  });

  it('include somebody asking from a fix whose sign-on this board has not heard', () => {
    const blips = watchBlips([], [{ operator: 'z', callsign: 'Owl', type: 'distress', position: { ...penn, precision_m: 0 } }]);
    expect(blips.map((b) => [b.label, b.state])).toEqual([['Owl', 'distress']]);
  });
});

describe('an operator’s blips', () => {
  it('are themselves, the peers who share, and where they are going, and nobody else', () => {
    const blips = operatorBlips(
      { ...penn, precision_m: 0 },
      NOW,
      [
        { pubkey: 'p', callsign: 'Kite', heard: NOW - 30, payload: { position: { ...herald, precision_m: 500 } } },
        { pubkey: 'q', callsign: 'Quiet', heard: NOW - 30, payload: {} }
      ],
      () => 'out',
      { id: 'new-york-daytime-1', name: 'Drop-in, W 30th St', lat: 40.749, lon: -73.995 }
    );
    expect(blips.map((b) => [b.kind, b.label])).toEqual([['self', 'You'], ['operator', 'Kite'], ['place', 'Drop-in, W 30th St']]);
  });

  it('fade, and go hollow when nothing has been heard for three minutes', () => {
    const [b] = operatorBlips(null, NOW, [{ pubkey: 'p', callsign: 'Kite', heard: NOW - 10, payload: { position: { ...herald, precision_m: 0 } } }], () => 'out', null);
    expect(freshness(b!, NOW)).toBe('fresh');
    expect(freshness(b!, NOW + 90)).toBe('aging');
    expect(freshness(b!, NOW + BLIP_STALE_SECONDS)).toBe('stale');
  });
});

describe('where one point is from another', () => {
  it('measures east and north, and the bearing, at street scale', () => {
    const o = offset(penn, herald);
    expect(o.east).toBeGreaterThan(450);
    expect(o.east).toBeLessThan(510);
    expect(o.north).toBeLessThan(-80);
    expect(compassPoint(bearing(penn, herald))).toBe('E');
    expect(compassPoint(bearing(herald, penn))).toBe('W');
    expect(compassPoint(359)).toBe('N');
  });

  it('chooses three rings a person can read, the last clear of the farthest blip', () => {
    expect(ringsFor(420)).toEqual([100, 250, 500]);
    expect(ringsFor(480)).toEqual([250, 500, 1_000]);
    expect(ringsFor(600)).toEqual([250, 500, 1_000]);
    expect(ringsFor(0)).toEqual([50]);
    expect(ringsFor(1e9)).toEqual([5_000, 10_000, 25_000]);
  });

  it('finds the middle of a laptop’s blips, and none of nothing', () => {
    expect(middle([penn, herald])!.lat).toBeCloseTo((penn.lat + herald.lat) / 2, 6);
    expect(middle([])).toBeNull();
  });
});

describe('directions, handed to the phone’s own map', () => {
  it('names a place and never a person, walking', () => {
    const place = directionsTo({ lat: 40.749, lon: -73.995 }, 'Drop-in, W 30th St');
    expect(place[0]!.href).toBe('geo:40.749000,-73.995000?q=40.749000,-73.995000(Drop-in%2C%20W%2030th%20St)');
    expect(place.map((h) => h.label)).toEqual(['Your map app', 'Apple Maps', 'Google Maps', 'OpenStreetMap']);
    expect(place.find((h) => h.label === 'Google Maps')!.href).toContain('travelmode=walking');
    const person = directionsTo({ lat: 40.7497, lon: -73.9877 });
    expect(person.map((h) => h.href).join(' ')).not.toMatch(/\(/);
  });
});

describe('which way the phone faces', () => {
  it('reads iOS’s compass heading, and an absolute alpha the other way round, and nothing else', () => {
    expect(headingOf({ webkitCompassHeading: 90 })).toBe(90);
    expect(headingOf({ absolute: true, alpha: 90 })).toBe(270);
    expect(headingOf({ absolute: false, alpha: 90 })).toBeNull();
    expect(headingOf({})).toBeNull();
  });
});
