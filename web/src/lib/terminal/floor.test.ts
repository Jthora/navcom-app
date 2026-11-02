import { describe, expect, it } from 'vitest';
import type { BoardEntry } from '@navcom/core';
import { askShown, floorDetail, floorNote, floorPin, repeatedNames, shownFor, teamsOn } from './floor';
import { coordinates, mapLink, within } from './fix';

const NOW = 1_800_000_000;
const entry = (over: Partial<BoardEntry> = {}): BoardEntry => ({
  operator: 'pk', callsign: 'Raven', area: 'Midtown',
  signed_on: NOW - 1800, expected_until: NOW + 5400, routine_interval: 3600, routine_due: NOW + 1800,
  last_contact: NOW - 720, position: null, position_at: null, status: 'active', ...over
});

describe('a row on the watch’s board', () => {
  it('says when the next check-in is due, when that comes before they are back', () => {
    expect(floorNote(entry(), NOW)).toBe('check-in in 30 min');
  });

  it('says when they are due back, when that comes first or they gave no check-ins', () => {
    expect(floorNote(entry({ routine_interval: null, routine_due: null }), NOW)).toBe('back in 90 min');
    expect(floorNote(entry({ expected_until: NOW + 600 }), NOW)).toBe('back in 10 min');
  });

  it('says how long ago a time passed, as a fact rather than a verdict', () => {
    expect(floorNote(entry({ routine_due: NOW - 1200 }), NOW)).toBe('check-in due 20 min ago');
    expect(floorNote(entry({ expected_until: NOW - 1200, routine_due: NOW - 3000 }), NOW)).toBe('due back 20 min ago');
    expect(floorNote(entry({ routine_due: NOW - 1200 }), NOW)).not.toMatch(/overdue|missing|late/);
  });

  it('says Distress, and nothing about timers, for somebody who raised one', () => {
    expect(floorNote(entry({ status: 'distress', expected_until: NOW - 9999 }), NOW)).toBe('Distress');
  });

  it('says when the board last heard from them', () => {
    expect(floorDetail(entry(), NOW)).toBe('heard 12 min ago');
  });

  it('shows no pin for somebody who does not share where they are', () => {
    expect(floorPin(entry(), NOW)).toBeNull();
  });

  it('pins a shared fix with how precise and how old it is', () => {
    const pin = floorPin(entry({ position: { lat: 40.7505, lon: -73.9934, precision_m: 500 }, position_at: NOW - 180 }), NOW);
    expect(pin?.label).toBe('Map · within 500 m · 3 min ago');
    expect(pin?.href).toBe('https://www.openstreetmap.org/?mlat=40.7505&mlon=-73.9934#map=17/40.7505/-73.9934');
  });
});

describe('a fix, read out', () => {
  it('gives an exact fix to six places and a rounded one to four', () => {
    expect(coordinates({ lat: 40.750512, lon: -73.993421, precision_m: 0 })).toBe('40.750512, -73.993421');
    expect(coordinates({ lat: 40.750512, lon: -73.993421, precision_m: 500 })).toBe('40.7505, -73.9934');
  });

  it('says exact or within so many metres', () => {
    expect(within({ lat: 0, lon: 0, precision_m: 0 })).toBe('exact');
    expect(within({ lat: 0, lon: 0, precision_m: 500 })).toBe('within 500 m');
  });

  it('hands off to a street map', () => {
    expect(mapLink({ lat: 1, lon: 2, precision_m: 0 })).toContain('openstreetmap.org/?mlat=1&mlon=2');
  });
});

describe('a board several teams share', () => {
  const zg = entry({ operator: 'a', callsign: 'Owl', team: 'Zone Guardians' });
  const rr = entry({ operator: 'b', callsign: 'owl ', team: 'Rescue Rangers' });
  const rr2 = entry({ operator: 'c', callsign: 'Kite', team: 'rescue rangers' });
  const none = entry({ operator: 'd', callsign: 'Wren' });

  it('names each team once, however it was typed, in an order that does not move', () => {
    expect(teamsOn([zg, rr2, none, rr])).toEqual(['Rescue Rangers', 'Zone Guardians']);
    const third = entry({ operator: 'g', callsign: 'Jay', team: 'rescue rangers' });
    expect(teamsOn([rr2, third, rr])).toEqual(['rescue rangers']);
    expect(teamsOn([none])).toEqual([]);
  });

  it('narrowed to one team, shows that team, and never hides a Distress or anybody past their time', () => {
    const hurt = entry({ operator: 'e', callsign: 'Dove', team: 'Zone Guardians', status: 'distress' });
    const late = entry({ operator: 'f', callsign: 'Cedar', status: 'overdue' });
    const shown = [zg, rr, rr2, none, hurt, late].filter((e) => shownFor(e, ['Rescue Rangers'])).map((e) => e.operator);
    expect(shown).toEqual(['b', 'c', 'e', 'f']);
    expect([zg, none].every((e) => shownFor(e, []))).toBe(true);
    expect([zg, rr, none].filter((e) => shownFor(e, ['zone guardians', 'Rescue Rangers'])).map((e) => e.operator)).toEqual(['a', 'b']);
  });

  it('narrowed, keeps the questions of the teams chosen, and of anybody whose team it cannot say', () => {
    expect(askShown('Rescue Rangers', ['rescue rangers'])).toBe(true);
    expect(askShown('Zone Guardians', ['Rescue Rangers'])).toBe(false);
    expect(askShown(null, ['Rescue Rangers'])).toBe(true);
    expect(askShown('Zone Guardians', [])).toBe(true);
  });

  it('tells two operators with one name apart, and leaves a name nobody shares alone', () => {
    expect([...repeatedNames([zg, rr, rr2, none])]).toEqual(['owl']);
  });
});
