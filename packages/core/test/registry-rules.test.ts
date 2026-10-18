import { describe, expect, it } from 'vitest';
import {
  EXPOSED_LATEST,
  FROZEN_SETS,
  MISSION_PUBLISHERS,
  frozenDigest,
  nameKey,
  registryDocument,
  registryProblems,
  type MissionPublisher,
  type MissionPublishers
} from '../src/index.js';
import { trusted } from './helpers/registry.js';

/**
 * What the build refuses in the publisher registry [missions/registry-rules.ts].
 *
 * The first test is the refusal itself: core's tests run inside the deploy's build command
 * (`vercel.json`), so a registry breaking any rule below does not ship. The rest show each rule
 * catches what it is for.
 */

const secs = (iso: string) => Date.parse(iso) / 1000;
const OCT_18 = secs('2026-10-18T12:00:00Z');
const MECHA = MISSION_PUBLISHERS[0]!;
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const entry = (over: Partial<MissionPublisher> = {}): MissionPublisher => ({ id: 'desk', name: 'Desk', agent: true, keys: [trusted(A, { notAfter: '2027-06-01T00:00:00Z' })], next: null, ...over });

describe('the registry this release ships', () => {
  it('breaks no rule, at the moment it is built', () => {
    expect(registryProblems(MISSION_PUBLISHERS, Math.floor(Date.now() / 1000))).toEqual([]);
  });

  it('gives every exposed key an end no later than the latest pinned for it', () => {
    for (const k of MECHA.keys.filter((k) => k.exposed)) expect(Date.parse(k.notAfter)).toBeLessThanOrEqual(Date.parse(EXPOSED_LATEST[k.pubkey]!));
  });
});

