import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  FROZEN_SETS,
  MISSION_PUBLISHERS,
  frozenDigest,
  frozenSetOf,
  gate,
  keptMissionTrusted,
  labelHeard,
  outranks,
  rankOf,
  sealTargetOf,
  settlementOf,
  settlersOf,
  slotOf,
  trustClock,
  trustedToSign,
  type FrozenSet,
  type MissionPublishers,
  type PublisherKey
} from '../src/index.js';
import { trusted } from './helpers/registry.js';

/**
 * The registry gate and the rules beside it [missions/trust.ts; interchange spec rev 7], each a
 * decision of 2026-10-18 about Mecha Jono's exposed key.
 */

const [HEAT, RECALL] = JSON.parse(readFileSync(new URL('./fixtures/mission-packages.json', import.meta.url), 'utf8'));
const MECHA_OLD = '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692';
const MECHA_NEXT = '86f824c3f1e67c60b1dc15ce110648c4de5c3fb879022fbbcc5e8deb720e402c';
const secs = (iso: string) => Date.parse(iso) / 1000;
const OCT_18 = secs('2026-10-18T12:00:00Z');

const one = generateSecretKey();
const two = generateSecretKey();
const pkg = (secret: Uint8Array, d: string, at: number, state = 'open') =>
  finalizeEvent(
    {
      kind: 30079,
      created_at: at,
      content: JSON.stringify({ name: d, objectives: [{ id: 'do:it', ask: 'Do it.' }] }),
      tags: [['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'], ['mission_state', state], ['valid_until', String(at + 86_400 * 30)]]
    },
    secret
  );

const registry = (keys: PublisherKey[]): MissionPublishers => [{ id: 'desk', name: 'Desk', agent: true, inbox: ['wss://inbox.test'], keys, next: null }];

describe('the clock trust is judged on', () => {
  it('is the device’s, or the build’s when the device reads earlier', () => {
    expect(trustClock(Date.parse('2026-10-20T00:00:00Z'), '2026-10-18T00:00:00Z')).toBe(secs('2026-10-20T00:00:00Z'));
    expect(trustClock(Date.parse('2026-09-01T00:00:00Z'), '2026-10-18T00:00:00Z')).toBe(secs('2026-10-18T00:00:00Z'));
    expect(trustClock(Date.parse('2026-09-01T00:00:00Z'), null)).toBe(secs('2026-09-01T00:00:00Z'));
  });

  it('trusts a key from its start until its end, and a key with no start never', () => {
    const k = trusted('a'.repeat(64), { notBefore: '2026-10-01T00:00:00Z', notAfter: '2026-11-01T00:00:00Z' });
    expect(trustedToSign(k, secs('2026-09-30T23:59:59Z'))).toBe(false);
    expect(trustedToSign(k, secs('2026-10-01T00:00:00Z'))).toBe(true);
    expect(trustedToSign(k, secs('2026-11-01T00:00:00Z'))).toBe(false);
    expect(trustedToSign({ pubkey: 'a'.repeat(64), generation: 2, notAfter: '2100-01-01T00:00:00Z' }, OCT_18)).toBe(false);
  });
});

