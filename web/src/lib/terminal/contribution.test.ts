/**
 * What leaves, and what must never leave with it.
 *
 * The rules here are not stylistic. `propagation.md` requires that the artifact contain only
 * the sharing operator's own activity and never disclose that anybody else was involved, and
 * `data-tiers.md` requires that association data — who has worked with whom — not end up in
 * something built to be pasted in public.
 */

import { describe, expect, it } from 'vitest';
import { exportContribution } from './contribution';
import type { Patrol } from './patrol';

const ME = 'a'.repeat(64);
const SOMEBODY_ELSE = 'b'.repeat(64);
const T = 1_800_000_000;

const night = (over: Partial<Patrol> = {}): Patrol => ({
  started: T,
  ended: T + 12_600,
  area: 'Downtown',
  ...over
});

const correction = (by: string, over: Record<string, unknown> = {}) =>
  ({
    record: 'st-louis-our-ladys-inn',
    verified_by: 'Wren',
    method: 'in_person',
    last_verified: '2026-03-14',
    fields: { intake_hours: '20:30' },
    by,
    ...over
  }) as never;

const place = (by: string, over: Record<string, unknown> = {}) =>
  ({
    id: 'st-louis-the-bridge',
    region: 'st-louis',
    name: 'The Bridge Drop-in',
    type: 'drop_in',
    address: '412 Cherokee St',
    verified_by: 'Wren',
    method: 'in_person',
    last_verified: '2026-02-02',
    by,
    ...over
  }) as never;

const base = {
  callsign: 'Wren',
  mine: ME,
  patrols: [night()],
  corrections: [correction(ME)],
  places: [place(ME)]
};

describe('the contribution record', () => {
  it('carries the nights, the corrections and the places', () => {
    const out = exportContribution(base);
    expect(out).toContain('Contribution — Wren');
    expect(out).toContain('Downtown');
    expect(out).toContain('st-louis-our-ladys-inn');
    expect(out).toContain('The Bridge Drop-in');
    expect(out).toContain('1 patrol');
    expect(out).toContain('1 correction');
    expect(out).toContain('1 place');
  });

  it('carries only what this operator wrote', () => {
    /*
     * The safety boundary. A device holds every correction and place it heard over a relay,
     * most written by strangers — so an unfiltered export publishes other people's work under
     * this operator's name. That is both a false claim and a disclosure about somebody who
     * agreed to nothing.
     */
    const out = exportContribution({
      ...base,
      corrections: [correction(ME), correction(SOMEBODY_ELSE, { record: 'st-louis-not-mine' })],
      places: [place(ME), place(SOMEBODY_ELSE, { name: 'Not My Place' })]
    });
    expect(out).toContain('st-louis-our-ladys-inn');
    expect(out).not.toContain('st-louis-not-mine');
    expect(out).not.toContain('Not My Place');
    expect(out).toContain('1 correction');
    expect(out).toContain('1 place');
  });

  it('matches on the signed pubkey, not on a callsign anybody could type', () => {
    // `verified_by` is a display name. Two operators may pick the same one, and a hostile
    // client may pick yours on purpose. `by` comes off an event whose signature was verified.
    const out = exportContribution({
      ...base,
      corrections: [correction(SOMEBODY_ELSE, { verified_by: 'Wren', record: 'st-louis-impostor' })]
    });
    expect(out).not.toContain('st-louis-impostor');
    expect(out).toContain('nothing yet');
  });

  it('carries no coordinates and no street address', () => {
    // The patrol export has never carried a coordinate, and a list of doorways one operator
    // stood at is a pattern about them even when each address is public on its own.
    const out = exportContribution(base);
    expect(out).not.toMatch(/\d+\.\d{4,}/);
    expect(out).not.toContain('412 Cherokee St');
  });

  it('names nobody but the operator', () => {
    // C22. Your movements are yours to publish; Raven's are not, and Raven agreed to nothing.
    const out = exportContribution({ ...base, patrols: [night({ closedBy: 'Raven' })] });
    expect(out).not.toContain('Raven');
  });

  it('says what it does not contain, in the artifact rather than only in the app', () => {
    expect(exportContribution(base)).toContain('Nothing here is about anybody who was helped');
  });

  it('leaves the notes out unless asked, like the patrol export', () => {
    const withNote = { ...base, patrols: [night({ note: 'two handouts at the underpass' })] };
    expect(exportContribution({ ...withNote, includeNotes: false })).not.toContain('underpass');
    expect(exportContribution({ ...withNote, includeNotes: true })).toContain('underpass');
  });

  it('can leave the contributed half out entirely', () => {
    const out = exportContribution({ ...base, includeContributions: false });
    expect(out).toContain('Downtown');
    expect(out).not.toContain('Corrected');
    expect(out).not.toContain('The Bridge Drop-in');
  });

  it('reads sensibly for somebody who has done none of it yet', () => {
    const out = exportContribution({
      callsign: null,
      mine: ME,
      patrols: [],
      corrections: [],
      places: []
    });
    expect(out).toContain('Contribution');
    expect(out).toContain('none recorded');
    expect(out).toContain('nothing yet');
    expect(out).not.toContain('null');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('NaN');
  });
});
