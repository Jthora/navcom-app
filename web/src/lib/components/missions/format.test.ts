import { describe, expect, it } from 'vitest';
import type { Settlement } from '@navcom/core';
import { alreadyReported, effort, endsIn, endsSoon, placeName, releaseReadout, stampUtc, standingOf } from './format';

const NOW = Date.UTC(2026, 9, 6, 20, 0, 0);
const at = (hoursFromNow: number) => Math.floor(NOW / 1000) + hoursFromNow * 3600;

describe('how a mission’s place and end read', () => {
  it('names a US state from the package’s own code, and leaves anything else as its code', () => {
    expect(placeName('us-ca')).toBe('California');
    expect(placeName('us-dc')).toBe('Washington, DC');
    expect(placeName('us')).toBe('United States');
    // Not a guess: a code it does not know reads as that code.
    expect(placeName('gb-eng')).toBe('GB-ENG');
    expect(placeName(null)).toBe('—');
  });

  it('says how long is left in the largest whole unit, and says when it has ended', () => {
    expect(endsIn(at(24 * 3 + 5), NOW)).toBe('3 days');
    expect(endsIn(at(30), NOW)).toBe('30 hours');
    expect(endsIn(at(1.5), NOW)).toBe('1 hour');
    expect(endsIn(at(0.25), NOW)).toBe('15 min');
    expect(endsIn(at(-1), NOW)).toBe('Ended');
  });

  it('marks under a day as soon, and nothing that has ended', () => {
    expect(endsSoon(at(5), NOW)).toBe(true);
    expect(endsSoon(at(30), NOW)).toBe(false);
    expect(endsSoon(at(-1), NOW)).toBe(false);
  });

  it('stamps an end the way Mecha Jono’s own clock lines read', () => {
    expect(stampUtc(1791608400)).toBe('10 Oct, 05:00 UTC');
  });

  it('reads a time no calendar can draw as unknown, and turns from hours to days at exactly two days [audit 11, second grid]', () => {
    expect(stampUtc(NaN)).toBe('—');
    expect(stampUtc(1e20)).toBe('—');
    expect(endsIn(at(48), NOW)).toBe('2 days');
    expect(endsIn(at(48) - 1, NOW)).toBe('47 hours');
    expect(endsIn(at(0), NOW)).toBe('Ended');
    expect(endsIn(at(0) + 1, NOW)).toBe('1 min');
  });

  it('reads effort as an estimate, and says nothing when there is none', () => {
    expect(effort(20)).toBe('about 20 minutes');
    expect(effort(90)).toBe('about 1.5 hours');
    expect(effort(60)).toBe('about 1 hour');
    expect(effort(null)).toBeNull();
  });
});

describe('who settled or challenged a report', () => {
  /** Mecha Jono, as the publisher registry names it: an agent. */
  const MECHA = '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692';
  const wren = '7bf2d588'.padEnd(64, 'a');
  const desk = 'd0abf85c'.padEnd(64, 'b');

  it('names an agent as one wherever its key appears, with no card to read its name from [invariant 4]', () => {
    // Your missions reads names only from cards, and a poster has none: this read "6301c4d0" [audit 11.I].
    const byPoster: Settlement = { state: 'settled', how: 'poster', by: MECHA, at: 0, challengedBy: [wren] };
    expect(standingOf(byPoster, new Map()).sub).toBe('by the poster, Mecha Jono (6301c4d0, an agent) · challenged by 7bf2d588');
    // A challenge by one is marked too, and a name somebody else gave the key changes nothing.
    const challenged: Settlement = { state: 'pending', until: 1791608400, challengedBy: [MECHA] };
    expect(standingOf(challenged, new Map([[MECHA, 'Totally A Person']])).sub).toBe(
      'settles by itself 10 Oct, 05:00 UTC · challenged by Mecha Jono (6301c4d0, an agent)'
    );
  });

  it('marks a poster whose package declared itself an agent, and leaves a person a person', () => {
    const s: Settlement = { state: 'settled', how: 'poster', by: desk, at: 0, challengedBy: [] };
    expect(standingOf(s, new Map([[desk, 'Supply Desk']]), new Set([desk])).sub).toBe('by the poster, Supply Desk (d0abf85c, an agent)');
    expect(standingOf(s, new Map([[desk, 'Supply Desk']])).sub).toBe('by the poster, Supply Desk (d0abf85c)');
    expect(standingOf({ ...s, how: 'witness', by: wren }, new Map(), new Set([desk])).sub).toBe('by a witness, 7bf2d588');
  });
});

describe('what a screen says of a mission’s own loose ends [audit 11.S, findings 52 and 66 — review]', () => {
  it('calls a release unconfirmed only when it may have arrived, and says the claim stands when no relay has it', () => {
    const ends = at(23);
    const maybe = releaseReadout({ ends, mayHaveArrived: true }, NOW);
    expect(maybe.value).toBe('Release unconfirmed');
    expect(maybe.sub).toBe('no relay confirmed it; it may have arrived · the claim ends by itself in 23 hours');
    // No signal at all: nothing left the phone, so nothing may have arrived.
    const not = releaseReadout({ ends }, NOW);
    expect(not.value).toBe('Release not sent');
    expect(not.sub).not.toMatch(/may have arrived|unconfirmed/);
    expect(not.sub).toMatch(/claim stands/);
  });

  it('offers to withdraw a day’s report only when it can be withdrawn: never a sealed one', () => {
    expect(alreadyReported('open', 'Test Poster')).toMatch(/Withdraw that one/);
    const sealed = alreadyReported('sealed', 'Test Poster');
    expect(sealed).toMatch(/sealed to Test Poster/);
    expect(sealed).not.toMatch(/Withdraw that one/);
  });
});
