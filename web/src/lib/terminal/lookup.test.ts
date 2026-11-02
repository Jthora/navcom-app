import { describe, expect, it } from 'vitest';
import type { ResourceRecord } from '@navcom/core';
import { distance, narrow, placeLine, provenanceOf } from './lookup';

const rec = (over: Partial<ResourceRecord>): ResourceRecord => ({
  id: 'x', name: 'Somewhere', type: 'shelter', flag: 'ok', ...over
});

const records = [
  rec({ id: 'a', name: 'Bowery Mission', type: 'shelter', address: '227 Bowery, New York', lat: 40.7223, lon: -73.9928, phone: '212-674-3456', last_verified: '2026-09-14', method: 'website' }),
  rec({ id: 'b', name: 'Holy Apostles Soup Kitchen', type: 'meal', address: '296 9th Ave, New York', lat: 40.7489, lon: -74.0006, hours: 'Mon-Fri 10:30-12:30' }),
  rec({ id: 'c', name: 'Olivieri Center', type: 'daytime', address: '257 W 30th St, New York', lat: 40.7499, lon: -73.9946, intake_hours: '24 hours' }),
  rec({ id: 'd', name: 'Refuge', type: 'dv', phone: '800-000-0000' })
];

describe('narrowing a region’s places to answer somebody', () => {
  it('matches every word typed against the name, the kind of place and the address', () => {
    expect(narrow(records, 'soup', null).map((f) => f.record.id)).toEqual(['b']);
    expect(narrow(records, 'drop-in', null).map((f) => f.record.id)).toEqual(['c']);
    expect(narrow(records, 'bowery shelter', null).map((f) => f.record.id)).toEqual(['a']);
  });

  it('puts the nearest first when the ask carried where they are', () => {
    const penn = { lat: 40.7506, lon: -73.9935 };
    const found = narrow(records, '', penn);
    expect(found[0]!.record.id).toBe('c');
    expect(found[0]!.metres).toBeLessThan(200);
    // A record with no position goes last rather than being dropped.
    expect(found.at(-1)!.record.id).toBe('d');
  });

  it('keeps to a handful', () => {
    expect(narrow(Array.from({ length: 20 }, (_, i) => rec({ id: String(i) })), '', null)).toHaveLength(6);
  });
});

describe('what goes into the answer', () => {
  it('is the name, address and phone, and the intake hours over the opening hours', () => {
    expect(placeLine(records[0]!)).toBe('Bowery Mission, 227 Bowery, New York, 212-674-3456');
    expect(placeLine(records[1]!)).toBe('Holy Apostles Soup Kitchen, 296 9th Ave, New York, Mon-Fri 10:30-12:30');
    expect(placeLine(records[2]!)).toBe('Olivieri Center, 257 W 30th St, New York, intake 24 hours');
  });

  it('gives no address for a refuge whose location is withheld, because it has none to give', () => {
    expect(placeLine(records[3]!)).toBe('Refuge, 800-000-0000');
  });

  it('carries the record’s provenance verbatim', () => {
    expect(provenanceOf(records[0]!)).toEqual({ record_id: 'a', verified: '2026-09-14', method: 'website' });
    expect(provenanceOf(records[1]!)).toEqual({ record_id: 'b', verified: null, method: null });
  });

  it('says a distance the way a person does', () => {
    expect(distance(140)).toBe('150 m');
    expect(distance(1234)).toBe('1.2 km');
  });
});
