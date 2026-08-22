/**
 * Live corrections, and the two properties that keep them safe.
 *
 * A correction is how the ninth tribe's knowledge gets in — perishable, local, and known only
 * by the person who was standing there. The tests that matter are not the round trip:
 *
 *  1. **A correction is weighed, never obeyed.** An in-person check from last night beats a
 *     website scrape from March because the confidence rules already said so
 *  2. **It is additive.** Nothing a hostile operator sends can remove a record or blank a
 *     field, because `declined.md` declines adjudication and there is nobody to appeal to
 */

import { KIND_CORRECTION } from '../src/events/kinds';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import type { ResourceRecord } from '../src/directory/types';
import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  buildCorrection,
  CorrectionError,
  displayField,
  displayMerged,
  mergeCorrections,
  needsChecking,
  readCorrection,
  type Correction,
  type ResourceRecord
} from '../src/index.js';

const wren = generateSecretKey();
const raven = generateSecretKey();
const NOW = new Date('2026-08-20T00:00:00Z');
const overRelay = (e: Event): Event => JSON.parse(JSON.stringify(e)) as Event;

/** Scraped from a website in March. True-ish, old, and nobody has been there. */
const base = (over: Partial<ResourceRecord> = {}): ResourceRecord =>
  ({
    id: 'st-louis-example',
    name: 'Example Shelter',
    type: 'shelter',
    hours: 'Mon-Sun 19:00-07:00',
    last_verified: '2026-03-01',
    verified_by: 'anonymous',
    method: 'website',
    flag: 'ok',
    ...over
  }) as ResourceRecord;

const correction = (over: Partial<Correction> = {}): Correction => ({
  record: 'st-louis-example',
  verified_by: 'Wren',
  method: 'in_person',
  last_verified: '2026-08-19',
  fields: { hours: 'Mon-Sun 20:00-06:00' },
  ...over
});

const readable = (secret: Uint8Array, c: Correction) =>
  readCorrection(overRelay(buildCorrection(secret, c, 1_755_300_000)))!;

describe('a correction is weighed, not obeyed', () => {
  it('lets last night in person beat March off a website', () => {
    const merged = mergeCorrections(base(), [readable(wren, correction())], NOW);
    expect(merged.record.hours).toBe('Mon-Sun 20:00-06:00');
    expect(merged.sources.hours?.correction?.verified_by).toBe('Wren');
  });

  it('does not let a stale correction beat a fresh record', () => {
    // Somebody's note from last winter must not overwrite a record checked this week.
    const fresh = base({ last_verified: '2026-08-18', method: 'in_person', verified_by: 'Owl' });
    const old = readable(wren, correction({ last_verified: '2026-01-04' }));
    const merged = mergeCorrections(fresh, [old], NOW);
    expect(merged.record.hours).toBe('Mon-Sun 19:00-07:00');
    expect(merged.sources.hours).toBeUndefined();
  });

  it('fills a blank, because a blank is no claim at all', () => {
    // Rule 5 renders blank as "unknown". Anything sourced beats nothing.
    const merged = mergeCorrections(
      base({ pets: undefined }),
      [readable(wren, correction({ fields: { pets: 'yes' } }))],
      NOW
    );
    expect(merged.record.pets).toBe('yes');
  });

  it('prefers the more recent of two equally good corrections', () => {
    const older = readable(wren, correction({ last_verified: '2026-08-10' }));
    const newer = readable(raven, correction({
      verified_by: 'Raven', last_verified: '2026-08-19', fields: { hours: '21:00-05:00' }
    }));
    const merged = mergeCorrections(base(), [older, newer], NOW);
    expect(merged.record.hours).toBe('21:00-05:00');
  });

  it('leaves fields nobody corrected exactly as published', () => {
    const merged = mergeCorrections(base({ phone: '314-555-0100' }), [readable(wren, correction())], NOW);
    expect(merged.record.phone).toBe('314-555-0100');
    expect(merged.sources.phone).toBeUndefined();
  });
});

