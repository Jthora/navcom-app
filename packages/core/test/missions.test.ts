import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { MISSION_PACKAGE_KIND, MISSION_PUBLISHERS, missionActive, missionExpired, readMissionPackage, type Mission } from '../src/index.js';
import { oneKey } from './helpers/registry.js';

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
const TEST = oneKey(getPublicKey(secret), 'Test publisher', false);
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
    expect(m.publisher).toEqual({ pubkey: HEAT.pubkey, name: 'Mecha Jono', agent: true, entry: 'mecha-jono', generation: 1 });
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
    expect(readMissionPackage(HEAT, [])).toMatchObject({ ok: false, kind: 'refused', because: expect.stringMatching(/publisher/) });
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
  it('coarsens a coordinate to the precision it declares', () => {
    const fine = ok(pkg([['geo', 'lat:39.37226,lon:-104.85868'], ['geo_precision', '1km'], ['geo_kind', 'subject_location']]), TEST);
    expect(fine.placement.point).toEqual({ lat: 39.37, lon: -104.86, precision: '1km', kind: 'subject_location', coarsened: true });
    const city = ok(pkg([['geo', 'lat:39.37226,lon:-104.85868'], ['geo_precision', 'city'], ['geo_kind', 'jurisdiction']]), TEST);
    expect(city.placement.point).toMatchObject({ lat: 39.4, lon: -104.9, precision: 'city', kind: 'jurisdiction' });
    const undeclared = ok(pkg([['geo', 'lat:39.37,lon:-104.86'], ['geo_kind', 'subject_location']]), TEST);
    expect(undeclared.placement.point).toMatchObject({ precision: '1km', coarsened: true });
  });

  it('keeps a subject on public record at the address precision it declares: five places [rev 8, §4.2]', () => {
    const facility = ok(pkg([['geo', 'lat:39.37226,lon:-104.85868'], ['geo_precision', 'address'], ['geo_kind', 'subject_location']]), TEST);
    expect(facility.placement.point).toEqual({ lat: 39.37226, lon: -104.85868, precision: 'address', kind: 'subject_location', coarsened: false });
  });

  it('flags anything finer than it declares as coarsened, at the address precision too', () => {
    const over = ok(pkg([['geo', 'lat:39.3722612,lon:-104.8586834'], ['geo_precision', 'address'], ['geo_kind', 'subject_location']]), TEST);
    expect(over.placement.point).toEqual({ lat: 39.37226, lon: -104.85868, precision: 'address', kind: 'subject_location', coarsened: true });
  });

  it('coarsens a point that stands for a jurisdiction to a city whatever it declares: a jurisdiction has no doorstep', () => {
    for (const declared of ['address', '1km']) {
      const m = ok(pkg([['geo', 'lat:39.37226,lon:-104.85868'], ['geo_precision', declared], ['geo_kind', 'jurisdiction']]), TEST);
      expect(m.placement.point, declared).toEqual({ lat: 39.4, lon: -104.9, precision: 'city', kind: 'jurisdiction', coarsened: true });
    }
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

describe('what the second audit of Milestone 11 found', () => {
  const refusal = (input: unknown, publishers = TEST) => {
    const r = readMissionPackage(input, publishers);
    return r.ok ? null : r;
  };
  const objective = (extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'x', objectives: [{ id: 'do:it', ask: 'Do it.', ...extra }] });

  describe('time and state [invariants 7 and 9]', () => {
    it('reads a mission its poster closed early as over, though its end is still to come', () => {
      const closed = ok(pkg([['mission_state', 'closed']], { drop: ['mission_state'] }), TEST);
      const open = ok(pkg([]), TEST);
      const before = new Date('2026-10-06T12:00:00Z');
      expect(missionExpired(closed, before)).toBe(false);
      expect(missionActive(closed, before)).toBe(false);
      expect(missionActive(open, before)).toBe(true);
    });

    it('is current through the last second of its end, and expired the second after', () => {
      const m = ok(pkg([]), TEST);
      expect(missionExpired(m, new Date(m.validUntil * 1000))).toBe(false);
      expect(missionActive(m, new Date(m.validUntil * 1000))).toBe(true);
      expect(missionExpired(m, new Date((m.validUntil + 1) * 1000))).toBe(true);
    });

    it('refuses an end of zero, an end that is not a whole second, and an end past 2100 — and takes 2100 itself', () => {
      for (const end of ['0', '1791608400.5']) {
        expect(refusal(pkg([['valid_until', end]], { drop: ['valid_until'] }))?.because, end).toMatch(/when it ends/);
      }
      expect(refusal(pkg([['valid_until', '4102444801']], { drop: ['valid_until'] }))?.because).toMatch(/not a date/);
      expect(ok(pkg([['valid_until', '4102444800']], { drop: ['valid_until'] }), TEST).validUntil).toBe(4_102_444_800);
    });
  });

  it('names a registered agent as an agent though its package does not say so [invariant 4]', () => {
    const AGENT = oneKey(getPublicKey(secret), 'Registered agent', true);
    const m = ok(pkg([]), AGENT);
    expect(pkg([]).tags.some((t) => t[0] === 'agent')).toBe(false);
    expect(m.publisher).toEqual({ pubkey: getPublicKey(secret), name: 'Registered agent', agent: true, entry: 'registered-agent', generation: 1 });
  });

  it('refuses a reference to any of the five Distress kinds, and to none beside them [invariant 2]', () => {
    for (const k of ['20910', '20911', '20912', '20913', '20914']) {
      expect(refusal(pkg([['k', k]]))?.because, k).toMatch(/Distress/);
    }
    for (const k of ['20909', '20915', '1985']) expect(ok(pkg([['k', k]]), TEST).address, k).toBeTruthy();
  });

  it('drops a count of people under every word the reader names for them', () => {
    const words = [
      'People', 'Person', 'Persons', 'Individual', 'Individuals', 'Residents', 'Clients', 'Guests',
      // Added 2026-10-07: the phrasings a count of people actually arrived in [audit 11.S, #56].
      'Households', 'Families', 'Children', 'Kids', 'Men', 'Women', 'Youth', 'Seniors', 'Neighbours', 'Neighbors', 'Folks', 'Unhoused'
    ];
    const effect = [...words.map((w) => `${w} reached: a count`), 'Water handed out: a count'];
    const content = JSON.stringify({ name: 'x', objectives: [{ id: 'do:it', ask: 'Do it.' }], metadata: { mechaJono: { format: { effect } } } });
    const m = ok(pkg([], { content }), TEST);
    expect(m.effect).toEqual(['Water handed out: a count']);
    expect(m.omittedPeopleCounts).toBe(words.length);
  });

  it('keeps what an operator reads before going: the topics to check, and limits written as one line', () => {
    const m = ok(pkg([['check', 'local laws on recording consent'], ['check', 'heat advisories']], { content: objective({ limits: 'Never enter private property.' }) }), TEST);
    expect(m.checks).toEqual(['local laws on recording consent', 'heat advisories']);
    expect(m.objectives[0]!.limits).toEqual(['Never enter private property.']);
  });

  describe('every other rule the package reader keeps', () => {
    it('says whose a refused version is only when it is a publisher NavCom reads', () => {
      const stranger = generateSecretKey();
      const e = finalizeEvent({ ...pkg([]), tags: pkg([]).tags, content: pkg([]).content, kind: MISSION_PACKAGE_KIND, created_at: 1791300000 }, stranger);
      const r = refusal(e);
      expect(r?.because).toMatch(/publisher/);
      expect(r?.from).toBeUndefined();
    });

    it('is not a package without the starcom_mission_package flag', () => {
      expect(refusal(pkg([], { drop: ['starcom_mission_package'] }))?.kind).toBe('not-a-package');
    });

    it('refuses, rather than throws on, content that parses to nothing', () => {
      expect(() => readMissionPackage(pkg([], { content: 'null' }), TEST)).not.toThrow();
      expect(refusal(pkg([], { content: 'null' }))?.because).toMatch(/manifest/);
    });

    it('drops an objective with no id, so a package whose only objective has none is refused', () => {
      const one = JSON.stringify({ name: 'x', objectives: [{ ask: 'No id.' }] });
      expect(refusal(pkg([], { content: one }))?.because).toMatch(/at least one objective/);
      const two = JSON.stringify({ name: 'x', objectives: [{ ask: 'No id.' }, { id: 'do:it', ask: 'Do it.' }] });
      expect(ok(pkg([], { content: two }), TEST).objectives.map((o) => o.id)).toEqual(['do:it']);
    });

    it('says a coordinate was coarsened only when it was', () => {
      const exact = ok(pkg([['geo', 'lat:39.37,lon:-104.86'], ['geo_precision', '1km'], ['geo_kind', 'subject_location']]), TEST);
      expect(exact.placement.point).toEqual({ lat: 39.37, lon: -104.86, precision: '1km', kind: 'subject_location', coarsened: false });
    });

    it('reads a jurisdiction in capitals as the same place', () => {
      expect(ok(pkg([['jurisdiction', 'US-CA']], { drop: ['jurisdiction'] }), TEST).placement.jurisdiction).toBe('us-ca');
    });

    it('refuses a package whose tags carry anything but strings, saying so, before anything else is asked', () => {
      const raw = JSON.parse(JSON.stringify(pkg([])));
      raw.tags.push(['priority', 7]);
      expect(() => readMissionPackage(raw, TEST)).not.toThrow();
      expect(refusal(raw)).toMatchObject({ kind: 'not-a-package', because: expect.stringMatching(/lists of strings/) });
    });
  });

  /*
   * Mecha Jono's desk packages carry the country and then the state. A field package written the
   * same way was filed by the first tag alone — the whole country, not the state it is about.
   */
  describe('a package that names more than one jurisdiction', () => {
    const two = (...codes: string[]) => ok(pkg(codes.map((c) => ['jurisdiction', c]), { drop: ['jurisdiction'] }), TEST).placement.jurisdiction;

    it('is filed by the most specific, whichever order they come in', () => {
      expect(two('us', 'us-co')).toBe('us-co');
      expect(two('us-co', 'us')).toBe('us-co');
      expect(two('us', 'us')).toBe('us');
    });

    it('is filed nowhere rather than guessed when they disagree, and is still a mission', () => {
      expect(two('us-co', 'us-ca')).toBeNull();
      expect(two('us', 'gb')).toBeNull();
      expect(two('gb', 'us-co')).toBeNull();
    });

    it('skips a code it cannot read rather than letting it hide one it can', () => {
      expect(two('not a code', 'us-co')).toBe('us-co');
    });
  });
});

describe('who NavCom reads packages from', () => {
  /*
   * The registry is the trust root for every mission on the map: a key here is believed to be its
   * publisher, so it is pinned exactly. Decided 2026-10-18 [interchange spec rev 7]: Mecha Jono's old
   * key, whose secret was exposed on 2026-09-28, is frozen and ends on 13 November; its next key is
   * listed with no start, so nothing it signs is trusted until a later release names the cut-over.
   *
   * It pins where sealed claims and reports go, too (since 2026-10-17): the inbox read from a
   * kind-10050 list was the newest by a date the signer writes, and the exposed key can sign one
   * dated next year [interchange spec §5.0].
   */
  it('is one entry, Mecha Jono, an agent, with its inbox pinned, its old key frozen to 13 November, and its next key not yet trusted to sign', () => {
    expect(MISSION_PUBLISHERS).toEqual([
      {
        id: 'mecha-jono',
        name: 'Mecha Jono',
        agent: true,
        inbox: ['wss://nos.lol', 'wss://relay.primal.net'],
        keys: [
          {
            pubkey: '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692',
            generation: 1,
            notBefore: '2025-01-01T00:00:00Z',
            notAfter: '2026-11-13T00:00:00Z',
            exposed: '2026-09-28',
            frozen: { sha256: 'f225840937640ab8dd7e4e331e104c2a67a63fe9f885f38b85a096dd523e9a76', confirmed: false }
          },
          { pubkey: '86f824c3f1e67c60b1dc15ce110648c4de5c3fb879022fbbcc5e8deb720e402c', generation: 2, notAfter: '2027-10-18T00:00:00Z' }
        ],
        next: null
      }
    ]);
  });

  it('reads a package the old key signed as Mecha Jono’s, generation 1, retiring and unconfirmed — at its jurisdiction only', () => {
    const r = readMissionPackage(HEAT);
    if (!r.ok) throw new Error(r.because);
    expect(r.mission.publisher).toEqual({ pubkey: HEAT.pubkey, name: 'Mecha Jono', agent: true, entry: 'mecha-jono', generation: 1 });
    expect(r.mission.retiring).toBe('unconfirmed');
  });

  it('drops a point an unconfirmed retiring package carries, and keeps it once the list is confirmed', () => {
    const frozen = (confirmed: boolean) =>
      oneKey(getPublicKey(secret), 'Test publisher', false, {
        keys: [{ pubkey: getPublicKey(secret), generation: 1, notBefore: '2020-01-01T00:00:00Z', notAfter: '2100-01-01T00:00:00Z', exposed: '2026-09-28', frozen: { sha256: 'x', confirmed } }]
      });
    const placed = pkg([['geo', 'lat:36.77,lon:-119.41'], ['geo_kind', 'subject_location'], ['geo_precision', '1km']]);
    expect(ok(placed, frozen(false)).placement).toEqual({ jurisdiction: 'us-ca', point: null });
    expect(ok(placed, frozen(true)).placement.point).toMatchObject({ lat: 36.77, lon: -119.41 });
    expect(ok(placed, frozen(true)).retiring).toBe('confirmed');
    expect(ok(placed, TEST).retiring).toBeNull();
  });

  /*
   * Decided 2026-10-18 (3b): Mecha Jono signs nothing with its next key before the cut-over, so
   * anything under it before then is a thief's. It is read as no publisher's: it carries nothing that
   * could hide a genuine version, whatever it says.
   */
  it('reads nothing a key with no start signed, nor anything dated before its key’s start, as anybody’s', () => {
    const noStart = oneKey(getPublicKey(secret), 'Test publisher', false, {
      keys: [{ pubkey: getPublicKey(secret), generation: 2, notAfter: '2100-01-01T00:00:00Z' }]
    });
    const r = readMissionPackage(pkg([]), noStart);
    expect(r).toMatchObject({ ok: false, kind: 'refused', because: 'Signed by a key NavCom does not trust to sign yet.' });
    expect((r as { from?: unknown }).from).toBeUndefined();

    const later = oneKey(getPublicKey(secret), 'Test publisher', false, {
      keys: [{ pubkey: getPublicKey(secret), generation: 2, notBefore: '2026-10-07T00:00:00Z', notAfter: '2100-01-01T00:00:00Z' }]
    });
    // pkg() is dated 1791300000, 2026-10-06T15:20:00Z: before this key's start.
    const early = readMissionPackage(pkg([]), later);
    expect(early).toMatchObject({ ok: false, kind: 'refused', because: 'Dated before NavCom trusted the key that signed it.' });
    expect((early as { from?: unknown }).from).toBeUndefined();
  });
});
