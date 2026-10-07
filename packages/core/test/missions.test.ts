import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { MISSION_PACKAGE_KIND, missionActive, missionExpired, readMissionPackage, type Mission } from '../src/index.js';

/**
 * Real packages, captured from The Record on 2026-10-06 and signed by Mecha Jono — so the
 * signature check runs against the key that actually publishes, not a stand-in.
 *
 *   [0] heat relief, California — open field campaign, carries the new `agent` tag, and still
 *       says "People reached" in what it counts
 *   [1] product recall check — a closed field mission, past its end
 *   [2] a desk package with a city-level coordinate — Starcom's, not for the grid
 */
const REAL = JSON.parse(readFileSync(new URL('./fixtures/mission-packages.json', import.meta.url), 'utf8'));
const [HEAT, RECALL, DESK] = REAL;

const ok = (input: unknown, publishers?: Parameters<typeof readMissionPackage>[1]): Mission => {
  const r = readMissionPackage(input, publishers);
  if (!r.ok) throw new Error(`expected a mission, got ${r.kind}: ${r.because}`);
  return r.mission;
};

/** A package signed by a throwaway key, so each refusal is tested on a validly signed event. */
const secret = generateSecretKey();
const TEST = { [getPublicKey(secret)]: { name: 'Test publisher', agent: false } };
function pkg(extra: string[][], over: { content?: string; drop?: string[] } = {}) {
  const base = [
    ['d', 'starcom_mission_package_test'],
    ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
    ['mission_state', 'open'], ['valid_until', '1791608400'], ['jurisdiction', 'us-ca']
  ].filter((t) => !(over.drop ?? []).includes(t[0] === 't' ? t[1]! : t[0]!));
  return finalizeEvent(
    {
      kind: MISSION_PACKAGE_KIND,
      created_at: 1791300000,
      tags: [...base, ...extra],
      content: over.content ?? JSON.stringify({ name: 'A test mission', objectives: [{ id: 'do:it', ask: 'Do it.' }] })
    },
    secret
  );
}

describe('a real field campaign', () => {
  const m = ok(HEAT);

  it('becomes a mission, identified as an agent’s', () => {
    expect(m.address).toBe(`30079:${HEAT.pubkey}:starcom_mission_package_field-heat_relief-CA-2026-10-02`);
    expect(m.publisher).toEqual({ pubkey: HEAT.pubkey, name: 'Mecha Jono', agent: true });
    expect(m.state).toBe('open');
    expect(m.validUntil).toBe(1791608400);
    expect(m.placement).toEqual({ jurisdiction: 'us-ca', point: null });
  });

  it('is a campaign nobody can lock, because it does not say otherwise', () => {
    expect(m.claims).toBe('many');
  });

  it('keeps every objective and its limits word for word', () => {
    expect(m.objectives.map((o) => o.id.split('#')[1])).toEqual([
      'find:centres', 'handout:water', 'check:neighbour', 'report:counts'
    ]);
    for (const o of m.objectives) {
      expect(o.limits.join(' ')).toContain("Never confront anyone, enter private property or take anyone's personal details.");
      expect(o.done).toBe(false);
    }
  });

  it('omits the count of people it says it measures, and says it did', () => {
    // "People reached with water and the cooling-centre list: a count." The ask itself already
    // says "what you handed out" — only this line counted people, and it is the one removed.
    expect(m.effect).toEqual([]);
    expect(m.omittedPeopleCounts).toBe(1);
  });
});

describe('time and state', () => {
  it('reads a closed mission as closed, and an ended one as ended', () => {
    const m = ok(pkg([['mission_state', 'closed'], ['valid_until', '1791200000']], { drop: ['mission_state', 'valid_until'] }), TEST);
    expect(m.state).toBe('closed');
    expect(missionExpired(m, new Date('2026-10-06T12:00:00Z'))).toBe(true);
    expect(missionActive(m, new Date('2026-10-06T12:00:00Z'))).toBe(false);
  });

  it('reads an open mission as active until it ends, and not after', () => {
    const m = ok(HEAT);
    expect(missionActive(m, new Date('2026-10-06T12:00:00Z'))).toBe(true);
    expect(missionActive(m, new Date((m.validUntil + 1) * 1000))).toBe(false);
  });
});