describe('additive, never subtractive — the abuse answer', () => {
  it('cannot make a record suspect for everybody', () => {
    // The whole hazard. If a correction's flag became a property of the record, one hostile
    // operator could make any shelter unusable for everyone -- deletion wearing a different
    // hat -- and `declined.md` refuses to appoint anybody to adjudicate it.
    const hostile = readable(raven, correction({
      verified_by: 'Raven', fields: { flag: 'permanently_closed' }
    }));
    const merged = mergeCorrections(base(), [hostile], NOW);

    expect(merged.record.flag, 'the published record is untouched').toBe('ok');
    expect(merged.reports).toHaveLength(1);
    expect(merged.reports[0]?.verified_by, 'attributed, so a reader can weigh it').toBe('Raven');
  });

  it('cannot blank a field', () => {
    // An empty assertion is refused at build time rather than applied as a deletion.
    expect(() => buildCorrection(wren, correction({ fields: { hours: '' } }), 1)).toThrow(CorrectionError);
    expect(() => buildCorrection(wren, correction({ fields: {} }), 1)).toThrow(CorrectionError);
  });

  it('cannot remove the record', () => {
    const merged = mergeCorrections(base(), [readable(raven, correction({ fields: { flag: 'reported_closed' } }))], NOW);
    expect(merged.record.id).toBe('st-louis-example');
    expect(merged.record.name).toBe('Example Shelter');
  });
});

describe('what a correction refuses to carry', () => {
  it('refuses a field that is not in the schema', () => {
    for (const junk of ['legalName', 'person', 'note_about_client']) {
      expect(() => buildCorrection(wren, correction({ fields: { [junk]: 'x' } as never }), 1), junk)
        .toThrow(CorrectionError);
    }
  });

  it('refuses coordinates', () => {
    // A correction is about what a place does. Where the building is is not something an
    // operator learns by being turned away at the door.
    expect(() => buildCorrection(wren, correction({ fields: { lat: '38.6' } as never }), 1))
      .toThrow(CorrectionError);
  });

  it('refuses one with no author or an unknown method', () => {
    expect(() => buildCorrection(wren, correction({ verified_by: ' ' }), 1)).toThrow(CorrectionError);
    expect(() => buildCorrection(wren, correction({ method: 'vibes' as never }), 1)).toThrow(CorrectionError);
    expect(() => buildCorrection(wren, correction({ last_verified: 'yesterday' }), 1)).toThrow(CorrectionError);
  });

  it('refuses a smuggled field on read, not only on build', () => {
    // A hand-rolled publisher does not call buildCorrection.
    const event = buildCorrection(wren, correction(), 1_755_300_000);
    const forged = overRelay({
      ...event,
      content: JSON.stringify({ ...JSON.parse(event.content), fields: { lat: '38.6' } })
    });
    expect(readCorrection(forged)).toBeNull();
  });

  it('refuses one whose tag disagrees with its payload', () => {
    // A relay indexed the tag. If the two disagree, one is lying and neither is guessable.
    const event = buildCorrection(wren, correction(), 1_755_300_000);
    expect(readCorrection(overRelay({ ...event, tags: [['d', 'somewhere-else']] }))).toBeNull();
  });

  it('refuses one whose signature does not hold', () => {
    const event = buildCorrection(wren, correction(), 1_755_300_000);
    const forged = overRelay({
      ...event,
      content: JSON.stringify({ ...JSON.parse(event.content), verified_by: 'Owl' })
    });
    expect(readCorrection(forged)).toBeNull();
  });
});

describe('who signed it', () => {
  it('is the contact key, so contributing costs no operational exposure', () => {
    // The same separation a card uses. An operator can put knowledge in without being
    // findable, which matters most for the person with the best knowledge and the most
    // reason to stay unlinkable.
    const event = buildCorrection(wren, correction(), 1_755_300_000);
    expect(event.pubkey).toBe(getPublicKey(wren));
  });

  it('is about one record, so a relay can be asked for just that place', () => {
    const event = buildCorrection(wren, correction(), 1_755_300_000);
    expect(event.tags).toEqual([['d', 'st-louis-example']]);
  });
});

