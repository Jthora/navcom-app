/**
 * The rule for where operator traffic may go, when the mission relay list is not what it should be
 * [review: G3 phase 1].
 *
 * The list lives in another module and is due to become a publisher's own. One entry the pool could
 * not parse made `whyNotListable` throw for every address: every `Distress` ended before its first
 * attempt, and every signal failed. One written with a trailing dot was let through. This file
 * stands in a list with both, and without The Record, which the rule names whatever the list says.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/missions/package.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/missions/package.js')>();
  return {
    ...real,
    MISSION_RELAYS: ['wss://mirror two.example', 'wss://dotted.example.', 'WSS://Upper.Example:7777', 42, ''] as unknown as string[]
  };
});

import { listable, whyNotListable } from '../src/relays';
import { THE_RECORD } from '../src/missions/package.js';
import { briefly, manyPool } from './helpers/distress';

describe('a mission relay list with entries that are not what they should be', () => {
  it('never makes the rule throw, and every other relay may still carry operator traffic', () => {
    expect(() => whyNotListable('wss://relay.example')).not.toThrow();
    expect(whyNotListable('wss://relay.example')).toBeNull();
    expect(listable('wss://nos.lol')).toBe(true);
  });

  it('lets no spelling of an entry written with a trailing dot, or in capitals, through', () => {
    for (const spelling of ['wss://dotted.example', 'wss://dotted.example.', 'wss://DOTTED.example:443/', 'dotted.example']) {
      expect(listable(spelling), spelling).toBe(false);
    }
    expect(listable('wss://upper.example')).toBe(false);
  });

  it('still refuses The Record, though the list leaves it out', () => {
    expect(whyNotListable(THE_RECORD)).toMatch(/mission relay/);
  });

  it('and a Distress still goes out', async () => {
    const phases = await briefly(manyPool({ eose: true }), ['wss://relay.example'], 1);
    expect(phases.map((p) => p.phase)).toContain('sent');
  });
});
