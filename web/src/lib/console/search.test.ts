import { describe, expect, it } from 'vitest';
import { search } from './search';
import type { ConsoleIndexEntry } from './types';

const entry = (over: Partial<ConsoleIndexEntry>): ConsoleIndexEntry => ({
  id: 'a', name: 'Example', type: 'shelter', region: 'st-louis', regionName: 'St. Louis',
  ...over
});

const index = [
  entry({ id: '1', name: 'Harbor House', type: 'shelter', region: 'st-louis', regionName: 'St. Louis' }),
  entry({ id: '2', name: 'Riverside Clinic', type: 'medical', region: 'st-louis', regionName: 'St. Louis' }),
  entry({ id: '3', name: 'Meal Site', type: 'meal', region: 'denver', regionName: 'Denver' })
];

describe('the root console\'s own search — no fetch, no watch, works instantly', () => {
  it('matches by name, case-insensitively', () => {
    expect(search(index, 'harbor').map((e) => e.id)).toEqual(['1']);
    expect(search(index, 'HARBOR').map((e) => e.id)).toEqual(['1']);
  });

  it('matches by type', () => {
    expect(search(index, 'medical').map((e) => e.id)).toEqual(['2']);
  });

  it('matches by region name, so "denver" finds what is there without knowing a category', () => {
    expect(search(index, 'denver').map((e) => e.id)).toEqual(['3']);
  });

  it('returns nothing for an empty or blank query, rather than the whole directory', () => {
    expect(search(index, '')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
  });

  it('is honestly empty when nothing matches — no fuzzy guess', () => {
    expect(search(index, 'xyz-nothing-like-this')).toEqual([]);
  });

  it('respects a limit, so one broad word cannot flood the panel', () => {
    const many = Array.from({ length: 50 }, (_, i) => entry({ id: String(i), name: `Shelter ${i}` }));
    expect(search(many, 'shelter', 10)).toHaveLength(10);
  });
});
