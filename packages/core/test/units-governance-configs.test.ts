import { describe, expect, it } from 'vitest';
import { ROOMS, addMonthsUTC, thresholdOf, type Governance, type Template } from '../src/units/charter.js';
import { DAY, T0, makeUnit, names } from './helpers/units.js';

/**
 * One story, run under every Led configuration and under Any two (governance §2.6 asks for every
 * configuration). The expected offices and thresholds are computed from the configuration, never
 * written down per case.
 *
 * found → admit to room → term end → elect CO and XO → day-31 petition → recall → succession →
 * vacancy election → leader-key removal.
 */

const LED_CONFIGS: Extract<Governance, { shape: 'led' }>[] = [];
for (const threshold of ['majority', 'twoThirds'] as const)
  for (const term of [12, 24] as const)
    for (const coCap of ['none', 'twoThenOut'] as const) LED_CONFIGS.push({ shape: 'led', threshold, term, coCap });

describe.each(LED_CONFIGS.map((g, i) => ({
  g, template: (i % 2 === 0 ? 'military' : 'plain') as Template, room: ROOMS[i % ROOMS.length]!,
  label: `${g.threshold}, ${g.term} months, cap ${g.coCap}, room ${ROOMS[i % ROOMS.length]}`
})))('Led: $label', ({ g, template, room }) => {
  it('runs the whole story, and every office lands where the configuration says', () => {
    const u = makeUnit({ governance: g, template, room });
    const others = names(room - 2);
    u.fill(others, ['co', 'xo'], T0 + 3600);
    const everyone = ['co', 'xo', ...others];
    expect(u.members()).toEqual([...everyone].sort());

    // Room is never passed.
    expect(u.voidReason(u.admit('extra', ['co', 'xo'], T0 + 2 * DAY).id)).toBe('room-full');

    // The founders hold term one, and hold over past its end.
    const te = addMonthsUTC(T0, g.term);
    expect(u.view().offices!.co.term).toEqual({ n: 1, start: T0, end: te });
    expect(u.voidReason(u.open('m1', 'co', te - 1).id)).toBe('not-electable');
    expect(u.offices(te + 400 * DAY)).toMatchObject({ co: 'co', xo: 'xo' });

    // Elect a CO and re-elect the XO, each by exactly the threshold of the whole roster.
    const k = thresholdOf(room, g.threshold);
    const voters = everyone.slice(0, k);
    u.elect({ office: 'co', opener: 'm1', candidate: 'm1', voters, at: te });
    u.elect({ office: 'xo', opener: 'm2', candidate: 'xo', voters, at: te + DAY });
    let v = u.view();
    expect(u.offices()).toEqual({ co: 'm1', xo: 'xo', coActing: false, xoActing: false });
    expect(v.offices!.co.term!.n).toBe(2);
    expect(v.offices!.co.term!.end).toBe(addMonthsUTC(v.offices!.co.term!.start, g.term));
    expect(v.offices!.co.capped).toBe(false);

    // A petition against the new CO waits for day 31 of their term, then passes at the threshold of
    // the electorate frozen when it opened: everyone but the CO.
    const start = v.offices!.co.term!.start;
    expect(u.voidReason(u.petition('m2', 'co', 'm1', start + 29 * DAY).id)).toBe('too-early');
    const p = u.petition('m2', 'co', 'm1', start + 31 * DAY);
    const kr = thresholdOf(room - 1, g.threshold);
    const supporters = everyone.filter((n) => n !== 'm1' && n !== 'm2').slice(0, kr - 1);
    u.support(supporters, p.id, start + 32 * DAY);
    v = u.view();
    expect(v.petitions[0]).toMatchObject({ m: room - 1, k: kr, count: kr, postable: true });
    u.recall('m2', p.id, start + 33 * DAY);

    // The XO serves as CO for the rest of the term; the XO post is vacant.
    expect(u.offices()).toEqual({ co: 'xo', xo: null, coActing: false, xoActing: false });
    expect(u.view().offices!.co.term!.start).toBe(start);
    expect(u.members()).toContain('m1');

    // A vacancy election fills the XO post for the remainder of its term.
    const xoTerm = u.view().offices!.xo.term!;
    u.elect({ office: 'xo', opener: 'm2', candidate: 'co', voters: everyone.slice(0, k), at: start + 34 * DAY });
    expect(u.offices()).toEqual({ co: 'xo', xo: 'co', coActing: false, xoActing: false });
    expect(u.view().offices!.xo.term).toEqual(xoTerm);

    // The recalled CO may not co-sign removing anyone who signed the petition, for the rest of the term.
    if (supporters.includes('xo')) {
      expect(u.voidReason(u.remove(['xo'], ['m1', 'm3'], start + 39 * DAY).id)).toBe('recalled-signer');
    }

    // The CO's key is removed by two members other than the CO: the XO acts as CO.
    u.remove(['xo'], ['m2', room === 4 ? 'co' : 'm3'], start + 40 * DAY);
    expect(u.offices()).toEqual({ co: 'co', xo: null, coActing: true, xoActing: false });
    expect(u.members()).not.toContain('xo');
    expect(u.view().checkpointDue).toBe(true);
    expect(u.view().status).toBe('ok');
  });
});

describe('Any two', () => {
  it.each(ROOMS.map((room) => ({ room })))('room $room: no offices, any two at the door', ({ room }) => {
    const u = makeUnit({ governance: { shape: 'anyTwo' }, room });
    const others = names(room - 2);
    u.fill(others, ['a', 'b'], T0 + 3600);
    expect(u.members()).toEqual(['a', 'b', ...others].sort());
    expect(u.view().offices).toBeNull();
    expect(u.voidReason(u.open('a', 'co', addMonthsUTC(T0, 12)).id)).toBe('no-offices');
    expect(u.voidReason(u.petition('m1', 'co', 'a', T0 + 40 * DAY).id)).toBe('no-offices');
    expect(u.voidReason(u.vacate('a', 'co', T0 + 41 * DAY).id)).toBe('no-offices');
    // Any two members other than the one removed.
    u.remove(['a'], ['b', 'm1'], T0 + 42 * DAY);
    expect(u.members()).not.toContain('a');
    // Down to two, either removes the other.
    const rest = u.members().filter((n) => n !== 'b');
    for (const [i, n] of rest.slice(0, -1).entries()) u.remove([n], ['b', rest[rest.length - 1]!], T0 + 43 * DAY + i);
    const last = rest[rest.length - 1]!;
    u.remove([last], ['b'], T0 + 50 * DAY);
    expect(u.members()).toEqual(['b']);
    expect(u.view().status).toBe('ok');
  });
});
