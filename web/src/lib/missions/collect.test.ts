import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools/pure';
import { READINGS_MAX, collect } from './collect';
import { FROZEN_SETS, type FrozenSet } from '@navcom/core';
import { oneKey } from './registry-fixture';

/** Real packages signed by Mecha Jono, captured from The Record — see core's missions test. */
const FIXTURES = fileURLToPath(new URL('../../../../packages/core/test/fixtures/mission-packages.json', import.meta.url));
const [HEAT, RECALL, DESK] = JSON.parse(readFileSync(FIXTURES, 'utf8'));
const NOW = new Date('2026-10-06T20:00:00Z');
/**
 * The fixtures were captured on 2026-10-06; the frozen set this release pins holds the newest
 * version of each of Mecha Jono's missions as read on 2026-10-18, so these older copies are not on
 * it. A set naming the fixtures' own ids, under the shipped key, lets them stand in for what is.
 */
const AS_CAPTURED: FrozenSet = {
  ...FROZEN_SETS[0]!,
  packages: [HEAT, RECALL].map((e) => ({ id: e.id, d: e.tags.find((t: string[]) => t[0] === 'd')[1] }))
};

describe('what a device keeps from what the relay sent', () => {
  it('keeps the open field mission, drops the closed one, and leaves desk work out', () => {
    const c = collect([HEAT, RECALL, DESK], NOW, undefined, undefined, { sets: [AS_CAPTURED] });
    expect(c.missions.map((m) => m.d)).toEqual(['starcom_mission_package_field-heat_relief-CA-2026-10-02']);
    expect(c.refused).toEqual([]);
  });

  it('keeps the newest version of a package when it arrives twice', () => {
    // A relay returns only the newest of a replaceable event; a live subscription can still
    // deliver the old one first and the new one after, and the old one must not win.
    const secret = generateSecretKey();
    const publishers = oneKey(getPublicKey(secret), 'Test', true);
    const version = (created_at: number, name: string) =>
      finalizeEvent(
        {
          kind: 30079, created_at, content: JSON.stringify({ name, objectives: [{ id: 'do:it', ask: 'Do it.' }] }),
          tags: [['d', 'starcom_mission_package_x'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'],
            ['t', 'navcom_mission'], ['mission_state', 'open'], ['valid_until', '1791608400']]
        },
        secret
      );
    const c = collect([version(1791300000, 'newer'), version(1791200000, 'older')], NOW, publishers);
    expect(c.missions.map((m) => m.title)).toEqual(['newer']);
  });

  it('drops a version that proves nothing about whose it is, without listing it', () => {
    // Forged, or a copy changed on this device: there is nobody to tell, so nothing is said.
    const tampered = { ...JSON.parse(JSON.stringify(HEAT)), content: '{}' };
    expect(collect([tampered], NOW)).toEqual({ missions: [], refused: [], clockBehind: false });
  });

  it('drops a mission once its end has passed by this device’s clock', () => {
    const end = Number(HEAT.tags.find((t: string[]) => t[0] === 'valid_until')[1]);
    expect(collect([HEAT], new Date((end + 1) * 1000)).missions).toEqual([]);
  });
});

describe('versions, and what a newer one may do to an older one', () => {
  const secret = generateSecretKey();
  const publishers = oneKey(getPublicKey(secret), 'Test', true);
  const version = (created_at: number, objectives: unknown[], extra: string[][] = []) =>
    finalizeEvent(
      {
        kind: 30079, created_at, content: JSON.stringify({ name: `v${created_at}`, objectives }),
        tags: [['d', 'starcom_mission_package_x'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'],
          ['t', 'navcom_mission'], ['mission_state', 'open'], ['valid_until', '1791608400'], ...extra]
      },
      secret
    );
  const one = [{ id: 'do:it', ask: 'Do it.' }];

  it('lets a newer version the publisher signed hide the older one even when NavCom cannot read it, and says why', () => {
    const c = collect([version(1791200000, one), version(1791300000, [])], NOW, publishers);
    expect(c.missions).toEqual([]);
    expect(c.refused).toEqual([{ address: `30079:${getPublicKey(secret)}:starcom_mission_package_x`, d: 'starcom_mission_package_x', because: expect.stringMatching(/objective/) }]);
  });

  it('never lets a forged newer version hide anything', () => {
    const forged = { ...JSON.parse(JSON.stringify(version(1791300000, []))), sig: '0'.repeat(128) };
    expect(collect([version(1791200000, one), forged], NOW, publishers).missions.map((m) => m.title)).toEqual(['v1791200000']);
  });

  it('breaks a tie of the same second by the lower id, so every device draws the same version', () => {
    const a = version(1791300000, one, [['x', 'a']]);
    const b = version(1791300000, one, [['x', 'b']]);
    const lower = a.id < b.id ? a : b;
    for (const order of [[a, b], [b, a]]) expect(collect(order, NOW, publishers).missions[0]!.publishedAt).toBe(lower.created_at);
    expect(collect([a, b], NOW, publishers).missions).toHaveLength(1);
  });

  it('does not report a refusal of a version that is closed, which would not have been shown anyway', () => {
    const closed = finalizeEvent(
      { kind: 30079, created_at: 1791300000, content: JSON.stringify({ name: 'x', objectives: [] }),
        tags: [['d', 'y'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'], ['mission_state', 'closed'], ['valid_until', '1791608400']] },
      secret
    );
    expect(collect([closed], NOW, publishers).refused).toEqual([]);
  });

  /*
   * Decided 2026-10-18: a version dated ahead is how a stolen key wins a sort by date, so it is
   * dropped, not flagged. Ahead of what is the trust clock — this device's, floored at the build —
   * so a version is kept, and the clock called behind, only when the build itself is later than
   * this device's clock says it is.
   */
  it('drops a version dated more than a day ahead, and calls the clock behind only for one the build vouches for', () => {
    const now = Math.floor(NOW.getTime() / 1000);
    const ahead = version(now + 2 * 86_400, one);
    expect(collect([ahead], NOW, publishers)).toMatchObject({ missions: [], clockBehind: false });
    // The build is three days later than this phone says: the same version is kept, and the clock is behind.
    const vouched = collect([ahead], NOW, publishers, undefined, { at: now + 3 * 86_400 });
    expect(vouched.missions).toHaveLength(1);
    expect(vouched.clockBehind).toBe(true);
    expect(collect([version(1791300000, one)], NOW, publishers).clockBehind).toBe(false);
  });

  it('never throws, whatever a relay sent', () => {
    const poison = [null, 7, 'x', { kind: 30079, tags: [null] }, { kind: 30079, id: 'x', tags: 'no' }];
    expect(() => collect(poison, NOW, publishers)).not.toThrow();
  });
});

describe('what the second audit of Milestone 11 found', () => {
  const secret = generateSecretKey();
  const publishers = oneKey(getPublicKey(secret), 'Test', true);
  const version = (created_at: number, name: string, over: { state?: string; d?: string; priority?: string; ends?: string } = {}) =>
    finalizeEvent(
      {
        kind: 30079, created_at, content: JSON.stringify({ name, objectives: [{ id: 'do:it', ask: 'Do it.' }] }),
        tags: [['d', over.d ?? 'starcom_mission_package_x'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'],
          ['t', 'navcom_mission'], ['mission_state', over.state ?? 'open'], ['valid_until', over.ends ?? '1791608400'],
          ...(over.priority ? [['priority', over.priority]] : [])]
      },
      secret
    );
  const titles = (c: { missions: { title: string }[] }) => c.missions.map((m) => m.title);
  /** What any relay can send: a genuine version's id and key, over content and a signature of its own. */
  const forgedAs = (e: object, over: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(e)), content: '{"name":"x"}', sig: '0'.repeat(128), ...over });

  describe('a forged copy that reuses a genuine version’s id', () => {
    const open = version(1791200000, 'Open');
    const closed = version(1791300000, 'Closed', { state: 'closed' });

    it('cannot keep a mission open that its poster closed, by arriving first', () => {
      const memo = new Map();
      expect(titles(collect([open, forgedAs(closed)], NOW, publishers, memo))).toEqual(['Open']);
      expect(titles(collect([open, forgedAs(closed), closed], NOW, publishers, memo))).toEqual([]);
    });

    it('cannot hide a package, by arriving first', () => {
      const memo = new Map();
      collect([forgedAs(open)], NOW, publishers, memo);
      expect(titles(collect([open], NOW, publishers, memo))).toEqual(['Open']);
    });

    it('cannot hide one by carrying its very content under a signature that does not verify', () => {
      const memo = new Map();
      collect([forgedAs(closed, { content: closed.content })], NOW, publishers, memo);
      expect(titles(collect([open, closed], NOW, publishers, memo))).toEqual([]);
    });
  });

  it('remembers a bounded number of readings, however many a relay sends', () => {
    const memo = new Map();
    const junk = Array.from({ length: READINGS_MAX + 10 }, (_, i) => {
      const e = { kind: 30079, pubkey: getPublicKey(secret), created_at: 1791300000, content: '{}', tags: [['d', `junk-${i}`]] };
      return { ...e, id: getEventHash(e), sig: '0'.repeat(128) };
    });
    collect(junk, NOW, publishers, memo);
    expect(memo.size).toBeLessThanOrEqual(READINGS_MAX);
  });

  it('breaks a tie of the same second by the lower id, in either order', () => {
    const a = version(1791300000, 'A');
    const b = version(1791300000, 'B');
    const lower = a.id < b.id ? 'A' : 'B';
    expect(titles(collect([a, b], NOW, publishers))).toEqual([lower]);
    expect(titles(collect([b, a], NOW, publishers))).toEqual([lower]);
  });

  it('keeps a version up to a day ahead, and drops one a second past it', () => {
    const now = Math.floor(NOW.getTime() / 1000);
    expect(collect([version(now + 60, 'x')], NOW, publishers)).toMatchObject({ clockBehind: false, missions: [expect.anything()] });
    expect(collect([version(now + 86_400, 'x')], NOW, publishers)).toMatchObject({ clockBehind: false, missions: [expect.anything()] });
    expect(collect([version(now + 86_401, 'x')], NOW, publishers)).toMatchObject({ clockBehind: false, missions: [] });
  });

  it('orders missions of equal weight and end by address, so every device lists them alike', () => {
    // Titles that sort the other way, and two the same: neither may decide the order [review].
    const c = collect([version(1791300000, 'Alpha', { d: 'b' }), version(1791300000, 'Zulu', { d: 'a' })], NOW, publishers);
    expect(titles(c)).toEqual(['Zulu', 'Alpha']);
    const same = [version(1791300000, 'Water', { d: 'b' }), version(1791300000, 'Water', { d: 'a' })];
    expect(collect(same, NOW, publishers).missions.map((m) => m.d)).toEqual(['a', 'b']);
    expect(collect(same.slice().reverse(), NOW, publishers).missions.map((m) => m.d)).toEqual(['a', 'b']);
  });

  it('does not report a refusal of a version already past its end', () => {
    const now = Math.floor(NOW.getTime() / 1000);
    const refusedVersion = (ends: number) =>
      finalizeEvent(
        { kind: 30079, created_at: 1791300000, content: JSON.stringify({ name: 'x', objectives: [] }),
          tags: [['d', 'r'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'], ['mission_state', 'open'], ['valid_until', String(ends)]] },
        secret
      );
    expect(collect([refusedVersion(now - 60)], NOW, publishers).refused).toEqual([]);
    expect(collect([refusedVersion(now + 60)], NOW, publishers).refused).toHaveLength(1);
  });
});
