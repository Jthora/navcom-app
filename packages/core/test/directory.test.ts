import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { confidenceForClass, confidenceForField, isSeeded } from '../src/directory/confidence';
import { displayField, displayRecord, formatDate, formatRelative } from '../src/directory/display';
import { buildExport } from '../src/directory/export';
import { parseRegion, localTimeNote } from '../src/directory/region';
import { parseCsv, parseDirectory, parseDirectoryOrThrow } from '../src/directory/parse';
import type { ResourceRecord } from '../src/directory/types';
import { STALE_AFTER_DAYS, ageInDays, hemisphereOf, seasonIndex, seasonOf } from '../src/directory/volatility';

const SEED_CSV = fileURLToPath(new URL('../../../data/regions/example/resources.csv', import.meta.url));

/** Fixed so these tests do not start failing with the passage of time. */
const NOW = new Date('2026-08-17T12:00:00Z');

function record(over: Partial<ResourceRecord> = {}): ResourceRecord {
  return { id: 'x', name: 'X', type: 'shelter', flag: 'ok', ...over };
}

describe('parseCsv', () => {
  it('handles quoted fields containing commas', () => {
    const rows = parseCsv('a,b\n1,"hello, world"\n');
    expect(rows[1]).toEqual(['1', 'hello, world']);
  });

  it('handles doubled quotes', () => {
    const rows = parseCsv('a\n"she said ""go"""\n');
    expect(rows[1]).toEqual(['she said "go"']);
  });
});

describe('parseDirectory', () => {
  const csv = readFileSync(SEED_CSV, 'utf8');

  it('parses the seed file with no issues', () => {
    const { records, issues } = parseDirectory(csv);
    expect(issues).toEqual([]);
    expect(records).toHaveLength(2);
  });

  it('splits pipe-delimited multi-values', () => {
    const [shelter] = parseDirectoryOrThrow(csv);
    expect(shelter.accepts).toEqual(['single_men', 'single_women']);
    expect(shelter.languages).toEqual(['en', 'es']);
  });

  it('rejects an unknown enum value rather than defaulting it', () => {
    const { issues } = parseDirectory('id,name,type,pets\na,A,shelter,maybe\n');
    expect(issues).toHaveLength(1);
    expect(issues[0].column).toBe('pets');
  });

  it('refuses a coordinate more precise than an address earns, and says what to write instead', () => {
    // Overture's 32-bit floats printed at 64-bit length claim nanometres for a pin off a website.
    const { issues, records } = parseDirectory('id,name,type,lat,lon\na,A,shelter,33.95924377441406,-83.38138\n');
    expect(issues).toHaveLength(1);
    expect(issues[0].column).toBe('lat');
    expect(issues[0].message).toMatch(/at most 5 places/);
    expect(records[0].lat).toBeUndefined();
    expect(records[0].lon).toBe(-83.38138);
  });

  it('accepts five decimals or fewer, and refuses a coordinate whose precision cannot be read', () => {
    expect(parseDirectory('id,name,type,lat,lon\na,A,shelter,33.95924,-83.4\n').issues).toEqual([]);
    expect(parseDirectory('id,name,type,lat,lon\na,A,shelter,3.4e1,-83.4\n').issues[0].column).toBe('lat');
  });

  it('rejects a duplicate id — ids are never reused', () => {
    const { issues, records } = parseDirectory('id,name,type\na,A,shelter\na,B,meal\n');
    expect(records).toHaveLength(1);
    expect(issues[0].message).toMatch(/duplicate/);
  });

  it('throws at build time rather than shipping a bad row', () => {
    expect(() => parseDirectoryOrThrow('id,name,type\n,A,shelter\n')).toThrow(/required/);
  });
});