describe('what is not a mission', () => {
  it('leaves desk work to Starcom', () => {
    expect(readMissionPackage(DESK)).toMatchObject({ ok: false, kind: 'desk' });
  });

  it('refuses a package whose content was changed after signing', () => {
    const tampered = { ...HEAT, content: HEAT.content.replace('Bakersfield', 'Fresno') };
    expect(readMissionPackage(tampered)).toMatchObject({ ok: false, kind: 'refused', because: expect.stringMatching(/signature/) });
  });

  it('refuses a real package from a publisher NavCom does not read', () => {
    expect(readMissionPackage(HEAT, {})).toMatchObject({ ok: false, kind: 'refused', because: expect.stringMatching(/publisher/) });
  });

  it('ignores what is not a package at all', () => {
    expect(readMissionPackage(null)).toMatchObject({ ok: false, kind: 'not-a-package' });
    expect(readMissionPackage({ ...HEAT, kind: 1 })).toMatchObject({ ok: false, kind: 'not-a-package' });
    expect(readMissionPackage(pkg([], { drop: ['navcom_handoff'] }), TEST)).toMatchObject({ ok: false, kind: 'not-a-package' });
  });
});

describe('the lines a package may not cross', () => {
  it('refuses a mission addressed to a person [invariant 8]', () => {
    const r = readMissionPackage(pkg([['p', 'a'.repeat(64)]]), TEST);
    expect(r).toMatchObject({ ok: false, kind: 'refused', because: expect.stringMatching(/assignment/) });
  });

  it('refuses one that reaches for Distress [invariant 2]', () => {
    expect(readMissionPackage(pkg([['k', '20911']]), TEST)).toMatchObject({ ok: false, kind: 'refused' });
  });

  it('refuses a field mission with no end [invariant 7]', () => {
    expect(readMissionPackage(pkg([], { drop: ['valid_until'] }), TEST)).toMatchObject({ ok: false, kind: 'refused' });
  });

  it('refuses a state nobody can trust [invariant 9]', () => {
    expect(readMissionPackage(pkg([['mission_state', 'pending']], { drop: ['mission_state'] }), TEST)).toMatchObject({ ok: false, kind: 'refused' });
    // `claimed` means something only on a task with one claimant.
    expect(readMissionPackage(pkg([['mission_state', 'claimed']], { drop: ['mission_state'] }), TEST)).toMatchObject({ ok: false, kind: 'refused' });
    expect(ok(pkg([['mission_state', 'claimed'], ['claims', 'one']], { drop: ['mission_state'] }), TEST).state).toBe('claimed');
  });

  it('refuses content that is not a manifest', () => {
    expect(readMissionPackage(pkg([], { content: 'not json' }), TEST)).toMatchObject({ ok: false, kind: 'refused' });
  });
});

describe('what it repairs instead, and records', () => {
  it('coarsens a coordinate to the precision it declares, and never finer than ~1 km', () => {
    const fine = ok(pkg([['geo', 'lat:39.37226,lon:-104.85868'], ['geo_precision', '1km'], ['geo_kind', 'subject_location']]), TEST);
    expect(fine.placement.point).toEqual({ lat: 39.37, lon: -104.86, precision: '1km', coarsened: true });
    const city = ok(pkg([['geo', 'lat:39.37226,lon:-104.85868'], ['geo_precision', 'city'], ['geo_kind', 'jurisdiction']]), TEST);
    expect(city.placement.point).toMatchObject({ lat: 39.4, lon: -104.9, precision: 'city' });
    const undeclared = ok(pkg([['geo', 'lat:39.37,lon:-104.86'], ['geo_kind', 'subject_location']]), TEST);
    expect(undeclared.placement.point).toMatchObject({ precision: '1km', coarsened: true });
  });

  it('drops a coordinate of a kind it does not understand, and keeps the mission', () => {
    const m = ok(pkg([['geo', 'lat:39.37,lon:-104.86'], ['geo_precision', '1km'], ['geo_kind', 'home']]), TEST);
    expect(m.placement).toEqual({ jurisdiction: 'us-ca', point: null });
  });

  it('keeps a mission with nowhere to draw it — a campaign across many places is still real', () => {
    const m = ok(pkg([], { drop: ['jurisdiction'] }), TEST);
    expect(m.placement).toEqual({ jurisdiction: null, point: null });
  });

  it('counts things and drops lines that count people', () => {
    const content = JSON.stringify({ name: 'x', objectives: [{ id: 'do:it', ask: 'Do it.' }], metadata: { mechaJono: { format: { effect: ['Water and cards handed out: a count', 'Individuals helped: a count'] } } } });
    const m = ok(pkg([], { content }), TEST);
    expect(m.effect).toEqual(['Water and cards handed out: a count']);
    expect(m.omittedPeopleCounts).toBe(1);
  });

  it('names an agent as an agent when it says so, even off the registry', () => {
    expect(ok(pkg([['agent', 'test_agent']]), TEST).publisher.agent).toBe(true);
    expect(ok(pkg([]), TEST).publisher.agent).toBe(false);
  });
});

