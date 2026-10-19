/**
 * The directory by when it was last checked [docs/design/map.md, The directory by last check;
 * invariant 7]: the file the map reads, built from every region's records, and how a region reads.
 *
 * A region reads as its oldest check, the cautious statement, and unknown only when none of its
 * records carries a date. Read against the phone's own clock, so the same file reads differently in
 * December than in October, and says so on the map without a deploy. What it names is how long ago, and
 * never what a page shows: the file knows nothing of a record's fields.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAP_LINES } from '../../../scripts/lib/budget.mjs';
import { KEY_NOTE, ageIn, agesFileOf, agesOf, key, readingsOf, thin, type RegionAgesFile } from './layers/ages';
import type { PlacesFile } from './places';

const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));
function built(path: string): string {
  const file = join(BUILD, path);
  if (!existsSync(file)) throw new Error(`${path} was not built`);
  return readFileSync(file, 'utf8');
}

const rec = (last_verified?: string, method = 'website', verified_by = 'a website') => ({ last_verified, method, verified_by }) as never;

describe('the file, from each region’s records', () => {
  it('keeps each region’s records as runs of one date, in the order its region lists them, and −1 where a record has none', () => {
    const file = agesFileOf([
      { region: 'a', records: [rec('2026-09-03'), rec('2026-09-03'), rec(undefined), rec('2026-09-14'), rec('2026-09-03')] },
      { region: 'b', records: [rec('2026-08-02'), rec('not a date')] },
      { region: 'empty', records: [] }
    ]);
    expect(file.v).toBe(2);
    expect(file.dates).toEqual(['2026-08-02', '2026-09-03', '2026-09-14']);
    expect(file.regions).toEqual({ a: [[1, 2], [-1, 1], [2, 1], [1, 1]], b: [[0, 1], [-1, 1]], empty: [] });
    expect(file.records).toBe(7);
    expect(file.confirmed).toBe(0);
    // Confirmed as the place screen counts it: by somebody, by a method that is not a website's.
    expect(agesFileOf([{ region: 'c', records: [rec('2026-09-03', 'in_person', 'Wren'), rec('2026-09-03', 'phone', 'Wren')] }]).confirmed).toBe(2);
    // Laid out again on the phone, one index a record, in the same order.
    const ages = agesOf(file);
    expect([...ages.regions.get('a')!]).toEqual([1, 1, -1, 2, 1]);
    expect(ages.span.get('a')).toEqual([1, 2]);
    expect(ages.span.get('empty')).toEqual([-1, -1]);
  });

  it('refuses a file it did not write rather than read it wrong', () => {
    expect(() => agesOf({ v: 1 } as never)).toThrow(/version/);
    expect(() => agesOf({ v: 2, dates: ['2026-09-03'], regions: { a: [[3, 1]] }, records: 1, confirmed: 0 })).toThrow(/a: not a run/);
    expect(() => agesOf({ v: 2, dates: ['2026-09-03'], regions: { a: [[0, 0]] }, records: 0, confirmed: 0 })).toThrow(/a: not a run/);
  });
});

describe('how a region reads, against the phone’s clock', () => {
  const ages = agesOf({
    v: 2,
    dates: ['2026-08-02', '2026-09-03', '2026-10-10'],
    regions: { mixed: [[2, 1], [1, 1], [-1, 1]], fresh: [[2, 1]], none: [[-1, 2]], empty: [] },
    records: 6,
    confirmed: 0
  });
  const OCT = new Date('2026-10-19T12:00:00Z');
  const DEC = new Date('2026-12-15T12:00:00Z');

  it('reads as its oldest check, and gives its newest beside it', () => {
    expect(ageIn(ages, 'mixed', undefined, OCT)).toEqual({ oldest: '2026-09-03', newest: '2026-10-10', reading: 'hours', record: null });
    expect(ageIn(ages, 'fresh', undefined, OCT)?.reading).toBe('current');
    // Ten weeks on, the same file: every check is past three months but the newest, which is past two weeks.
    expect(ageIn(ages, 'mixed', undefined, DEC)?.reading).toBe('stale');
    expect(ageIn(ages, 'fresh', undefined, DEC)?.reading).toBe('hours');
  });

  it('is unknown only when nothing there carries a date, and a record reads as its own check', () => {
    expect(ageIn(ages, 'none', undefined, OCT)).toEqual({ oldest: null, newest: null, reading: 'unknown', record: null });
    expect(ageIn(ages, 'empty', undefined, OCT)?.reading).toBe('unknown');
    expect(ageIn(ages, 'mixed', 0, OCT)).toMatchObject({ reading: 'current', record: '2026-10-10' });
    expect(ageIn(ages, 'mixed', 2, OCT)).toMatchObject({ reading: 'unknown', record: null });
    expect(ageIn(ages, 'elsewhere', undefined, OCT)).toBeNull();
  });

  it('works out every region’s and every record’s reading once a day, so a frame only looks them up', () => {
    const today = readingsOf(ages, OCT);
    expect(Object.fromEntries(today.regions)).toEqual({ mixed: 'hours', fresh: 'current', none: 'unknown' });
    // A record's, by its place in the order current, hours, stale, unknown.
    expect([...today.records.get('mixed')!]).toEqual([0, 1, 3]);
    expect([...today.records.get('none')!]).toEqual([3, 3]);
    // A region with no places is on no mark, and counted under none.
    expect(today.counts).toEqual({ current: 1, hours: 1, stale: 0, unknown: 1 });
    // Each record agrees with what the place screen is told for it.
    for (const [slug, list] of today.records) {
      list.forEach((r, i) => expect(['current', 'hours', 'stale', 'unknown'][r], `${slug} ${i}`).toBe(ageIn(ages, slug, i, OCT)!.reading));
    }
  });
});

describe('what the key says', () => {
  it('names how long ago, and never a field a record may not have', () => {
    const rows = key();
    expect(rows.map((r) => r.text)).toEqual(['0–13 days ago', '14–89 days ago', '90+ days ago', 'Unknown · no check date']);
    // The dates know nothing of a record's fields: most records carry no hours, and their pages say "Unknown".
    for (const r of rows) expect(r.text, r.reading).not.toMatch(/hours|call first|intake|never/i);
    // What the windows mean is said once, for a place that has hours, and the page is named as the one that says.
    expect(KEY_NOTE).toMatch(/Hours, where a place has them, read call first after 14 days/);
    expect(KEY_NOTE).toMatch(/own page says/);
  });
});

describe('where marks would crowd', () => {
  const m = (x: number, y: number, rank: number, id: string) => ({ x, y, rank, id });

  it('keeps the most cautious, and leaves out what would be drawn under it', () => {
    // A fresh region and an old one 4 px apart: the old one is drawn, alone.
    expect(thin([m(10, 10, 0, 'fresh'), m(14, 10, 2, 'old')], 11).map((k) => k.id)).toEqual(['old']);
    // No date at all is the most cautious word of the four.
    expect(thin([m(10, 10, 2, 'old'), m(12, 12, 3, 'none')], 11).map((k) => k.id)).toEqual(['none']);
    // Apart, every one is drawn, at its own place.
    expect(thin([m(10, 10, 0, 'a'), m(30, 10, 0, 'b'), m(10, 30, 2, 'c')], 11).map((k) => k.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('never leaves two kept marks closer than the gap, across cells', () => {
    const marks = Array.from({ length: 2000 }, (_, i) => m((i * 7.3) % 400, (i * 3.1) % 300, i % 4, String(i)));
    const kept = thin(marks, 11);
    expect(kept.length).toBeGreaterThan(100);
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) expect(Math.hypot(kept[i]!.x - kept[j]!.x, kept[i]!.y - kept[j]!.y)).toBeGreaterThanOrEqual(11);
    }
  });
});

describe('the file as built', () => {
  it('lists every region, its runs as long as its list in places.json, so a record’s point and its check are one entry', () => {
    const file = JSON.parse(built('grid/region-ages.json')) as RegionAgesFile;
    const places = JSON.parse(built('grid/places.json')) as PlacesFile;
    const { centroids } = JSON.parse(built('console-regions.json')) as { centroids: { region: string }[] };
    expect(file.v).toBe(2);
    expect(Object.keys(file.regions).sort()).toEqual(Object.keys(places.regions).sort());
    const ages = agesOf(file);
    const off = Object.entries(places.regions).filter(([slug, list]) => ages.regions.get(slug)?.length !== list.length).map(([slug]) => slug);
    expect(off).toEqual([]);
    expect(centroids.filter((c) => !file.regions[c.region]).map((c) => c.region)).toEqual([]);
    // Dates, oldest first, and nothing about a record but when it was checked.
    expect(file.dates).toEqual([...file.dates].sort());
    expect(Object.keys(file).sort()).toEqual(['confirmed', 'dates', 'records', 'regions', 'v']);
  });

  it('stays inside the ceiling its line was given, paid only by somebody who shows the ages', () => {
    expect(gzipSync(built('grid/region-ages.json')).length).toBeLessThanOrEqual(MAP_LINES.ages!.data!.limit);
  });
});
