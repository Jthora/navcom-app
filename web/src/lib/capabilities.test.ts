/**
 * The static half of the capability checks: the screen exists, is cached, and says what it
 * claims.
 *
 * The other half — that `requires` is the truth — needs a real browser and lives in
 * `e2e/capabilities.spec.ts`. Neither half is sufficient: a screen can carry every claim and
 * still have no control on it, and a control can work while the claim beside it is fiction.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CAPABILITY_SCREENS } from './capabilities';
import { TERMINAL_ROUTES } from './terminal/routes';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));

function body(screen: string): string {
  const path = join(BUILD, screen, 'index.html');
  if (!existsSync(path)) throw new Error(`${screen} was not built`);
  return parse(readFileSync(path, 'utf8')).querySelector('body')?.structuredText ?? '';
}

describe('every capability has a screen', () => {
  for (const screen of CAPABILITY_SCREENS) {
    it(`${screen} is in the build`, () => {
      expect(existsSync(join(BUILD, screen, 'index.html'))).toBe(true);
    });
  }

  it('every capability screen is cached for offline', () => {
    // Two screens once shipped without being cached, and both were screens whose whole
    // point is working without a signal.
    const cached = new Set<string>(TERMINAL_ROUTES.map((r) => `terminal/${r}`));
    // `on-visit` screens are cached the first time they are opened rather than precached --
    // "only what you open is kept", because carrying every metro would fill a cheap phone.
    // Asserted separately below rather than exempted silently.
    for (const c of CAPABILITIES.filter((x) => (x.cached ?? 'precache') === 'precache')) {
      expect(cached.has(c.screen), `${c.screen} is not cached offline`).toBe(true);
    }
  });

  it('every on-visit screen was actually built, since nothing precaches it', () => {
    // The failure this guards: a screen that is neither in the shell nor in the build is
    // simply absent, and the precache check above would not have looked.
    for (const c of CAPABILITIES.filter((x) => x.cached === 'on-visit')) {
      expect(existsSync(join(BUILD, c.screen, 'index.html')), `${c.screen} was not built`).toBe(true);
    }
  });
});

describe('every claim has something behind it', () => {
  for (const capability of CAPABILITIES) {
    for (const claim of capability.claims) {
      it(`${capability.name}: "${claim}"`, () => {
        // Checked against the prerendered HTML, so a claim cannot hide behind state a
        // fresh visitor lacks. That is the point rather than a limitation: five times this
        // session an important sentence sat behind a conditional nobody would reach.
        expect(body(capability.screen)).toContain(claim);
      });
    }
  }
});

describe('the manifest itself stays honest', () => {
  it('says, for every capability, what a person operates or why there is nothing', () => {
    /*
     * This used to name five capabilities and check only those.
     *
     * A capability with no control is a page you read; one with a control is a thing you do,
     * and the browser check only exercises the second. So an undeclared control was a
     * capability nothing ever operated — and nineteen of twenty-four were outside the list.
     * Nine of them genuinely had nothing declared, including `terminal/wipe/` and
     * `terminal/patrols/`: the two screens where *a mechanism nobody can reach* has actually
     * happened, to `panicWipe` and to the patrol export's `includeNotes`.
     *
     * A guard whose coverage is a hand-written allow-list only ever covers the failures
     * somebody already remembered, which is the same shape as the bug it is guarding
     * against. Requiring an answer from every capability is the fix: silence is no longer
     * an option, and choosing `readOnly` is a sentence somebody had to write and a reviewer
     * can disagree with.
     */
    for (const c of CAPABILITIES) {
      const declared = [c.control, c.readOnly].filter(Boolean).length;
      expect(
        declared,
        `${c.name}: set exactly one of control (a selector) or readOnly (why there is nothing)`
      ).toBe(1);
    }
  });

  it('does not let readOnly become the easy way out', () => {
    // The failure mode of the rule above: a screen with a button, marked readOnly with four
    // words, to make the check go away. A reason has to be long enough to be a reason.
    for (const c of CAPABILITIES) {
      if (!c.readOnly) continue;
      expect(c.readOnly.length, `${c.name}: readOnly needs a real reason, not a placeholder`)
        .toBeGreaterThan(60);
    }
  });

  it('has no capability requiring a watch that it does not need', () => {
    // Most operators have no Watchtower. A capability that lists one is claiming most
    // people cannot use it, which had better be true.
    //
    // An allow-list rather than a rule, so that adding a third is a decision somebody had
    // to write down here:
    //
    //  - Query and Assist need a person on the other end. That is what they are
    //  - Resupply goes to whoever keeps the shared stash, and somebody patrolling alone has
    //    no quartermaster either — they buy their own socks. The screen says exactly that
    //    rather than reading as incomplete setup
    //  - What the watch wrote is a fourth, added when its control was finally declared: the
    //    "Ask the watch" button is disabled while the watch is dark, so the capability needs
    //    a watch that is actually there. The *screen* still works without one and gives an
    //    operator alone a true answer — nobody has written anything about you — which is why
    //    this is the control's requirement rather than the page's
    const needWatch = CAPABILITIES.filter((c) => c.requires.includes('watch')).map((c) => c.name);
    expect(needWatch.sort()).toEqual(['Assist', 'Query', 'Resupply', 'What the watch wrote']);
  });
});