describe('the registry gate, asked before anything is kept', () => {
  const r = registry([trusted(getPublicKey(one)), trusted(getPublicKey(two), { generation: 2, notBefore: '2026-10-10T00:00:00Z' })]);

  it('keeps a trusted key’s package, and drops a key it does not read', () => {
    expect(gate(pkg(one, 'a', OCT_18 - 60), r, OCT_18)).toBeNull();
    expect(gate(pkg(generateSecretKey(), 'a', OCT_18 - 60), r, OCT_18)).toBe('unknown');
  });

  it('drops what a key signed before its start, even once the start has passed', () => {
    expect(gate(pkg(two, 'a', secs('2026-10-09T00:00:00Z')), r, OCT_18)).toBe('early');
    expect(gate(pkg(two, 'a', secs('2026-10-11T00:00:00Z')), r, OCT_18)).toBeNull();
  });

  it('drops a version dated more than a day past the clock, rather than flagging it', () => {
    expect(gate(pkg(one, 'a', OCT_18 + 86_400), r, OCT_18)).toBeNull();
    expect(gate(pkg(one, 'a', OCT_18 + 86_401), r, OCT_18)).toBe('future');
  });

  it('drops everything under a key whose end has passed on the floored clock, whatever date it carries', () => {
    const ended = registry([trusted(getPublicKey(one), { notAfter: '2026-10-15T00:00:00Z' })]);
    const before = pkg(one, 'a', secs('2026-10-01T00:00:00Z'));
    // The phone says 1 October; the build says 18 October. The floor wins.
    expect(gate(before, ended, trustClock(Date.parse('2026-10-01T12:00:00Z'), '2026-10-18T00:00:00Z'))).toBe('window');
  });

  it('drops anything under Mecha Jono’s next key today: it has no start', () => {
    const forged = { ...pkg(one, 'starcom_mission_package_field-heat_relief-CA-2026-10-02', OCT_18), pubkey: MECHA_NEXT };
    expect(gate(forged, MISSION_PUBLISHERS, OCT_18)).toBe('untrusted');
  });

  describe('a frozen key', () => {
    const key = getPublicKey(one);
    const listed = pkg(one, 'listed', secs('2026-10-05T00:00:00Z'));
    const set: FrozenSet = { key, taken: '2026-10-18', source: 'a test', packages: [{ id: listed.id, d: 'listed' }] };
    const frozen = (sha256 = frozenDigest(set)) => registry([trusted(key, { exposed: '2026-09-28', frozen: { sha256, confirmed: false } })]);

    it('keeps what is on its list', () => {
      expect(gate(listed, frozen(), OCT_18, [set])).toBeNull();
    });

    it('keeps a version not on the list only when it closes one of the list’s missions', () => {
      expect(gate(pkg(one, 'listed', secs('2026-10-06T00:00:00Z'), 'closed'), frozen(), OCT_18, [set])).toBeNull();
      expect(gate(pkg(one, 'listed', secs('2026-10-06T00:00:00Z'), 'open'), frozen(), OCT_18, [set])).toBe('frozen');
      expect(gate(pkg(one, 'elsewhere', secs('2026-10-06T00:00:00Z'), 'closed'), frozen(), OCT_18, [set])).toBe('frozen');
    });

    it('drops 150 packages dated ahead at fresh d’s, whatever else they say', () => {
      const flood = Array.from({ length: 150 }, (_, i) => pkg(one, `flood-${i}`, OCT_18 + 3_600 + i));
      expect(flood.map((e) => gate(e, frozen(), OCT_18, [set]))).toEqual(Array(150).fill('frozen'));
    });

    it('keeps nothing under it when no list for it is on hand', () => {
      expect(frozenSetOf(frozen().at(0)!.keys[0]!, [])).toBeNull();
      expect(gate(listed, frozen(), OCT_18, [])).toBe('unpinned');
      expect(frozenSetOf(frozen().at(0)!.keys[0]!, [set])).not.toBeNull();
    });
  });

  it('holds Mecha Jono’s old key to the list this release pins, which matches its digest', () => {
    const old = MISSION_PUBLISHERS[0]!.keys[0]!;
    expect(old.pubkey).toBe(MECHA_OLD);
    const list = frozenSetOf(old);
    expect(list).not.toBeNull();
    expect(frozenDigest(FROZEN_SETS[0]!)).toBe(old.frozen!.sha256);
    // The pinned set holds the newest version of each mission as read on 2026-10-18. The heat
    // campaign's d is on it, but this copy, captured on 6 October, was superseded since: a version
    // of a listed mission that is not itself on the list is not kept.
    const dOf = (e: { tags: string[][] }) => e.tags.find((t) => t[0] === 'd')![1]!;
    expect(list!.ds.has(dOf(HEAT))).toBe(true);
    expect(list!.ids.has(HEAT.id)).toBe(false);
    expect(gate(HEAT, MISSION_PUBLISHERS, OCT_18)).toBe('frozen');
    // Named on a list, the same copy stands; and on 13 November it ends whatever list it is on.
    const asCaptured = { ...FROZEN_SETS[0]!, packages: [HEAT, RECALL].map((e) => ({ id: e.id, d: dOf(e) })) };
    expect(gate(HEAT, MISSION_PUBLISHERS, OCT_18, [asCaptured])).toBeNull();
    expect(gate(RECALL, MISSION_PUBLISHERS, OCT_18, [asCaptured])).toBeNull();
    expect(gate(HEAT, MISSION_PUBLISHERS, secs('2026-11-13T00:00:00Z'), [asCaptured])).toBe('window');
  });
});