describe('what the build refuses', () => {
  it('an exposed key whose end is later than the latest pinned for it, by a second', () => {
    const later = [{ ...MECHA, keys: [{ ...MECHA.keys[0]!, notAfter: '2026-11-13T00:00:01Z' }, MECHA.keys[1]!] }];
    expect(registryProblems(later, OCT_18)).toEqual([expect.stringMatching(/exposed, and its notAfter is later than 2026-11-13/)]);
  });

  it('an exposed key with no latest end pinned for it', () => {
    expect(registryProblems([entry({ keys: [trusted(A, { exposed: '2026-10-01', notAfter: '2026-12-01T00:00:00Z' }), trusted(B, { generation: 2, notAfter: '2027-06-01T00:00:00Z' })] })], OCT_18)).toEqual([
      expect.stringMatching(/EXPOSED_LATEST gives it no latest end/)
    ]);
  });

  describe('a publisher with no key it signs with that runs 60 more days', () => {
    it('at 59 days, and not at 60', () => {
      expect(registryProblems([entry({ keys: [trusted(A, { notAfter: new Date((OCT_18 + 59 * 86_400) * 1000).toISOString() })] })], OCT_18)).toEqual([
        expect.stringMatching(/runs 60 days past this build/)
      ]);
      expect(registryProblems([entry({ keys: [trusted(A, { notAfter: new Date((OCT_18 + 60 * 86_400) * 1000).toISOString() })] })], OCT_18)).toEqual([]);
    });

    it('not while its only key trusted to sign is exposed and its next has no start — today’s registry, a day before the old key ends', () => {
      expect(registryProblems(MISSION_PUBLISHERS, secs('2026-11-12T00:00:00Z'))).toEqual([]);
    });

    it('but once the next key has a start, its end must run 60 days past the build', () => {
      const started = (notAfter: string) => [{ ...MECHA, keys: [MECHA.keys[0]!, { ...MECHA.keys[1]!, notBefore: '2026-11-05T00:00:00Z', notAfter }] }];
      expect(registryProblems(started('2027-10-18T00:00:00Z'), OCT_18)).toEqual([]);
      expect(registryProblems(started('2026-12-01T00:00:00Z'), OCT_18)).toEqual([expect.stringMatching(/mecha-jono: no key it signs with runs 60 days/)]);
    });
  });

  it('an end more than a year after the build', () => {
    expect(registryProblems([entry({ keys: [trusted(A, { notAfter: '2028-01-01T00:00:00Z' })] })], OCT_18)).toEqual([expect.stringMatching(/more than a year/)]);
  });

  it('a second entry whose name reads as the first’s, however it is spaced, cased or spelled with look-alikes', () => {
    for (const name of ['Mecha  Jono', 'MECHA JONO', 'Mecha-Jono', 'Mecha Jon0', 'Ｍｅｃｈａ Ｊｏｎｏ']) {
      const twin = [MECHA, entry({ id: 'twin', name, keys: [trusted(B, { notAfter: '2027-06-01T00:00:00Z' })] })];
      expect(registryProblems(twin, OCT_18), name).toEqual([expect.stringMatching(/reads as "Mecha Jono", another entry's name/)]);
    }
    expect(nameKey('Mecha  Jono')).toBe(nameKey('Mecha Jono'));
  });

  it('a name reserved for NavCom and the bodies it reads, and two entries sharing an id or a key', () => {
    expect(registryProblems([entry({ name: 'Nav Com' })], OCT_18)).toEqual([expect.stringMatching(/reads as NavCom/)]);
    expect(registryProblems([entry(), entry({ name: 'Other' })], OCT_18)).toEqual([expect.stringMatching(/share this id/), expect.stringMatching(/listed twice/)]);
  });

  it('a frozen list that does not match the digest pinned beside it, and a frozen key not marked exposed', () => {
    const changed = [{ ...FROZEN_SETS[0]!, packages: FROZEN_SETS[0]!.packages.map((p, i) => (i === 0 ? { ...p, d: p.d + 'x' } : p)) }];
    expect(registryProblems(MISSION_PUBLISHERS, OCT_18, changed)).toEqual([expect.stringMatching(/does not match the digest pinned beside it/)]);
    const set = { key: A, taken: '2026-10-18', source: 'a test', packages: [] };
    expect(registryProblems([entry({ keys: [trusted(A, { notAfter: '2027-06-01T00:00:00Z', frozen: { sha256: frozenDigest(set), confirmed: true } })] })], OCT_18, [set])).toEqual([
      expect.stringMatching(/frozen and not marked exposed/)
    ]);
  });

  it('anything in the reserved next field, and an inbox that is not a secure relay', () => {
    expect(registryProblems([{ ...entry(), next: 'c'.repeat(64) as unknown as null }], OCT_18)).toEqual([expect.stringMatching(/next is reserved/)]);
    expect(registryProblems([entry({ inbox: ['ws://inbox.test'] })], OCT_18)).toEqual([expect.stringMatching(/not a secure relay/)]);
  });
});

describe('the file a publisher checks', () => {
  const doc = registryDocument(MISSION_PUBLISHERS);

  it('says every key, its dates and its list, with null for what is absent', () => {
    const mecha = doc.publishers[0]!;
    expect(mecha).toMatchObject({ id: 'mecha-jono', name: 'Mecha Jono', agent: true, inbox: ['wss://nos.lol', 'wss://relay.primal.net'], next: null });
    expect(mecha.keys.map((k) => [k.pubkey.slice(0, 8), k.generation, k.notBefore, k.notAfter, k.exposed])).toEqual([
      ['6301c4d0', 1, '2025-01-01T00:00:00Z', '2026-11-13T00:00:00Z', '2026-09-28'],
      ['86f824c3', 2, null, '2027-10-18T00:00:00Z', null]
    ]);
    const frozen = mecha.keys[0]!.frozen!;
    // Anybody can recompute the pin from the file alone.
    expect(frozenDigest({ key: mecha.keys[0]!.pubkey, packages: frozen.packages })).toBe(frozen.sha256);
    expect(frozen.confirmed).toBe(false);
  });

  it('is the same bytes however often it is made', () => {
    expect(JSON.stringify(registryDocument(MISSION_PUBLISHERS as MissionPublishers))).toBe(JSON.stringify(doc));
  });
});