describe('confidence', () => {
  it('in_person within window is high', () => {
    const r = record({ method: 'in_person', last_verified: '2026-08-14' });
    expect(confidenceForClass(r, 'volatile', NOW)).toBe('high');
  });

  it('phone within window is medium', () => {
    const r = record({ method: 'phone', last_verified: '2026-08-14' });
    expect(confidenceForClass(r, 'volatile', NOW)).toBe('medium');
  });

  it('website within window is low', () => {
    const r = record({ method: 'website', last_verified: '2026-08-14' });
    expect(confidenceForClass(r, 'volatile', NOW)).toBe('low');
  });

  it('is per field-group, not per record', () => {
    // 20 days old: past the 14-day volatile window, inside the 90-day slow window.
    const r = record({ method: 'in_person', last_verified: '2026-07-28' });
    expect(confidenceForClass(r, 'volatile', NOW)).toBe('stale');
    expect(confidenceForClass(r, 'slow', NOW)).toBe('high');
    expect(confidenceForClass(r, 'static', NOW)).toBe('high');
  });

  it('a non-ok flag overrides even a fresh in-person verification', () => {
    const r = record({ method: 'in_person', last_verified: '2026-08-17', flag: 'reported_wrong' });
    expect(confidenceForClass(r, 'static', NOW)).toBe('suspect');
  });

  it('treats a missing verification date as stale, not as low', () => {
    expect(confidenceForClass(record({ method: 'in_person' }), 'static', NOW)).toBe('stale');
  });

  it('treats a missing method as stale, not as low', () => {
    expect(confidenceForClass(record({ last_verified: '2026-08-17' }), 'static', NOW)).toBe('stale');
  });

  it('goes stale on season change even inside the 30-day window', () => {
    // 2026-05-30 is spring; 2026-06-10 is summer. 11 days apart.
    const r = record({ method: 'in_person', last_verified: '2026-05-30' });
    expect(confidenceForClass(r, 'seasonal', new Date('2026-06-10T12:00:00Z'))).toBe('stale');
    expect(confidenceForClass(r, 'slow', new Date('2026-06-10T12:00:00Z'))).toBe('high');
  });

  it('marks website and secondhand entries as seeded', () => {
    expect(isSeeded(record({ method: 'website' }))).toBe(true);
    expect(isSeeded(record({ method: 'secondhand' }))).toBe(true);
    expect(isSeeded(record({ method: 'in_person' }))).toBe(false);
  });
});

describe('staleness margin (the page outliving its build)', () => {
  const onTheEdge = (days: number) =>
    record({ method: 'in_person', last_verified: new Date(Date.UTC(2026, 7, 17 - days)).toISOString().slice(0, 10) });

  it('goes call-first one day EARLY rather than one day late', () => {
    // Exactly at the 14-day volatile window. Without a margin this reads fresh; a page
    // built today and read tomorrow would then be showing a value that has expired.
    const atWindow = onTheEdge(STALE_AFTER_DAYS.volatile);
    expect(confidenceForClass(atWindow, 'volatile', NOW, 0)).toBe('high');
    expect(confidenceForClass(atWindow, 'volatile', NOW)).toBe('stale');
  });

  it('errs toward call-first, never toward a confident stale value', () => {
    const justInside = onTheEdge(STALE_AFTER_DAYS.volatile - 1);
    // Safe direction only: never reports fresher than the exact computation would.
    const exact = confidenceForClass(justInside, 'volatile', NOW, 0);
    const margined = confidenceForClass(justInside, 'volatile', NOW);
    expect(['high', 'stale']).toContain(exact);
    if (exact === 'stale') expect(margined).toBe('stale');
  });

  it('leaves long windows unaffected', () => {
    const r = record({ method: 'in_person', last_verified: '2026-08-14' });
    expect(confidenceForClass(r, 'static', NOW)).toBe('high');
    expect(confidenceForClass(r, 'slow', NOW)).toBe('high');
  });
});