describe('ranking the versions of one mission', () => {
  const r = registry([trusted(getPublicKey(one)), trusted(getPublicKey(two), { generation: 2 })]);

  it('competes in one slot per publisher and d, across its keys', () => {
    expect(slotOf(pkg(one, 'x', OCT_18), r)).toBe(slotOf(pkg(two, 'x', OCT_18), r));
    expect(slotOf(pkg(one, 'x', OCT_18), r)).not.toBe(slotOf(pkg(one, 'y', OCT_18), r));
  });

  it('puts the higher generation first, whatever date the lower one carries', () => {
    const older = pkg(two, 'x', OCT_18 - 86_400);
    const later = pkg(one, 'x', OCT_18);
    expect(outranks(rankOf(older, r), rankOf(later, r))).toBe(true);
    expect(outranks(rankOf(later, r), rankOf(older, r))).toBe(false);
    // Within one generation, the newer, then the lower id.
    const a = pkg(one, 'x', OCT_18 - 10);
    expect(outranks(rankOf(later, r), rankOf(a, r))).toBe(true);
  });
});

describe('whose settled label counts', () => {
  it('none of Mecha Jono’s today: its old key is exposed and frozen, its next one not yet trusted', () => {
    expect([...settlersOf(MECHA_OLD, MISSION_PUBLISHERS, OCT_18)]).toEqual([]);
  });

  it('a settled signed by a key whose secret leaked leaves the report pending, and then it settles by silence', () => {
    const r = registry([trusted(getPublicKey(one), { exposed: '2026-09-28' })]);
    const report = { id: 'f'.repeat(64), author: 'c'.repeat(64), at: OCT_18 - 3_600 };
    const settled = finalizeEvent({ kind: 1985, created_at: OCT_18, content: '', tags: [['L', 'navcom.mission'], ['l', 'settled', 'navcom.mission'], ['e', report.id]] }, one);
    const settlers = settlersOf(getPublicKey(one), r, OCT_18);
    expect(settlementOf(report, settlers, [settled], OCT_18 + 60).state).toBe('pending');
    expect(settlementOf(report, settlers, [settled], report.at + 7 * 86_400)).toMatchObject({ state: 'settled', how: 'silence' });
    // The same label from a key not exposed settles it.
    const fine = registry([trusted(getPublicKey(one))]);
    expect(settlementOf(report, settlersOf(getPublicKey(one), fine, OCT_18), [settled], OCT_18 + 60)).toMatchObject({ state: 'settled', how: 'poster' });
  });

  it('a publisher’s trusted keys, and not one exposed', () => {
    const r = registry([trusted(getPublicKey(one), { exposed: '2026-09-28' }), trusted(getPublicKey(two), { generation: 2 })]);
    expect([...settlersOf(getPublicKey(one), r, OCT_18)]).toEqual([getPublicKey(two)]);
  });
});

describe('where something sealed goes', () => {
  it('nowhere for Mecha Jono today: its only key trusted to sign is exposed, so sealed sending is paused', () => {
    expect(sealTargetOf(MECHA_OLD, MISSION_PUBLISHERS, OCT_18)).toMatchObject({ ok: false, why: 'paused' });
    expect(sealTargetOf(MECHA_NEXT, MISSION_PUBLISHERS, OCT_18)).toMatchObject({ ok: false, why: 'paused' });
  });

  it('to the newest key trusted and not exposed, from its start, even for a mission the old key posted', () => {
    const r = registry([trusted(getPublicKey(one), { exposed: '2026-09-28' }), trusted(getPublicKey(two), { generation: 2, notBefore: '2026-11-02T00:00:00Z' })]);
    expect(sealTargetOf(getPublicKey(one), r, secs('2026-11-01T00:00:00Z'))).toMatchObject({ ok: false, why: 'paused' });
    expect(sealTargetOf(getPublicKey(one), r, secs('2026-11-03T00:00:00Z'))).toEqual({
      ok: true,
      entry: r[0],
      key: getPublicKey(two),
      inbox: ['wss://inbox.test'],
      since: secs('2026-11-02T00:00:00Z')
    });
  });

  it('nowhere when the release pins no inbox, or does not read the poster', () => {
    expect(sealTargetOf(getPublicKey(one), [{ ...registry([trusted(getPublicKey(one))])[0]!, inbox: [] }], OCT_18)).toMatchObject({ ok: false, why: 'no-inbox' });
    expect(sealTargetOf(getPublicKey(one), [], OCT_18)).toEqual({ ok: false, why: 'unknown' });
  });
});

