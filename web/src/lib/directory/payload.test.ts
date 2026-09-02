import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDirectory } from './index';

/**
 * Pages that do not show records must not ship them.
 *
 * `load.ts` globs every `resources.csv` **eagerly, at module scope**. A glob's side effect is
 * the import itself, so nothing tree-shakes: importing one function from that module pulls the
 * whole directory into the importing page's bundle.
 *
 * That went unnoticed because nothing was wrong on screen. `terminal/find` renders a list of
 * region names and reads no record at all — and it was shipping all 507 of them, 41 kB gzipped
 * of addresses and phone numbers, on the heaviest page in the app. `terminal/card` did the
 * same. The budget script saw one large number and could not say what it was made of.
 *
 * Two routes back in, both plausible:
 *
 * - a page starts needing one region name and imports `$lib/directory/load` because that is
 *   where regions used to live
 * - a component wants a label formatter and imports it from `load.ts`, which **re-exports the
 *   tables from `@navcom/core` as a convenience**. That was the actual second leak: four
 *   components and a page pulled the entire directory to format a field label
 *
 * So this asserts against the **built artifact**, not the import graph. The rule this project
 * keeps relearning is that a module can honour a constraint the bundle does not, and only the
 * output settles it.
 */

const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));

/** Every JS file a page's HTML references, resolved against the build root. */
function scriptsFor(page: string): string[] {
  const html = readFileSync(join(BUILD, page), 'utf8');
  const refs = html.match(/_app\/immutable\/[a-z]+\/[A-Za-z0-9_-]+\.js/g) ?? [];
  return [...new Set(refs)].map((r) => join(BUILD, r)).filter((p) => existsSync(p));
}

/**
 * Record names distinctive enough that finding one in a bundle means the directory is in it.
 *
 * Taken from the committed data rather than hardcoded, so this cannot rot into testing a
 * shelter that has since been removed.
 */
function probeNames(): string[] {
  return loadDirectory()
    .map((r) => r.name)
    .filter((n) => n.length > 18 && !n.includes('"') && !n.includes('\\'))
    .slice(0, 40);
}

/** Pages whose job is navigation, not records. */
const NO_RECORDS = ['terminal/find/index.html', 'terminal/card/index.html'];

describe('what each page actually ships', () => {
  it('has a build to measure', () => {
    // Without this the whole file passes vacuously, which is the failure mode a test that
    // reads the build has to guard against first.
    expect(existsSync(join(BUILD, 'terminal/find/index.html'))).toBe(true);
    expect(probeNames().length).toBeGreaterThan(10);
  });

  for (const page of NO_RECORDS) {
    it(`${page} ships no directory records`, () => {
      const names = probeNames();
      const offenders: string[] = [];
      for (const script of scriptsFor(page)) {
        const body = readFileSync(script, 'utf8');
        const found = names.filter((n) => body.includes(n));
        if (found.length > 0) {
          offenders.push(`${script.replace(BUILD, '')} carries ${found.length} record(s), e.g. "${found[0]}"`);
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([]);
    });
  }

  it('a region page carries records, so the probe is capable of failing', () => {
    /*
     * The negative tests above are worthless if `probeNames` cannot find a record anywhere --
     * a typo in the matcher would make them pass for the wrong reason. This is the positive
     * control: somewhere in the build, these names really are present in a bundle.
     */
    const names = probeNames();
    const scripts = scriptsFor('terminal/directory/los-angeles/index.html');
    const carrying = scripts.filter((s) => {
      const body = readFileSync(s, 'utf8');
      return names.some((n) => body.includes(n));
    });
    expect(carrying.length).toBeGreaterThan(0);
  });
});