describe('what to ask, so contributing is an errand rather than an audit', () => {
  it('names the blanks that decide whether somebody gets in', () => {
    const skeleton = base({ pets: undefined, id_required: undefined, intake_hours: undefined });
    const asks = needsChecking(skeleton, [], NOW);
    expect(asks).toContain('pets');
    expect(asks).toContain('intake_hours');
  });

  it('asks about the door before it asks about anything else', () => {
    // A blank `pets` turns somebody away -- the commonest reason a person refuses a bed. A
    // blank `languages` almost never does.
    const skeleton = base({ pets: undefined, intake_hours: undefined, phone: undefined });
    expect(needsChecking(skeleton, [], NOW)[0]).toBe('intake_hours');
  });

  it('is short, because a list of everything is a list nobody reads', () => {
    const skeleton = base({
      pets: undefined, id_required: undefined, intake_hours: undefined,
      capacity_signal: undefined, sobriety: undefined, accepts: undefined
    });
    expect(needsChecking(skeleton, [], NOW)).toHaveLength(3);
  });

  it('stops asking once somebody has answered', () => {
    // The errand is done. Continuing to ask is how a contribution list becomes noise.
    const skeleton = base({ pets: undefined, intake_hours: undefined });
    const answered = readable(wren, correction({ fields: { pets: 'no' } }));
    expect(needsChecking(skeleton, [answered], NOW)).not.toContain('pets');
  });

  it('falls back to what has gone stale when nothing is blank', () => {
    // A value nobody has confirmed in a season is worth a question, not distrust.
    const old = base({
      pets: 'yes', id_required: 'no', intake_hours: '19:00-21:00',
      capacity_signal: 'often_full', sobriety: 'no_questions', accepts: ['single_men'],
      curfew: '22:00', phone: '314-555-0100', last_verified: '2025-01-01'
    });
    expect(needsChecking(old, [], NOW).length).toBeGreaterThan(0);
  });

  it('asks for nothing when a record is complete and fresh', () => {
    const good = base({
      pets: 'yes', id_required: 'no', intake_hours: '19:00-21:00',
      capacity_signal: 'often_full', sobriety: 'no_questions', accepts: ['single_men'],
      curfew: '22:00', phone: '314-555-0100',
      last_verified: '2026-08-19', method: 'in_person', verified_by: 'Wren'
    });
    expect(needsChecking(good, [], NOW)).toEqual([]);
  });

  it('tasks nobody — it returns fields, never a person', () => {
    // Invariant 6: nothing tasks anyone. This says what is missing; who goes and asks is
    // never the system's business.
    const asks = needsChecking(base({ pets: undefined }), [], NOW);
    expect(asks.every((a) => typeof a === 'string')).toBe(true);
    expect(JSON.stringify(asks)).not.toMatch(/callsign|operator|assign/i);
  });
});

