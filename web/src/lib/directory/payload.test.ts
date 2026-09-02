import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDirectory } from './index';

/**
 * Every page carries its own records and nobody else's.
 *
 * Two separate defects, found together, both invisible on screen.
 *
 * **Pages that show no records were shipping all of them.** `load.ts` globs every
 * `resources.csv` eagerly at module scope, and a glob's side effect is the import itself, so
 * nothing tree-shakes. `terminal/find` renders a list of region names, reads no record, and
 * shipped all 507 -- 41 kB gzipped, on the heaviest page in the app. `terminal/card` too. A
 * second route in was quieter: `load.ts` re-exports the label tables from `@navcom/core` as a
 * convenience, so four components pulled the entire directory to format a field label.
 *
 * **Region pages were split for the HTML and not for the bundle.** `[region]/+page.ts` said in
 * its own comment that a St. Louis patrol has no use for Sydney's shelters -- and that was true
 * of the prerendered HTML and false of the JavaScript beside it. A *universal* loader runs in
 * the browser as well as at build time, so `import { loadDirectory }` put every region's
 * records in the client graph of all 67 region pages. Making it `+page.server.ts` confines it
 * to build time and serialises one region's data beside its page.
 *
 * Both are asserted against the **built artifact** rather than the import graph, because in
 * both cases a module honoured a constraint its bundle did not. Only the output settles it.
 *
 * **Every scan reads its file once, outside the loop over names.** The first version read it
 * *inside* the filter -- once per candidate -- which was merely wasteful at 507 records and
 * timed out the suite at 1,145. A guard that gets slower as the directory grows is a guard
 * somebody eventually deletes, and this one is the only thing standing between a convenient
 * re-export and 41 kB of shelter records on the heaviest page in the app.
 */

const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));

/** Every JS file a page's HTML references, resolved against the build root. */
function scriptsFor(page: string): string[] {
  const html = readFileSync(join(BUILD, page), 'utf8');
  const refs = html.match(/_app\/immutable\/[a-z]+\/[A-Za-z0-9_-]+\.js/g) ?? [];
  return [...new Set(refs)].map((r) => join(BUILD, r)).filter((p) => existsSync(p));
}

/**
 * Record names distinctive enough that finding one means that region's data is present.
 *
 * Read from the committed data rather than hardcoded, so this cannot rot into testing a
 * shelter that has since been removed. Names carrying quotes or backslashes are skipped
 * because they are re-encoded in the output and would not match verbatim.
 */
function namesIn(region: string): string[] {
  return loadDirectory()
    .filter((r) => r.region === region)
    .map((r) => r.name)
    .filter((n) => n.length > 18 && !/["\\]/.test(n))
    .slice(0, 30);
}

const ALL_NAMES = () =>
  loadDirectory()
    .map((r) => r.name)
    .filter((n) => n.length > 18 && !/["\\]/.test(n));

/** Pages whose job is navigation, not records. */
const NO_RECORDS = ['terminal/find/index.html', 'terminal/card/index.html'];

/** Two regions with records, far enough apart that neither belongs on the other's page. */
const HERE = 'los-angeles';
const ELSEWHERE = 'st-louis';

describe('what each page actually ships', () => {
  it('has a build to measure, with records in it', () => {
    // Without this the whole file passes vacuously, which is the first failure mode a test
    // that reads the build has to guard against.
    expect(existsSync(join(BUILD, 'terminal/find/index.html'))).toBe(true);
    expect(namesIn(HERE).length).toBeGreaterThan(10);
    expect(namesIn(ELSEWHERE).length).toBeGreaterThan(5);
  });

  for (const page of NO_RECORDS) {
    it(`${page} ships no directory records`, () => {
      const names = ALL_NAMES();
      const offenders: string[] = [];
      for (const script of scriptsFor(page)) {
        const body = readFileSync(script, 'utf8');
        const found = names.filter((n) => body.includes(n));
        if (found.length > 0) {
          offenders.push(`${script.replace(BUILD, '')} carries ${found.length}, e.g. "${found[0]}"`);
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([]);
    });
  }

  it('a region page carries its own records', () => {
    /*
     * The positive control, and a correctness check in its own right. Records moved out of the
     * bundle and into the page's serialised data; if that had silently produced empty pages,
     * every negative assertion here would still pass.
     */
    const html = readFileSync(join(BUILD, `terminal/directory/${HERE}/index.html`), 'utf8');
    const present = namesIn(HERE).filter((n) => html.includes(n));
    expect(present.length).toBeGreaterThan(10);
  });

  it('a region page carries no other region\'s records', () => {
    // The actual promise: an operator's phone caches their metro, not the whole world.
    const html = readFileSync(join(BUILD, `terminal/directory/${HERE}/index.html`), 'utf8');
    const scripts = scriptsFor(`terminal/directory/${HERE}/index.html`);
    const foreign = namesIn(ELSEWHERE);

    const inHtml = foreign.filter((n) => html.includes(n));
    expect(inHtml, `${HERE} page names ${ELSEWHERE} records: ${inHtml[0] ?? ''}`).toEqual([]);

    const inJs = scripts.filter((s) => {
      const body = readFileSync(s, 'utf8');
      return foreign.some((n) => body.includes(n));
    });
    expect(inJs.map((s) => s.replace(BUILD, ''))).toEqual([]);
  });

  it('no script anywhere in the build carries the directory', () => {
    /*
     * The strongest form, and cheap now that it is true: records reach a browser as one
     * region's serialised page data, never as a shared chunk. A universal loader reintroduced
     * anywhere would break this before it broke anything a person could see.
     */
    const names = ALL_NAMES().slice(0, 60);
    const pages = ['terminal/index.html', `terminal/directory/${HERE}/index.html`, 'terminal/find/index.html'];
    const scripts = [...new Set(pages.flatMap(scriptsFor))];
    const carrying = scripts
      .filter((s) => {
        const body = readFileSync(s, 'utf8');
        return names.some((n) => body.includes(n));
      })
      .map((s) => s.replace(BUILD, ''));
    expect(carrying).toEqual([]);
  });
});
