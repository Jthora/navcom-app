import { describe, expect, it } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import {
  CONFIDENTIAL_TYPES, LOCATING_FIELDS, buildPlace, isConfidential, isLocating,
  locatingLeaks, mergeCorrections, parseDirectory, placeId, PlaceError,
  type Correction, type ResourceRecord
} from '../src/index.js';

/**
 * Invariant 1 again, at the one place it was true only by luck.
 *
 * A domestic-violence refuge's address is the protection rather than a detail about it. There
 * were **zero `dv` records when this was written**, and that was an accident: OSM and Overture
 * do not tag refuges, so the importer never made one. Nothing stopped an operator adding a
 * refuge from the field tomorrow with the address attached — in good faith, which is the shape
 * of every accident this project has actually had.
 *
 * Four doors, so four sets of tests. A rule enforced at one of them is a rule enforced at none:
 * the seed CSV, a place added from the field, a correction merged over a clean record at read
 * time, and the rendered page. The fourth lives in web/, against the built HTML, because three
 * times this project has shipped a rule the logic honoured and the output did not.
 */

const dv = (over: Partial<ResourceRecord> = {}): ResourceRecord => ({
  id: 'r1', name: 'Safe House', type: 'dv', flag: 'ok', ...over
});

const csv = (rows: string) => `id,name,type,address,lat,lon,phone\n${rows}`;

describe('what counts as locating a refuge', () => {
  it('names the address and both coordinates, and nothing else', () => {
    // The set is the rule. Everything else a record carries describes what the place does,
    // which is exactly what somebody needs in order to phone it.
    expect([...LOCATING_FIELDS].sort()).toEqual(['address', 'lat', 'lon']);
    expect(CONFIDENTIAL_TYPES).toContain('dv');
    expect(isConfidential('dv')).toBe(true);
    expect(isConfidential('shelter')).toBe(false);
    expect(isLocating('address')).toBe(true);
    expect(isLocating('phone')).toBe(false);
  });

  it('reports a leak for each locating field a refuge carries', () => {
    expect(locatingLeaks(dv({ address: '412 Elm St' }))).toEqual(['address']);
    expect(locatingLeaks(dv({ lat: 39.95, lon: -75.16 }))).toEqual(['lat', 'lon']);
    expect(locatingLeaks(dv({ address: '412 Elm', lat: 1, lon: 2 }))).toEqual(LOCATING_FIELDS);
  });

  it('treats 0,0 as a leak, because Null Island is still a coordinate', () => {
    // A falsy-check instead of a finite-check would let `lat: 0` through, and 0 is a real
    // value here rather than an absent one.
    expect(locatingLeaks(dv({ lat: 0, lon: 0 }))).toEqual(['lat', 'lon']);
  });

  it('does not count a blank string, which is what a CSV round-trip produces', () => {
    // `address=""` and a missing column are the same fact. A rule that failed on the first
    // would fail every record exported and re-imported.
    expect(locatingLeaks(dv({ address: '   ' }))).toEqual([]);
    expect(locatingLeaks(dv())).toEqual([]);
  });

  it('leaves every other type alone', () => {
    expect(locatingLeaks({ ...dv({ address: '1 Main' }), type: 'shelter' })).toEqual([]);
  });
});

describe('door 1 — the seed CSV', () => {
  it('reports the address on a refuge as a problem, so the build fails', () => {
    const { issues } = parseDirectory(csv('r1,Safe House,dv,412 Elm St,,,555-0100'));
    expect(issues.map((i) => i.column)).toContain('address');
    expect(issues.find((i) => i.column === 'address')?.message).toMatch(/refuge/i);
  });

  it('strips it as well, for the caller that never reads issues', () => {
    // parseDirectory hands back records *and* issues and nothing forces a reader to look at
    // the second one.
    const { records } = parseDirectory(csv('r1,Safe House,dv,412 Elm St,39.9,-75.1,555-0100'));
    expect(records[0]!.address).toBeUndefined();
    expect(records[0]!.lat).toBeUndefined();
    expect(records[0]!.lon).toBeUndefined();
  });

  it('keeps the refuge, because a service nobody can find is its own harm', () => {
    const { records } = parseDirectory(csv('r1,Safe House,dv,412 Elm St,,,555-0100'));
    expect(records).toHaveLength(1);
    expect(records[0]!.phone).toBe('555-0100');
    expect(records[0]!.name).toBe('Safe House');
  });

  it('does not interfere with an ordinary record', () => {
    const { records, issues } = parseDirectory(csv('r2,Shelter,shelter,1 Main St,39.9,-75.1,555-0101'));
    expect(issues).toEqual([]);
    expect(records[0]!.address).toBe('1 Main St');
    expect(records[0]!.lat).toBe(39.9);
  });
});

describe('door 2 — a place added from the field', () => {
  const place = (type: string) => ({
    // The id is derived, never chosen — so the fixture derives it too, or buildPlace refuses
    // for a reason that has nothing to do with what is under test here.
    id: placeId('Safe House', '412 Elm St'),
    region: 'philadelphia', name: 'Safe House', type: type as never,
    address: '412 Elm St', verified_by: 'Zone Guardian',
    method: 'in_person' as const, last_verified: '2026-09-03'
  });

  it('refuses a refuge outright, because an address is required here', () => {
    // The collision that makes this the only door where stripping is not available: the id is
    // derived from name and address, and readPlace re-derives it to verify the event.
    expect(() => buildPlace(generateSecretKey(), place('dv'), 0)).toThrow(PlaceError);
    expect(() => buildPlace(generateSecretKey(), place('dv'), 0)).toThrow(/refuge|maintainers/i);
  });

  it('still accepts every other type', () => {
    expect(() => buildPlace(generateSecretKey(), place('shelter'), 0)).not.toThrow();
  });
});

describe('door 3 — a correction merged at read time', () => {
  const correction = (fields: Correction['fields']): Correction & { by: string } => ({
    record: 'r1', verified_by: 'Somebody', method: 'in_person',
    last_verified: '2026-09-03', fields, by: 'abc123'
  });
  const now = new Date('2026-09-04');

  it('drops an address asserted onto a refuge that shipped clean', () => {
    // The one door a CSV check cannot watch: the base record is fine, and the address arrives
    // later, over a relay, from anyone.
    const merged = mergeCorrections(dv({ phone: '555-0100' }), [correction({ address: '412 Elm St' })], now);
    expect(merged.record.address).toBeUndefined();
  });

  it('applies the same correction to any other type', () => {
    const base = { ...dv({ phone: '555-0100' }), type: 'shelter' as const };
    const merged = mergeCorrections(base, [correction({ address: '412 Elm St' })], now);
    expect(merged.record.address).toBe('412 Elm St');
  });

  it('still merges the useful fields of a correction that also carried an address', () => {
    // Dropping the field, not the correction. An operator who reports new hours and an address
    // has told us something worth keeping.
    const merged = mergeCorrections(
      dv(), [correction({ address: '412 Elm St', hours: '24h' })], now
    );
    expect(merged.record.address).toBeUndefined();
    expect(merged.record.hours).toBe('24h');
  });
});
