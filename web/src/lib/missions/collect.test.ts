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
          kind: 30079, created_at, content: JSON.stringify({ name }),
          tags: [['d', 'starcom_mission_package_x'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'],
            ['t', 'navcom_mission'], ['mission_state', 'open'], ['valid_until', '1791608400']]
        },
        secret
      );
    const c = collect([version(1791300000, 'newer'), version(1791200000, 'older')], NOW, publishers);
    expect(c.missions.map((m) => m.title)).toEqual(['newer']);
  });

  it('names a refusal and its reason, so the publisher can be told', () => {
    const tampered = { ...JSON.parse(JSON.stringify(HEAT)), content: '{}' };
    expect(collect([tampered], NOW)).toEqual({
      missions: [],
      refused: [{ d: 'starcom_mission_package_field-heat_relief-CA-2026-10-02', because: expect.stringMatching(/signature/) }]
    });
  });

  it('drops a mission once its end has passed by this device’s clock', () => {
    const end = Number(HEAT.tags.find((t: string[]) => t[0] === 'valid_until')[1]);
    expect(collect([HEAT], new Date((end + 1) * 1000)).missions).toEqual([]);
  });
});