describe('display rules', () => {
  it('rule 5 — a blank field renders unknown, never as absence of a restriction', () => {
    const r = record({ method: 'in_person', last_verified: '2026-08-14' });
    expect(displayField(r, 'pets', NOW).kind).toBe('unknown');
    expect(displayField(r, 'sex_offender_ok', NOW).kind).toBe('unknown');
  });

  it('rule 1 — a volatile value always carries its age', () => {
    const r = record({ method: 'in_person', last_verified: '2026-08-14', hours: '19:00-07:00' });
    const d = displayField(r, 'hours', NOW);
    expect(d.kind).toBe('value');
    if (d.kind === 'value') {
      expect(d.age).not.toBeNull();
      expect(d.age!.absolute).toBe('14 Aug 2026');
      expect(d.age!.relative).toBe('3 days ago');
    }
  });

  it('rule 2 — stale volatile data reads call-first and does not carry the old value', () => {
    const r = record({ method: 'in_person', last_verified: '2026-07-28', hours: '19:00-07:00' });
    const d = displayField(r, 'hours', NOW);
    expect(d.kind).toBe('call-first');
    expect(JSON.stringify(d)).not.toContain('19:00');
  });

  it('rule 2 — a slow field of the same record still shows its value', () => {
    const r = record({ method: 'in_person', last_verified: '2026-07-28', pets: 'yes', hours: '19:00-07:00' });
    expect(displayField(r, 'hours', NOW).kind).toBe('call-first');
    expect(displayField(r, 'pets', NOW).kind).toBe('value');
  });

  it('rule 1 — a volatile value with no ascertainable age reads call-first', () => {
    const r = record({ method: 'in_person', hours: '19:00-07:00' });
    expect(displayField(r, 'hours', NOW).kind).toBe('call-first');
  });

  it('rule 3 — a suspect record surfaces its flag', () => {
    const r = record({ flag: 'reported_wrong', method: 'phone', last_verified: '2026-08-14' });
    const d = displayRecord(r, NOW);
    expect(d.flagFirst).not.toBeNull();
    expect(d.flagFirst!.flag).toBe('reported_wrong');
  });

  it('rule 3 — an ok record surfaces nothing', () => {
    expect(displayRecord(record(), NOW).flagFirst).toBeNull();
  });

  it('rule 6 — seeded entries are marked for distinct rendering', () => {
    expect(displayRecord(record({ method: 'website' }), NOW).seeded).toBe(true);
  });

  it('renders booleans rather than dropping false', () => {
    const r = record({ referral_required: false, method: 'in_person', last_verified: '2026-08-14' });
    const d = displayField(r, 'referral_required', NOW);
    expect(d.kind).toBe('value');
    if (d.kind === 'value') expect(d.value).toBe('no');
  });
});

describe('the seed file end to end', () => {
  const [shelter, warming] = parseDirectoryOrThrow(readFileSync(SEED_CSV, 'utf8'));

  it('shows the shelter hours with an age', () => {
    const d = displayField(shelter, 'hours', NOW);
    expect(d.kind).toBe('value');
    if (d.kind === 'value') {
      expect(d.age!.absolute).toBe('14 Aug 2026');
      expect(d.age!.relative).toBe('3 days ago');
    }
  });

  it('renders every field of the reported_wrong warming centre as suspect', () => {
    expect(displayRecord(warming, NOW).flagFirst!.flag).toBe('reported_wrong');
    expect(confidenceForField(warming, 'pets', NOW)).toBe('suspect');
    expect(displayField(warming, 'hours', NOW).kind).toBe('call-first');
  });
});