describe('a corrected field carries its own provenance, not the record\'s', () => {
  /**
   * The bug this section exists for.
   *
   * A record carries ONE set of attestation fields; a merged record has as many provenances
   * as it has corrections. Reading the merged record with `displayField` therefore used the
   * base record's age for every field — so a correction made last night in person, over a
   * record scraped in January, rendered as `call-first / stale`.
   *
   * Display rule 2 blanking a value because of an age that was not its own. The corrections
   * were invisible on the face of the records they corrected, which is the entire point of
   * Milestone 6 quietly not working.
   */
  const staleRecord = base({ last_verified: '2025-01-01', method: 'website', verified_by: 'anonymous' });
  const fresh = () => readable(wren, correction({ last_verified: '2026-08-20', method: 'in_person' }));

  it('shows a fresh correction as a value, not as call-first', () => {
    const merged = mergeCorrections(staleRecord, [fresh()], NOW);
    const shown = displayMerged(merged, 'hours', NOW);
    expect(shown.display.kind).toBe('value');
    expect(shown.display.kind === 'value' && shown.display.value).toBe('Mon-Sun 20:00-06:00');
  });

  it('names who said it, which is what standing actually is', () => {
    // 7.6. Not a profile page and not a total -- your standing is that your callsign is on
    // records people rely on. Provenance by name, on the artifact.
    const shown = displayMerged(mergeCorrections(staleRecord, [fresh()], NOW), 'hours', NOW);
    expect(shown.by?.verified_by).toBe('Wren');
    expect(shown.by?.method).toBe('in_person');
  });

  it('reports the correction\'s age, not the record\'s', () => {
    const shown = displayMerged(mergeCorrections(staleRecord, [fresh()], NOW), 'hours', NOW);
    expect(shown.display.kind === 'value' && shown.display.confidence).toBe('high');
  });

  it('leaves an uncorrected field reading exactly as it did', () => {
    const merged = mergeCorrections(staleRecord, [fresh()], NOW);
    expect(displayMerged(merged, 'name', NOW).by).toBeNull();
    expect(displayMerged(merged, 'name', NOW).display).toEqual(displayField(staleRecord, 'name', NOW));
  });

  it('still blanks a correction that is itself old', () => {
    // The rules are not being bypassed, only applied to the right attestation.
    const old = readable(wren, correction({ last_verified: '2025-06-01', method: 'website' }));
    const shown = displayMerged(mergeCorrections(base({ hours: undefined }), [old], NOW), 'hours', NOW);
    expect(shown.display.kind).toBe('call-first');
  });
});

describe('two people who disagree, with nothing to choose between them', () => {
  const now = new Date('2026-08-21T12:00:00Z');
  const base = {
    id: 'r1', name: 'Shelter', type: 'shelter', region: 'st-louis',
    hours: 'Mon-Fri 9-5', last_verified: '2026-03-01', verified_by: 'scrape', method: 'website'
  } as unknown as ResourceRecord;

  const said = (by: string, hours: string, method = 'in_person', date = '2026-08-20') =>
    /*
     * Exactly the shape `readCorrection` returns — no more.
     *
     * The first version of this carried a `reports: []` the wire never delivers, hidden by
     * the cast. A fixture that is richer than the thing it stands in for is how a merge ends
     * up proven against a shape the product cannot build [rule 8].
     */
    ({ record: 'r1', by, verified_by: by, method, last_verified: date, fields: { hours } }) as never;

  it('gives both devices the same answer, whatever order the relays used', () => {
    // Ranking settles almost everything; it could not settle an exact tie, and there the
    // first candidate encountered won. Two operators carrying the same area saw different
    // opening hours for the same shelter, from identical evidence.
    const a = said('aaa', 'ANSWER-A');
    const b = said('bbb', 'ANSWER-B');

    const forward = mergeCorrections(base, [a, b], now).record.hours;
    const backward = mergeCorrections(base, [b, a], now).record.hours;
    expect(forward).toBe(backward);
  });

  it('still lets a better method win regardless of order', () => {
    // The tie-break must not have displaced the rules that do have an answer.
    const scrape = said('aaa', 'FROM-A-WEBSITE', 'website');
    const door = said('zzz', 'FROM-A-DOOR', 'in_person');
    expect(mergeCorrections(base, [scrape, door], now).record.hours).toBe('FROM-A-DOOR');
    expect(mergeCorrections(base, [door, scrape], now).record.hours).toBe('FROM-A-DOOR');
  });

  it('still lets a newer check win regardless of order', () => {
    const older = said('aaa', 'OLDER', 'in_person', '2026-08-01');
    const newer = said('zzz', 'NEWER', 'in_person', '2026-08-20');
    expect(mergeCorrections(base, [older, newer], now).record.hours).toBe('NEWER');
    expect(mergeCorrections(base, [newer, older], now).record.hours).toBe('NEWER');
  });

  it('tells the reader who said it, which is what settles a tie in practice', () => {
    // There is no ground truth to prefer between two equally recent in-person reports, so
    // the answer the reader gets is a name and a date rather than a verdict.
    const merged = mergeCorrections(base, [said('aaa', 'ANSWER-A'), said('bbb', 'ANSWER-B')], now);
    expect(merged.sources.hours?.correction?.verified_by).toBeDefined();
    expect(merged.sources.hours?.correction?.last_verified).toBe('2026-08-20');
  });
});

