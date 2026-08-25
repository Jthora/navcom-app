import { describe, expect, it } from 'vitest';
import { FIELD_CLASS, PLACE_EXTRAS } from '../src/index.js';

/**
 * Invariant 1, checked mechanically rather than trusted to review.
 *
 * *"Nothing is recorded about the people being served. No field, no convention, so there is no
 * field for it because there must never be one."* That has been true by omission since the
 * schema was written and has had **no mechanical check** — nobody has ever run something that
 * would fail if a field crept in.
 *
 * This is not a PII content scanner, and it should not be mistaken for one. Nothing here can tell
 * "this free-text note describes a person" from a regular expression, and claiming it could would
 * be the exact false confidence this project refuses. What *is* checkable is narrower and
 * complete: **the set of fields the schema allows at all.** `FIELD_CLASS` is exhaustive over
 * `ResourceField` by the type system — a field added to the schema and forgotten here is a type
 * error, not a silent gap — so it is the one place a future addition cannot slip past unnoticed.
 *
 * If this test ever fails, the honest reading is not "fix the regex." It is: a field was just
 * added to the directory schema that describes a person rather than a place, and it should not
 * exist.
 */

/**
 * Terms a field name must not contain as a whole underscore-delimited token.
 *
 * Deliberately about identity and biography — the concepts invariant 1 forbids outright — not
 * about anything already legitimately in the schema. `sobriety`, `sex_offender_ok` and
 * `id_required` describe a *place's policy*, which is what this directory exists to carry;
 * `id_number`, `dob` or `diagnosis` would describe a *person*, which it must never carry.
 */
const FORBIDDEN = [
  'name',       // 'name' itself is the place's name — excluded explicitly below
  'legal',
  'dob',
  'birth',
  'age',
  'ssn',
  'social_security',
  'diagnosis',
  'medical_record',
  'client',
  'patient',
  'resident',
  'guest_name',
  'race',
  'ethnicity',
  'gender',
  'photo',
  'email',
  'address_of_record'
] as const;

/** Fields that legitimately exist and must not trip the check despite resembling a forbidden term. */
const ALLOWED_EXCEPTIONS = new Set(['name', 'address']);

describe('the directory schema cannot carry a field about a person', () => {
  const allFields = Object.keys(FIELD_CLASS);

  it('has fields at all, so this test is exercising something real', () => {
    // Guards against the schema being refactored out from under FIELD_CLASS without anyone
    // noticing this test now checks an empty list and always passes.
    expect(allFields.length).toBeGreaterThan(10);
  });

  it('names only what invariant 1 permits — facts about a place', () => {
    /*
     * Matched by whole underscore-delimited token, not substring — `languages` contains "age",
     * `capacity_signal` is nowhere near either forbidden term, and a substring match flagged the
     * first of those as false. A field name is a sequence of concepts joined by underscores, so
     * comparing at that grain is the honest version of "does this field mean one of these things"
     * rather than "does this string happen to contain these letters".
     */
    for (const field of allFields) {
      if (ALLOWED_EXCEPTIONS.has(field)) continue;
      const tokens = field.split('_');
      for (const term of FORBIDDEN) {
        expect(tokens, `"${field}" reads as person-describing ("${term}")`).not.toContain(term);
      }
    }
  });

  it('"name" is the place\'s own name, not a field about who it serves', () => {
    // Explicit rather than silently excluded, so a reviewer sees the reasoning rather than a
    // field quietly missing from the loop above.
    expect(allFields).toContain('name');
  });

  it('the fields a place may carry at creation are the same, narrower set', () => {
    // A second schema — what an operator can set when adding a place — and it must be held to
    // the identical rule, and the identical grain of comparison. Narrower than the full record on
    // purpose (see places.ts), but not exempt from this one.
    for (const field of PLACE_EXTRAS) {
      const tokens = field.split('_');
      for (const term of FORBIDDEN) {
        expect(tokens, `"${field}" reads as person-describing ("${term}")`).not.toContain(term);
      }
    }
  });

  it('carries no field for who was turned away, or why', () => {
    /*
     * The specific case CLAUDE.md names as the reason this rule exists: a count or a reason for
     * refusal is a fact about a person, dressed as an operational field. Named explicitly because
     * it is the one most likely to be proposed as "useful data" by someone who has not read the
     * invariant.
     */
    const suspicious = ['turned_away', 'refused_reason', 'occupancy_count', 'served_count'];
    for (const field of allFields) {
      expect(suspicious).not.toContain(field);
    }
  });
});