describe('helpers', () => {
  it('counts age in whole days', () => {
    expect(ageInDays('2026-08-14', NOW)).toBe(3);
    expect(ageInDays('2026-08-17', NOW)).toBe(0);
  });

  it('labels relative ages readably', () => {
    expect(formatRelative(0)).toBe('today');
    expect(formatRelative(1)).toBe('yesterday');
    expect(formatRelative(3)).toBe('3 days ago');
    expect(formatRelative(60)).toBe('2 months ago');
    expect(formatRelative(400)).toBe('1 year ago');
  });

  it('formats absolute dates unambiguously', () => {
    expect(formatDate('2026-08-14')).toBe('14 Aug 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('knows meteorological seasons in the hemisphere it is asked about', () => {
    expect(seasonOf(new Date('2026-01-15T00:00:00Z'), 'north')).toBe('winter');
    expect(seasonOf(new Date('2026-04-15T00:00:00Z'), 'north')).toBe('spring');
    expect(seasonOf(new Date('2026-07-15T00:00:00Z'), 'north')).toBe('summer');
    expect(seasonOf(new Date('2026-10-15T00:00:00Z'), 'north')).toBe('autumn');
  });
});

describe('machine-readable export', () => {
  const records = parseDirectoryOrThrow(readFileSync(SEED_CSV, 'utf8'));
  const out = buildExport(records, NOW);

  it('carries the margin and windows so a consumer need not guess them', () => {
    expect(out.staleness_margin_days).toBe(STALE_AFTER_DAYS.volatile - 13);
    expect(out.stale_after_days.volatile).toBe(14);
    expect(out.version).toBe(1);
  });

  it('gives every record a provenance object shaped for a 20912 answer', () => {
    for (const r of out.records) {
      expect(r.provenance.record_id).toBe(r.id);
      expect(r.provenance).toHaveProperty('verified');
      expect(r.provenance).toHaveProperty('method');
    }
  });

  it('never leaks a withheld value into the export', () => {
    const warming = out.records.find((r) => r.id === 'EXAMPLE-warming-02')!;
    const hours = warming.fields.hours;
    expect(hours.display).toBe('call-first');
    // A call-first verdict has no `values` key at all — it cannot be rendered by accident.
    expect(JSON.stringify(hours)).not.toContain('values');
  });

  it('marks a flagged record call-first with reason "flagged"', () => {
    const warming = out.records.find((r) => r.id === 'EXAMPLE-warming-02')!;
    expect(warming.fields.hours).toMatchObject({ reason: 'flagged' });
    expect(warming.confidence.slow).toBe('suspect');
  });

  it('reports confidence per volatility class, not per record', () => {
    const r = buildExport(
      [{ id: 'z', name: 'Z', type: 'shelter', flag: 'ok', method: 'in_person', last_verified: '2026-07-28' }],
      NOW
    ).records[0];
    expect(r.confidence.volatile).toBe('stale');
    expect(r.confidence.slow).toBe('high');
  });

  it('states its contract in the payload', () => {
    expect(out.contract.join(' ')).toMatch(/Do not recompute confidence/);
    expect(out.contract.join(' ')).toMatch(/never means "no restriction"/);
  });
});

describe('seasons across the planet', () => {
  it('season CHANGE points are identical in both hemispheres — do not "fix" this', () => {
    // The seasonal staleness trigger asks "has the season changed", never "which season".
    // Both hemispheres divide the year at the same four moments, so the answer is the same
    // everywhere. This test exists to stop someone seeing northern-looking month logic and
    // threading a hemisphere through a calculation it cannot affect.
    const idx = (m: number) => seasonIndex(new Date(Date.UTC(2026, m, 15)));
    const changes = [...Array(12).keys()].filter((m) => idx(m) !== idx((m + 11) % 12));
    expect(changes).toEqual([2, 5, 8, 11]);
  });

  it('season NAMES are hemisphere-dependent', () => {
    const december = new Date('2026-12-15T00:00:00Z');
    expect(seasonOf(december, 'north')).toBe('winter');
    expect(seasonOf(december, 'south')).toBe('summer');
  });

  it('declines to name a season in the tropics rather than guessing', () => {
    expect(seasonOf(new Date('2026-12-15T00:00:00Z'), 'tropical')).toBeNull();
  });

  it('derives hemisphere from latitude, and admits when it cannot', () => {
    expect(hemisphereOf(51.5)).toBe('north');    // London
    expect(hemisphereOf(-37.8)).toBe('south');   // Melbourne
    expect(hemisphereOf(1.35)).toBe('tropical'); // Singapore
    expect(hemisphereOf(undefined)).toBeNull();
  });

  it('still goes stale on a season change south of the equator', () => {
    const r = record({ method: 'in_person', last_verified: '2026-05-30', lat: -37.8 });
    expect(confidenceForClass(r, 'seasonal', new Date('2026-06-10T12:00:00Z'))).toBe('stale');
  });
});

describe('reports_to — the field the Medic asked for', () => {
  it('parses as a multi-value', () => {
    const [r] = parseDirectoryOrThrow(readFileSync(SEED_CSV, 'utf8'));
    expect(r.reports_to).toEqual(['no_one']);
  });

  it('rejects a value outside the enum', () => {
    const { issues } = parseDirectory('id,name,type,reports_to\na,A,shelter,fbi\n');
    expect(issues[0].column).toBe('reports_to');
  });

  it('distinguishes "reports to no one" from "nobody has established it"', () => {
    const known = record({ method: 'in_person', last_verified: '2026-08-14', reports_to: ['no_one'] });
    const unknown = record({ method: 'in_person', last_verified: '2026-08-14' });
    expect(displayField(known, 'reports_to', NOW).kind).toBe('value');
    expect(displayField(unknown, 'reports_to', NOW).kind).toBe('unknown');
  });

  it('is a slow field, so it survives the volatile window', () => {
    const r = record({ method: 'in_person', last_verified: '2026-07-28', reports_to: ['police'] });
    expect(displayField(r, 'hours', NOW).kind).not.toBe('value');
    expect(displayField(r, 'reports_to', NOW).kind).toBe('value');
  });
});

describe('regions', () => {
  const valid = {
    slug: 'berlin', name: 'Berlin', country: 'DE',
    timezone: 'Europe/Berlin', languages: ['de', 'en'], status: 'maintained'
  };

  it('accepts a well-formed manifest', () => {
    expect(parseRegion('berlin', valid)).toMatchObject({ country: 'DE', timezone: 'Europe/Berlin' });
  });

  it('refuses a manifest whose slug disagrees with its folder', () => {
    expect(() => parseRegion('munich', valid)).toThrow(/slug is "berlin" but the folder is "munich"/);
  });

  it('refuses a country that is not ISO 3166-1 alpha-2', () => {
    expect(() => parseRegion('berlin', { ...valid, country: 'Germany' })).toThrow(/alpha-2/);
    expect(() => parseRegion('berlin', { ...valid, country: 'de' })).toThrow(/alpha-2/);
  });

  it('refuses a timezone that is not an IANA name', () => {
    expect(() => parseRegion('berlin', { ...valid, timezone: 'CET' })).toThrow(/IANA/);
    expect(() => parseRegion('berlin', { ...valid, timezone: 'GMT+1' })).toThrow(/IANA/);
  });

  it('accepts UTC, which is how a region with no better answer says so', () => {
    expect(parseRegion('berlin', { ...valid, timezone: 'UTC' }).timezone).toBe('UTC');
  });

  it('requires at least one language, as ISO 639-1', () => {
    expect(() => parseRegion('berlin', { ...valid, languages: [] })).toThrow(/at least one/);
    expect(() => parseRegion('berlin', { ...valid, languages: ['German'] })).toThrow(/639-1/);
  });

  it('requires an honest status', () => {
    expect(() => parseRegion('berlin', { ...valid, status: 'good' })).toThrow(/status must be/);
  });

  it('states the timezone rather than implying it', () => {
    expect(localTimeNote(parseRegion('berlin', valid))).toBe('Times are local to Europe/Berlin.');
    expect(localTimeNote(parseRegion('berlin', { ...valid, timezone: 'UTC' }))).toBe('Times are UTC.');
  });
});

describe('the region template', () => {
  it('ships an invalid manifest on purpose, so nobody deploys it unedited', () => {
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../data/regions/_template/region.json', import.meta.url)), 'utf8')
    );
    expect(() => parseRegion('_template', raw)).toThrow();
  });
});

