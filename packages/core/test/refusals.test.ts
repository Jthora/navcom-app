/**
 * The three refusals that units narrow, and the sentences each must keep.
 *
 * On 2026-10-09 the owner decided units: crews with a charter, offices, and orders where a
 * charter chose them (docs/design/units.md). Three published refusals had to move with that,
 * or the file an integrator reads first would describe a network that no longer exists. That is
 * the drift `refusals.ts` was written to prevent.
 *
 * Narrowing is where a refusal quietly loses its point, so these tests pin both halves: what the
 * narrowing allows, and what it must never stop refusing. The well-known JSON is generated from
 * this source with no edits in between (web/scripts/well-known.mjs), so the text checked here is
 * the text that gets published.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BROADCAST, REFUSALS, type Refusal } from '../src/index.js';

const refusal = (id: string): Refusal => {
  const found = REFUSALS.find((r) => r.id === id);
  if (!found) throw new Error(`refusal ${id} is gone`);
  return found;
};

describe('no-tasking, narrowed for units', () => {
  const r = () => refusal('no-tasking');

  it('keeps the watch sentence word for word', () => {
    // units.md §16: this stays word for word. The watch never assigns, whatever a unit chose.
    expect(r().because).toContain(
      'There is no dispatch verb. The watch tells you what is happening; it never assigns.'
    );
  });

  it('refuses tasking from the watch, agents, nodes and integrators in every case', () => {
    const refuses = r().refuses;
    expect(refuses).toMatch(/assigns, dispatches, tasks or directs an operator/);
    expect(refuses).toMatch(/from outside their own accepted chain/);
    for (const who of ['the watch', 'an agent', 'a node', 'an integrator']) {
      expect(refuses, `${who} is no longer refused`).toContain(who);
    }
    expect(refuses).toMatch(/in every case/);
  });

  it('allows orders only inside a charter the member accepted before joining', () => {
    const because = r().because;
    expect(because).toContain(
      'Inside a unit whose charter the member accepted before joining, orders exist only as that charter allows'
    );
    expect(because).toMatch(/No agent holds a unit key or an office/);
    // Decision 1's third limit: one captured key cannot assemble a unit anywhere (units.md §10).
    expect(because).toContain(
      'Anything that would bring more than one person to a place needs both the CO\'s and the XO\'s signatures.'
    );
    // The cost sits beside the choice, and the standing it never touches is named.
    expect(because).toMatch(/declining an order may cost membership of that one unit/);
    expect(because).toMatch(/never Karma, Hours, Supply, Intel or Honor/);
  });
});

describe('no-credential-gate, narrowed for offices', () => {
  const r = () => refusal('no-credential-gate');

  it('still refuses every gate except an office over its own unit', () => {
    expect(r().refuses).toMatch(/^A credential, score, standing, title or rank used to gate access to anything\./);
    expect(r().refuses).toMatch(/an office held in a unit gates that unit's own acts, and nothing outside the unit that granted it/);
  });

  it('names what an office may gate, and what reads the same for everyone', () => {
    const because = r().because;
    expect(because).toMatch(/admitting, removing, carrying the unit's word/);
    expect(because).toMatch(/An office never gates anything outside the unit that granted it/);
    for (const open of ['the directory', 'the map', '`Query`', 'the watch', '`Distress`', 'open missions', 'other units', 'public data']) {
      expect(because, `${open} is no longer named as open to everyone`).toContain(open);
    }
  });

  it('keeps the ratified sentence other code quotes', () => {
    // web/src/lib/community.ts cites this refusal by these words.
    expect(r().because).toContain('claims describe, they never gate');
  });

  it('still keeps standing and titles from changing a unit\'s room', () => {
    // groups.md §5 writes no new rule for room because this refusal already covers it.
    expect(r().because).toMatch(/Titles, grade names and standing gate nothing even inside a unit, and never change its room/);
  });
});

describe('no-operator-traffic-on-a-private-relay, naming crews and units', () => {
  const r = () => refusal('no-operator-traffic-on-a-private-relay');

  it('names crew and unit events beside everything it already covered', () => {
    const refuses = r().refuses;
    for (const traffic of ['presence', 'distress', 'signals', 'corrections', 'places', 'cards', 'invites', 'crew and unit events']) {
      expect(refuses, `${traffic} fell out of the refusal`).toContain(traffic);
    }
    expect(refuses).toMatch(/on a private or allowlisted relay$/);
  });

  it('still lets only the artifact announcement cross', () => {
    expect(r().because).toMatch(/Only the artifact announcement \(kind 30078\) may cross such a relay/);
  });
});

describe('what the narrowed refusals claim about themselves', () => {
  const narrowed = ['no-tasking', 'no-credential-gate', 'no-operator-traffic-on-a-private-relay'];

  it('say they are decided and not built', () => {
    /*
     * Units are decided and none of it exists. A refusal published as if orders or offices were
     * live tells an integrator to plan around a network that is not there. When units ship,
     * whoever ships them removes the not-built wording and this expectation in the same commit;
     * nothing here detects it automatically.
     */
    for (const id of narrowed) {
      expect(refusal(id).because, `${id} no longer dates its narrowing`).toMatch(/decided 2026-10-09 and not built/);
    }
  });

  it('cite only pages the docs site publishes', () => {
    // The site serves docs/<path>.md at /docs/<path>. A citation to a renamed page is a dead link
    // in the one file an integrator reads first.
    const cited = [...REFUSALS.flatMap((r) => [r.refuses, r.because]), BROADCAST.rules]
      .flatMap((text) => [...text.matchAll(/\/docs\/([a-z0-9/-]+)/g)].map(([, path]) => path));
    expect(cited).toContain('design/units');
    for (const path of cited) {
      const file = fileURLToPath(new URL(`../../../docs/${path}.md`, import.meta.url));
      expect(existsSync(file), `/docs/${path} has no page`).toBe(true);
    }
  });
});