describe('a correction from a client that does not follow the rules', () => {
  /** Hand-rolled, ignoring everything `buildCorrection` enforces. */
  const hostile = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const secret = generateSecretKey();
    return finalizeEvent({
      kind: KIND_CORRECTION,
      created_at: 1_800_000_000,
      tags: [['d', 'r1']],
      content: JSON.stringify({
        record: 'r1', verified_by: 'Wren', method: 'in_person',
        last_verified: '2026-08-20', fields, ...extra
      })
    }, secret);
  };

  it('cannot blank a field that somebody stood behind', () => {
    // buildCorrection refuses a correction that asserts nothing and readCorrection did not,
    // so `{"hours": ""}` became a merge candidate — and with an in-person method and a
    // recent date it outranked the published record and won, erasing the field for every
    // device carrying that area.
    expect(readCorrection(hostile({ hours: '' }))).toBeNull();
    expect(readCorrection(hostile({ hours: '   ' }))).toBeNull();
  });

  it('cannot claim a slot while asserting nothing', () => {
    // Every device's correction store is bounded, so an empty correction was a cheap way to
    // fill somebody else's.
    expect(readCorrection(hostile({}))).toBeNull();
  });

  it('still accepts a real one', () => {
    const read = readCorrection(hostile({ hours: '24/7' }));
    expect(read?.fields.hours).toBe('24/7');
  });

  it('still refuses everything it already refused', () => {
    expect(readCorrection(hostile({ latitude: '38.6' }))).toBeNull();
    expect(readCorrection(hostile({ staff_name: 'Dana' }))).toBeNull();
    expect(readCorrection(hostile({ hours: 'x'.repeat(5000) }))).toBeNull();
    expect(readCorrection(hostile({ hours: '24/7' }, { method: 'telepathy' }))).toBeNull();
    expect(readCorrection(hostile({ hours: '24/7' }, { last_verified: 'yesterday' }))).toBeNull();
  });
});

describe('the merge is fed what the wire actually delivers', () => {
  /**
   * Rule 8 of this audit: prefer a test against something the product can build, and where a
   * fixture and the real builder disagree, **the fixture is the bug.**
   *
   * The merge is exercised mostly with hand-written objects, which is fine and fast — as long
   * as they cannot drift into a shape no relay could produce. This pins the two together.
   */
  it('a read correction carries exactly the keys the merge consumes, and no others', () => {
    const secret = generateSecretKey();
    const event = buildCorrection(secret, {
      record: 'r1', verified_by: 'Wren', method: 'in_person',
      last_verified: '2026-08-20', fields: { hours: '24/7' }
    }, 1_800_000_000);

    const read = readCorrection(event);
    expect(read).not.toBeNull();
    expect(Object.keys(read!).sort()).toEqual(
      ['by', 'fields', 'last_verified', 'method', 'record', 'verified_by'].sort()
    );
  });

  it('and merging that exact object behaves the same as merging a fixture', () => {
    const now = new Date('2026-08-21T12:00:00Z');
    const base = {
      id: 'r1', name: 'Shelter', type: 'shelter', region: 'st-louis',
      hours: 'Mon-Fri 9-5', last_verified: '2026-03-01', verified_by: 'scrape', method: 'website'
    } as unknown as ResourceRecord;

    const secret = generateSecretKey();
    const read = readCorrection(buildCorrection(secret, {
      record: 'r1', verified_by: 'Wren', method: 'in_person',
      last_verified: '2026-08-20', fields: { hours: '24/7' }
    }, 1_800_000_000))!;

    expect(mergeCorrections(base, [read], now).record.hours).toBe('24/7');
  });
});
