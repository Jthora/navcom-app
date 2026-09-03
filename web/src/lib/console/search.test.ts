import { describe, expect, it } from 'vitest';
import { search, type SearchScope } from './search';
import type { ConsoleRegionFigures } from './types';

/**
 * What the front page can find, and what it says it can find.
 *
 * The console used to embed every record. At 1,405 records that was 27.9 kB gzipped on a page
 * with a 120 kB budget, and trimming was measured three ways for a ceiling near 4,600 — short
 * of national coverage by half. So the index became **every region, always** plus **one
 * region's records**, and the interesting behaviour is the seam between them.
 */

const region = (slug: string, name: string, records = 10): ConsoleRegionFigures => ({
  region: slug, name, records, confirmedByPerson: 0, freshest: null, languages: ['en']
});

const REGIONS = [region('seattle', 'Seattle metro', 84), region('tulsa', 'Tulsa, OK', 42),
                 region('missoula', 'Missoula, MT', 0)];

const scope = (loaded?: SearchScope['loaded']): SearchScope => ({ regions: REGIONS, loaded });

const SEATTLE = {
  region: 'seattle',
  name: 'Seattle metro',
  entries: [
    { id: 'seattle-overture-1', name: 'Union Gospel Mission', type: 'shelter' },
    { id: 'seattle-overture-2', name: 'Ballard Food Bank', type: 'meal' }
  ]
};

describe('the console search', () => {
  it('finds a region by name with nothing loaded', () => {
    // The always-available half. Somebody who has denied location, or is looking at a city
    // they are not in, still gets an answer.
    const hits = search(scope(), 'tulsa');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'region', region: 'tulsa' });
  });

  it('finds nothing by shelter name until a region is loaded', () => {
    /*
     * The honest cost of the design, asserted rather than left to be discovered. The `Why`
     * panel on the page says exactly this, and if the behaviour changes the copy is wrong.
     */
    expect(search(scope(), 'union gospel')).toEqual([]);
    const hits = search(scope(SEATTLE), 'union gospel');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'record', id: 'seattle-overture-1' });
  });

  it('puts records above regions, because a name is more specific than a city', () => {
    const loaded = { ...SEATTLE, entries: [{ id: 'x', name: 'Seattle Indian Center', type: 'shelter' }] };
    const hits = search(scope(loaded), 'seattle');
    expect(hits[0]!.kind).toBe('record');
    expect(hits.some((h) => h.kind === 'region' && h.region === 'seattle')).toBe(true);
  });

  it('carries the region a record was found in, so a hit can be read without context', () => {
    const [hit] = search(scope(SEATTLE), 'ballard');
    expect(hit).toMatchObject({ kind: 'record', region: 'seattle', regionName: 'Seattle metro' });
  });

  it('offers a region that carries nothing yet, rather than hiding it', () => {
    // An empty region is the only place a person with local knowledge can add one, and
    // hiding it means the one person who could fill it cannot find it.
    const hits = search(scope(), 'missoula');
    expect(hits[0]).toMatchObject({ kind: 'region', records: 0 });
  });

  it('matches case-insensitively, on type as well as name', () => {
    expect(search(scope(SEATTLE), 'UNION GOSPEL')).toHaveLength(1);
    expect(search(scope(SEATTLE), 'shelter')[0]).toMatchObject({ kind: 'record' });
  });

  it('returns nothing for an empty query, and honours the limit', () => {
    expect(search(scope(SEATTLE), '   ')).toEqual([]);
    expect(search(scope(SEATTLE), 'a', 1)).toHaveLength(1);
  });
});
