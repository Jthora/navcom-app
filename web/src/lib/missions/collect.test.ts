import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { collect } from './collect';

/** Real packages signed by Mecha Jono, captured from The Record — see core's missions test. */
const FIXTURES = fileURLToPath(new URL('../../../../packages/core/test/fixtures/mission-packages.json', import.meta.url));
const [HEAT, RECALL, DESK] = JSON.parse(readFileSync(FIXTURES, 'utf8'));
const NOW = new Date('2026-10-06T20:00:00Z');

describe('what a device keeps from what the relay sent', () => {
  it('keeps the open field mission, drops the closed one, and leaves desk work out', () => {
    const c = collect([HEAT, RECALL, DESK], NOW);
    expect(c.missions.map((m) => m.d)).toEqual(['starcom_mission_package_field-heat_relief-CA-2026-10-02']);
    expect(c.refused).toEqual([]);
  });

  it('keeps the newest version of a package when it arrives twice', () => {
    // A relay returns only the newest of a replaceable event; a live subscription can still
    // deliver the old one first and the new one after, and the old one must not win.
    const secret = generateSecretKey();
    const publishers = { [getPublicKey(secret)]: { name: 'Test', agent: true } };
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
  const publishers = { [getPublicKey(secret)]: { name: 'Test', agent: true } };
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

  it('notices a clock behind the publisher’s, by more than a day', () => {
    expect(collect([version(Math.floor(NOW.getTime() / 1000) + 2 * 86_400, one)], NOW, publishers).clockBehind).toBe(true);
    expect(collect([version(1791300000, one)], NOW, publishers).clockBehind).toBe(false);
  });

  it('never throws, whatever a relay sent', () => {
    const poison = [null, 7, 'x', { kind: 30079, tags: [null] }, { kind: 30079, id: 'x', tags: 'no' }];
    expect(() => collect(poison, NOW, publishers)).not.toThrow();
  });
});