describe('a file that cannot be scanned', () => {
  it('fails instead of silently swallowing every row after a stray quote', () => {
    /*
     * One unterminated quote turned every following newline and comma into text inside a single
     * field, so the build shipped a directory that stopped at that row and reported nothing.
     * Silent absence of a shelter is the failure this parser exists to prevent, and it was the
     * one malformation it could not see.
     */
    const csv = 'id,name,type,notes\nr1,First,shelter,"open late\nr2,Second,shelter,\n';
    const { records, issues } = parseDirectory(csv);
    expect(records).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/unterminated quote/i);
    expect(() => parseDirectoryOrThrow(csv)).toThrow(/unterminated quote/i);
  });

  it('still reads a quoted field that closes, including doubled quotes', () => {
    // The guard must not cost the thing it guards.
    expect(parseCsv('a,b\n1,"hello, world"\n')[1]![1]).toBe('hello, world');
    expect(parseCsv('a\n"she said ""go"""\n')[1]![0]).toBe('she said "go"');
  });
});

describe('how old a thing is said to be', () => {
  it('never calls a nearly-year-old check "0 years ago"', () => {
    // Months floored by 30 reached 12 while years floored by 365 was still 0, so 360-364 days
    // read as "0 years ago" — recent, on the one function whose whole job is age.
    for (const days of [360, 361, 364, 365, 400]) expect(formatRelative(days)).toBe('1 year ago');
    expect(formatRelative(740)).toBe('2 years ago');
  });
});