describe('whose labels are read at all, any of the three words', () => {
  it('none from a listed key that is exposed, frozen or not trusted to sign; anybody else’s, as anybody’s', () => {
    const r = registry([
      trusted(getPublicKey(one), { exposed: '2026-09-28' }),
      trusted(getPublicKey(two), { generation: 2, notBefore: '2026-11-01T00:00:00Z' }),
      { pubkey: MECHA_NEXT, generation: 3, notAfter: '2100-01-01T00:00:00Z' }
    ]);
    const heard = labelHeard(r, secs('2026-11-02T00:00:00Z'));
    expect(heard(getPublicKey(one), OCT_18)).toBe(false);
    expect(heard(MECHA_NEXT, OCT_18)).toBe(false);
    // From its start, and never a label dated before it.
    expect(heard(getPublicKey(two), secs('2026-11-01T12:00:00Z'))).toBe(true);
    expect(heard(getPublicKey(two), secs('2026-10-31T12:00:00Z'))).toBe(false);
    expect(labelHeard(r, OCT_18)(getPublicKey(two), OCT_18)).toBe(false);
    expect(heard('c'.repeat(64), OCT_18)).toBe(true);
  });

  it('none of either of Mecha Jono’s keys today', () => {
    const heard = labelHeard(MISSION_PUBLISHERS, OCT_18);
    expect([heard(MECHA_OLD, OCT_18), heard(MECHA_NEXT, OCT_18)]).toEqual([false, false]);
  });
});

describe('a mission this device kept in its history, asked again', () => {
  const kept = (pubkey: string, d: string, publishedAt: number) => ({ address: `30079:${pubkey}:${d}`, d, publisher: { pubkey }, publishedAt });
  const ON_LIST = FROZEN_SETS[0]!.packages[0]!.d;

  it('is trusted only under a key this build trusts, from its start, and under the frozen key only at a d on its list', () => {
    expect(keptMissionTrusted(kept(MECHA_NEXT, 'planted', OCT_18 - 86_400), MISSION_PUBLISHERS, OCT_18)).toBe(false);
    expect(keptMissionTrusted(kept(MECHA_OLD, 'planted-after-the-leak', OCT_18 - 86_400), MISSION_PUBLISHERS, OCT_18)).toBe(false);
    expect(keptMissionTrusted(kept(MECHA_OLD, ON_LIST, secs('2026-10-02T00:00:00Z')), MISSION_PUBLISHERS, OCT_18)).toBe(true);
    // On the reader's clock: once the old key has ended, not even its list.
    expect(keptMissionTrusted(kept(MECHA_OLD, ON_LIST, secs('2026-10-02T00:00:00Z')), MISSION_PUBLISHERS, secs('2026-11-13T00:00:00Z'))).toBe(false);
    const r = registry([trusted(getPublicKey(one), { notBefore: '2026-10-01T00:00:00Z' })]);
    expect(keptMissionTrusted(kept(getPublicKey(one), 'x', secs('2026-10-02T00:00:00Z')), r, OCT_18)).toBe(true);
    expect(keptMissionTrusted(kept(getPublicKey(one), 'x', secs('2026-09-30T00:00:00Z')), r, OCT_18)).toBe(false);
    expect(keptMissionTrusted(kept(getPublicKey(one), 'x', OCT_18 + 3 * 86_400), r, OCT_18)).toBe(false);
    // Its address must be the one its key and d make: a report names the address.
    expect(keptMissionTrusted({ ...kept(getPublicKey(one), 'x', OCT_18), address: `30079:${MECHA_NEXT}:x` }, r, OCT_18)).toBe(false);
    expect(keptMissionTrusted(kept(getPublicKey(two), 'x', OCT_18), r, OCT_18)).toBe(false);
  });
});

describe('a pause where no secret leaked', () => {
  it('is lapsed, not paused, when no key is current and none is exposed', () => {
    const r = registry([trusted(getPublicKey(one), { notAfter: '2026-10-01T00:00:00Z' })]);
    expect(sealTargetOf(getPublicKey(one), r, OCT_18)).toMatchObject({ ok: false, why: 'lapsed' });
    // An exposed key still trusted to sign is why: paused.
    const exposed = registry([trusted(getPublicKey(one), { exposed: '2026-09-28' })]);
    expect(sealTargetOf(getPublicKey(one), exposed, OCT_18)).toMatchObject({ ok: false, why: 'paused' });
  });
});
