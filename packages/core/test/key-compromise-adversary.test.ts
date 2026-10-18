import { describe, expect, it } from 'vitest';
import { MISSION_PUBLISHERS, registryProblems, type MissionPublisher } from '../src/index.js';
import { trusted } from './helpers/registry.js';

/**
 * The adversary's pass over the registry rules [missions/registry-rules.ts; decided 2026-10-18]:
 * every rule keys on the entry id, and the build refuses a second entry that reads as another's
 * name, so no admitted key can display as Mecha Jono.
 */

const secs = (iso: string) => Date.parse(iso) / 1000;
const OCT_18 = secs('2026-10-18T12:00:00Z');
const A = 'a'.repeat(64);

const second = (name: string): MissionPublisher => ({
  id: 'second-desk',
  name,
  agent: false,
  keys: [trusted(A, { notAfter: '2027-06-01T00:00:00Z' })],
  next: null
});

describe('a second entry whose name reads as Mecha Jono’s on a screen', () => {
  it('is refused when one letter is its Cyrillic twin', () => {
    // "Mеcha Jono" with U+0435 CYRILLIC SMALL LETTER IE: the same glyph at every size a phone draws.
    const lookalike = second('Mеcha Jono');
    expect(registryProblems([...MISSION_PUBLISHERS, lookalike], OCT_18)).toEqual([expect.stringMatching(/reads as/)]);
  });

  it('is refused when a reserved name is spelled with a Greek omicron', () => {
    // "NavCοm" with U+03BF GREEK SMALL LETTER OMICRON.
    expect(registryProblems([...MISSION_PUBLISHERS, second('NavCοm')], OCT_18)).toEqual([expect.stringMatching(/reads as/)]);
  });
});
