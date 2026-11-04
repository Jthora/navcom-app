import { describe, expect, it } from 'vitest';
import { mergeCorrections, type Correction, type ResourceRecord } from '../src/index.js';

/** A public listing nobody has checked, as the seeder writes one. */
const listing: ResourceRecord = {
  id: 'new-york-overture-abc', region: 'new-york', name: 'The 30th Street Drop-In', type: 'daytime',
  address: '400 W 30th St', verified_by: 'seeder', method: 'website', last_verified: '2026-10-01', flag: 'ok'
};

const said = (by: string, method: Correction['method'], day: string, fields: Correction['fields'] = { flag: 'ok' }): Correction & { by: string } => ({
  record: listing.id, verified_by: by.toUpperCase(), method, last_verified: day, fields, by
});
const now = new Date('2026-11-04');

describe('a person standing behind a listing as it is (2026-11-04)', () => {
  it('is a confirmation when it was checked in person, by phone or on staff’s word', () => {
    const merged = mergeCorrections(listing, [said('wren', 'phone', '2026-11-03'), said('kite', 'in_person', '2026-11-04')], now);
    expect(merged.confirmations.map((c) => [c.by, c.method])).toEqual([['kite', 'in_person'], ['wren', 'phone']]);
    // It changes nothing it says, and it is not a report.
    expect(merged.record).toEqual(listing);
    expect(merged.sources).toEqual({});
    expect(merged.reports).toEqual([]);
  });

  it('is not one when it was read off a website or heard secondhand', () => {
    const merged = mergeCorrections(listing, [said('owl', 'website', '2026-11-04'), said('ash', 'secondhand', '2026-11-04')], now);
    expect(merged.confirmations).toEqual([]);
  });

  it('never stands in for a report: a closure said by somebody else is still read first', () => {
    const merged = mergeCorrections(listing, [said('wren', 'in_person', '2026-11-04'), said('raven', 'in_person', '2026-11-04', { flag: 'reported_closed' })], now);
    expect(merged.reports.map((r) => r.by)).toEqual(['raven']);
    expect(merged.confirmations.map((c) => c.by)).toEqual(['wren']);
  });
});
