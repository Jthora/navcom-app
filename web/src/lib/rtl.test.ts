/**
 * The stylesheet does not assume the reader starts on the left.
 *
 * NavCom is meant to work outside one country and one script. Arabic, Hebrew, Urdu and
 * Persian read right-to-left, and a rule written as `border-left` puts an accent bar on the
 * wrong side of every quoted block for those readers — the layout does not break loudly, it
 * just looks like it was built by somebody who did not consider them.
 *
 * ## Why this reads the built CSS rather than the source
 *
 * Three times this project has shipped a rule the source honoured and the output did not.
 * Svelte scopes and rewrites styles, and a component library or a future dependency can
 * emit physical properties nothing in `src/` contains. What ships is what a person gets.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));

/**
 * Properties with a logical equivalent that should have been used instead.
 *
 * Deliberately not exhaustive: `float`, `clear` and the `background-position` keywords are
 * also physical, and none of them appears here. This list is what the codebase actually
 * uses, and it grows when something new does.
 */
const PHYSICAL = [
  'margin-left',
  'margin-right',
  'padding-left',
  'padding-right',
  'border-left',
  'border-right',
  'text-align:left',
  'text-align:right'
];

function everyStyle(): { file: string; css: string }[] {
  const out: { file: string; css: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      // Both: an external stylesheet, and the <style> blocks inlined into a prerendered
      // page. Checking only the first would miss whatever the build chose to inline.
      if (name.endsWith('.css')) out.push({ file: path, css: readFileSync(path, 'utf8') });
      else if (name.endsWith('.html')) {
        const html = readFileSync(path, 'utf8');
        for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
          out.push({ file: path, css: block[1]! });
        }
      }
    }
  };
  walk(BUILD);
  return out;
}

describe('right-to-left is not broken by the stylesheet', () => {
  const styles = everyStyle();

  it('finds stylesheets to check, so a passing run means something', () => {
    // Without this the suite passes perfectly against an empty build directory, which is
    // the failure mode of every test that scans for absence.
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.some((s) => s.css.includes('inline-start'))).toBe(true);
  });

  for (const property of PHYSICAL) {
    it(`uses no ${property}`, () => {
      const offenders = styles
        .filter((s) => s.css.replace(/\s*:\s*/g, ':').includes(property))
        .map((s) => s.file.replace(BUILD, ''));
      expect([...new Set(offenders)]).toEqual([]);
    });
  }
});

describe('the document states its direction', () => {
  it('sets lang and dir on every prerendered page', async () => {
    // Logical properties are inert without this. `border-inline-start` resolves to the left
    // in `ltr` and the right in `rtl`, so a page that states no direction gets the
    // left-hand layout regardless of what language it is written in -- which is the exact
    // failure the properties were changed to avoid.
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === 'index.html') pages.push(path);
      }
    };
    walk(BUILD);

    expect(pages.length).toBeGreaterThan(0);

    // Collected rather than asserted per page, and matched against the opening tag rather
    // than the whole document: two expect() calls against 15kB of HTML, 12,329 times over,
    // took 24s and timed out. Same offenders-list shape the tests above already use.
    const offenders: string[] = [];
    for (const [i, page] of pages.entries()) {
      /*
       * Yielded, because passing is not the same as behaving.
       *
       * This scan stays inside its budget and still starved Vitest's reporter: a tight
       * synchronous loop over 12,329 files holds the event loop for ~45s, the `onTaskUpdate`
       * RPC heartbeat goes unanswered, and the run fails with an unhandled error while every
       * test in it passed. A timeout stops a test dying on the clock; it does nothing about a
       * test that never lets the runner speak.
       */
      if (i % 500 === 0) await new Promise((r) => setImmediate(r));
      const head = readFileSync(page, 'utf8').slice(0, 2048);
      const tag = head.match(/<html[^>]*>/)?.[0] ?? '';
      if (!/\blang=/.test(tag)) offenders.push(`${page.replace(BUILD, '')}: no lang`);
      if (!/\bdir=/.test(tag)) offenders.push(`${page.replace(BUILD, '')}: no dir`);
    }
    expect(offenders).toEqual([]);
  }, 120_000);
});