describe('who is taking part, as the poster counts them', () => {
  it('reads operators and agents apart, from the poster’s own tag', () => {
    expect(ok(pkg([['taking_part', '3', '1']]), TEST).takingPart).toEqual({ operators: 3, agents: 1 });
    expect(ok(pkg([['taking_part', '2']]), TEST).takingPart).toEqual({ operators: 2, agents: 0 });
  });

  it('is unknown when the poster has not said, or said something that is not a count', () => {
    expect(ok(pkg([]), TEST).takingPart).toBeNull();
    expect(ok(pkg([['taking_part', 'many']]), TEST).takingPart).toBeNull();
    expect(ok(pkg([['taking_part', '-1', '0']]), TEST).takingPart).toBeNull();
    expect(ok(pkg([['taking_part', '1.5', '0']]), TEST).takingPart).toBeNull();
  });
});

describe('what a report will be held to, checked when the package is read', () => {
  const content = (objectives: unknown[], effect: string[] = []) =>
    JSON.stringify({ name: 'x', objectives, metadata: { mechaJono: { format: { effect } } } });
  const refused = (input: unknown) => {
    const r = readMissionPackage(input, TEST);
    return r.ok ? null : r.because;
  };

  it('refuses a field mission with nothing to do, like the real recall check whose asks sit in its metadata', () => {
    const real = readMissionPackage(RECALL);
    expect(!real.ok && real.because).toMatch(/at least one objective/);
    expect(refused(pkg([], { content: content([]) }))).toMatch(/at least one objective/);
  });

  it('refuses objectives a report could not name, or could not tell apart', () => {
    expect(refused(pkg([], { content: content([{ id: 'a b', ask: 'x' }]) }))).toMatch(/report could name/);
    expect(refused(pkg([], { content: content([{ id: 'a', ask: 'x' }, { id: 'a', ask: 'y' }]) }))).toMatch(/share an id/);
  });

  it('refuses a line too long to count, and reads a repeated or blank line once or not at all', () => {
    expect(refused(pkg([], { content: content([{ id: 'a', ask: 'x' }], ['x'.repeat(201)]) }))).toMatch(/longer than a count/);
    const m = ok(pkg([], { content: content([{ id: 'a', ask: 'x' }], ['Water: a count', 'Water: a count', '  ']) }), TEST);
    expect(m.effect).toEqual(['Water: a count']);
  });

  it('refuses an end no calendar can draw', () => {
    expect(refused(pkg([['valid_until', '1000000000000000']], { drop: ['valid_until'] }))).toMatch(/not a date/);
  });

  it('refuses a d tag a claim could not name', () => {
    expect(refused(pkg([['d', 'has a space']], { drop: ['d'] }))).toMatch(/d tag/);
  });

  it('a version genuinely the publisher’s says whose it is even when refused; a forged one does not', () => {
    const r = readMissionPackage(pkg([], { content: content([]) }), TEST);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.from?.address).toBe(`${MISSION_PACKAGE_KIND}:${getPublicKey(secret)}:starcom_mission_package_test`);
    const forged = { ...pkg([], { content: content([]) }), sig: '0'.repeat(128) };
    const f = readMissionPackage(JSON.parse(JSON.stringify(forged)), TEST);
    expect(!f.ok && f.from).toBeUndefined();
  });

  it('survives tags that are not lists, refusing rather than throwing', () => {
    const poison = { kind: MISSION_PACKAGE_KIND, pubkey: '', id: 'x', created_at: 0, tags: [null, 'x', 7, ['t']], content: '', sig: '' };
    expect(() => readMissionPackage(poison, TEST)).not.toThrow();
    expect(readMissionPackage(poison, TEST).ok).toBe(false);
  });
});
