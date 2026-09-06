import { describe, expect, it } from 'vitest';
import {
  DECISIVE_FIELDS, displayMerged, isDecisive, mergeCorrections,
  type Correction, type ResourceRecord
} from '../src/index.js';

/**
 * The attack this closes, written as the test.
 *
 * `method` is self-asserted — nothing verifies anybody stood anywhere — and `in_person` ranks
 * *high* while every record in the published directory is `website`, which ranks *low*. So the
 * bar to override anything we hold is one sentence: claim you were there.
 *
 * On most fields that is survivable. On a decisive one it is the Medic's kill trigger,
 * confident wrong guidance, and it needs no scale at all: one claim, one shelter, one cold
 * night.
 */

const NOW = new Date('2026-09-06');

const shelter = (over: Partial<ResourceRecord> = {}): ResourceRecord => ({
  id: 'r1', name: 'St Pat\'s', type: 'shelter', flag: 'ok',
  method: 'website', last_verified: '2026-09-03',
  intake_hours: '18:00-22:00', hours: '24h', phone: '555-0100',
  ...over
});

const hostile = (fields: Correction['fields']): Correction & { by: string } => ({
  record: 'r1', verified_by: 'Somebody', method: 'in_person',
  last_verified: '2026-09-06', fields, by: 'attacker'
});

describe('a decisive field two people disagree about', () => {
  it('renders call first rather than the better-attested claim', () => {
    // The whole attack: in_person beats website, so without this the reader is told 22:00.
    const merged = mergeCorrections(shelter(), [hostile({ intake_hours: 'closed' })], NOW);
    const { display } = displayMerged(merged, 'intake_hours', NOW);
    expect(display.kind).toBe('call-first');
    expect(display.kind === 'call-first' && display.because).toBe('contested');
  });

  it('never renders the contested value, in either direction', () => {
    // Rule 2: the losing value is structurally absent. So is the winning one here — the point
    // is that neither is known, and printing either would be picking a side.
    const merged = mergeCorrections(shelter(), [hostile({ intake_hours: 'closed' })], NOW);
    const { display } = displayMerged(merged, 'intake_hours', NOW);
    expect(JSON.stringify(display)).not.toContain('closed');
    expect(JSON.stringify(display)).not.toContain('18:00');
  });

  it('applies to every decisive field and to none of the others', () => {
    for (const field of DECISIVE_FIELDS) {
      const base = shelter({ [field]: 'original' } as Partial<ResourceRecord>);
      const merged = mergeCorrections(base, [hostile({ [field]: 'different' })], NOW);
      const { display } = displayMerged(merged, field, NOW);
      expect(display.kind, `${field} should be contested`).toBe('call-first');
    }
    // `hours` decides nothing on its own — somebody is not turned away over it.
    expect(isDecisive('hours')).toBe(false);
    const merged = mergeCorrections(shelter(), [hostile({ hours: '20h' })], NOW);
    expect(displayMerged(merged, 'hours', NOW).display.kind).toBe('value');
  });
});

describe('what it deliberately does not soften', () => {
  it('a correction filling a blank is new information, not a contradiction', () => {
    // Punishing this would penalise the ordinary case — most of the directory is blank here.
    const merged = mergeCorrections(
      shelter({ intake_hours: undefined }), [hostile({ intake_hours: '19:00-21:00' })], NOW
    );
    expect(displayMerged(merged, 'intake_hours', NOW).display.kind).toBe('value');
  });

  it('a correction agreeing with the record leaves it alone', () => {
    const merged = mergeCorrections(shelter(), [hostile({ intake_hours: '18:00-22:00' })], NOW);
    expect(displayMerged(merged, 'intake_hours', NOW).display.kind).toBe('value');
  });

  it('still records who said it, so the reader is not left with a bare shrug', () => {
    const merged = mergeCorrections(shelter(), [hostile({ intake_hours: 'closed' })], NOW);
    expect(displayMerged(merged, 'intake_hours', NOW).by?.verified_by).toBe('Somebody');
  });
});

describe('the merge keeps what it needs to see a disagreement', () => {
  it('records the value a correction replaced', () => {
    const merged = mergeCorrections(shelter(), [hostile({ intake_hours: 'closed' })], NOW);
    expect(merged.sources.intake_hours?.replaced).toBe('18:00-22:00');
  });

  it('records nothing when there was nothing to replace', () => {
    const merged = mergeCorrections(
      shelter({ intake_hours: undefined }), [hostile({ intake_hours: '19:00' })], NOW
    );
    expect(merged.sources.intake_hours?.replaced).toBeUndefined();
  });
});
