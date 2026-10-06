/**
 * The snapshot logic on real packages, and the built file on what actually deploys.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { snapshotOf, type MissionSnapshot } from './snapshot';

const FIXTURES = fileURLToPath(new URL('../../../../packages/core/test/fixtures/mission-packages.json', import.meta.url));
const [HEAT, RECALL, DESK] = JSON.parse(readFileSync(FIXTURES, 'utf8'));
const NOW = new Date('2026-10-06T20:00:00Z');

describe('what a snapshot keeps', () => {
  const snap = snapshotOf([HEAT, RECALL, DESK], NOW);

  it('keeps the open field mission, drops the closed one, and leaves desk work out', () => {
    expect(snap.missions.map((m) => m.d)).toEqual(['starcom_mission_package_field-heat_relief-CA-2026-10-02']);
    expect(snap.refused).toEqual([]);
  });

  it('keeps the newest version of a package when a relay returns two', () => {
    // Two validly signed versions of one package. A relay should only return the newest of a
    // replaceable event, but a mirror may not, and the older one must not win.
    const secret = generateSecretKey();
    const publishers = { [getPublicKey(secret)]: { name: 'Test', agent: true } };
    const version = (created_at: number, name: string) =>
      finalizeEvent(
        {
          kind: 30079, created_at, content: JSON.stringify({ name }),
          tags: [['d', 'starcom_mission_package_x'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'],
            ['t', 'navcom_mission'], ['mission_state', 'open'], ['valid_until', '1791608400']]
        },
        secret
      );
    const s = snapshotOf([version(1791300000, 'newer'), version(1791200000, 'older')], NOW, 'test', publishers);
    expect(s.missions.map((m) => m.title)).toEqual(['newer']);
  });

  it('reports a refusal by name and reason, so the publisher can be told', () => {
    const tampered = { ...JSON.parse(JSON.stringify(HEAT)), content: '{}' };
    const s = snapshotOf([tampered], NOW);
    expect(s.missions).toEqual([]);
    expect(s.refused).toEqual([
      { d: 'starcom_mission_package_field-heat_relief-CA-2026-10-02', because: expect.stringMatching(/signature/) }
    ]);
  });

  it('drops a mission that has ended by the time the snapshot is taken', () => {
    expect(snapshotOf([HEAT], new Date((HEAT.tags.find((t: string[]) => t[0] === 'valid_until')[1] * 1 + 1) * 1000)).missions).toEqual([]);
  });
});

describe('the file that deploys', () => {
  const file = fileURLToPath(new URL('../../../build/missions.json', import.meta.url));

  it('exists, says when it was taken, and says whether it could be', () => {
    if (!existsSync(file)) throw new Error('missions.json was not built');
    const snap = JSON.parse(readFileSync(file, 'utf8')) as MissionSnapshot;
    expect(snap.version).toBe(1);
    expect(Number.isNaN(Date.parse(snap.taken_at))).toBe(false);
    expect(['ok', 'unavailable']).toContain(snap.status);
    if (snap.status === 'unavailable') expect(snap.missions).toEqual([]);
  });

  it('holds only missions that were active when it was taken, each identified as an agent’s', () => {
    const snap = JSON.parse(readFileSync(file, 'utf8')) as MissionSnapshot;
    const taken = Date.parse(snap.taken_at) / 1000;
    for (const m of snap.missions) {
      expect(m.state, m.d).not.toBe('closed');
      expect(m.validUntil, m.d).toBeGreaterThan(taken);
      expect(m.publisher.agent, m.d).toBe(true);
      expect(m.effect.join(' '), m.d).not.toMatch(/\bpeople\b/i);
    }
  });
});
