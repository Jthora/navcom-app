import { describe, expect, it } from 'vitest';
import { regionFigures } from './figures';
import type { Region, ResourceRecord } from '@navcom/core';

const region = (slug: string, name: string): Region => ({
  slug, name, country: 'US', timezone: 'America/Chicago', languages: ['en'], status: 'seeded'
});

const record = (over: Partial<ResourceRecord>): ResourceRecord => ({
  id: over.id ?? 'r', name: 'Place', type: 'shelter', flag: 'ok', region: 'a', ...over
});

describe('per-region figures — directory facts only, never a watch/coverage claim', () => {
  const regions = [region('a', 'Alpha'), region('b', 'Beta')];

  it('counts records per region, not globally', () => {
    const records = [
      record({ id: '1', region: 'a' }),
      record({ id: '2', region: 'a' }),
      record({ id: '3', region: 'b' })
    ];
    const figures = regionFigures(records, regions);
    expect(figures.a.records).toBe(2);
    expect(figures.b.records).toBe(1);
  });

  it('matches BROADCAST.measure: verified_by + a real method, and not seeded', () => {
    const records = [
      // Confirmed: has a verifier, phone method, not seeded.
      record({ id: '1', region: 'a', verified_by: 'Wren', method: 'phone' }),
      // Seeded (website method) — never counts, even with a verified_by set.
      record({ id: '2', region: 'a', verified_by: 'Wren', method: 'website' }),
      // No verifier at all — never counts.
      record({ id: '3', region: 'a', method: 'phone' })
    ];
    expect(regionFigures(records, regions).a.confirmedByPerson).toBe(1);
  });

  it('tracks the freshest date per region independently', () => {
    const records = [
      record({ id: '1', region: 'a', last_verified: '2026-01-01' }),
      record({ id: '2', region: 'a', last_verified: '2026-06-01' }),
      record({ id: '3', region: 'b', last_verified: '2026-03-01' })
    ];
    const figures = regionFigures(records, regions);
    expect(figures.a.freshest).toBe('2026-06-01');
    expect(figures.b.freshest).toBe('2026-03-01');
  });

  it('reports no freshest date for a region where nothing has ever been checked', () => {
    const records = [record({ id: '1', region: 'a' })];
    expect(regionFigures(records, regions).a.freshest).toBeNull();
  });

  it('skips records with no region rather than crashing', () => {
    const records = [record({ id: '1', region: undefined })];
    expect(() => regionFigures(records, regions)).not.toThrow();
    expect(Object.keys(regionFigures(records, regions))).toHaveLength(0);
  });

  it('carries no field that could read as a watch or coverage claim', () => {
    // A structural guard against exactly the anti-pattern the doc comment warns about:
    // this type must never grow a "watch"/"coverage"/"active" field.
    const figures = regionFigures([record({ region: 'a' })], regions);
    const keys = Object.keys(figures.a);
    for (const banned of ['watch', 'coverage', 'active', 'covered']) {
      expect(keys.some((k) => k.toLowerCase().includes(banned))).toBe(false);
    }
  });
});
