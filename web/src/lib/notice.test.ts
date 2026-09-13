/**
 * The notice is reachable, and still says the things it exists to say.
 *
 * A page about who answers for what is worth nothing if a reader cannot find it, and this
 * project's own rule is that a mechanism nobody can reach is not built. So these run against
 * `build/` rather than against the component: a footer link the layout contains and the output
 * does not is exactly the failure `docs/verification.md` keeps recording.
 *
 * Requires `npm run build` first; `npm run verify` sequences that.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));
const LINK = 'href="/notice/"';

function htmlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? htmlFiles(p) : p.endsWith('.html') ? [p] : [];
  });
}

const page = () => {
  const path = join(BUILD, 'notice/index.html');
  if (!existsSync(path)) throw new Error('No notice page in build/. Run `npm run build` first.');
  return readFileSync(path, 'utf8').replace(/\s+/g, ' ');
};

describe('the notice', () => {
  it('says whose words are whose, before anything else', () => {
    const html = page();
    expect(html).toContain('Everyone here speaks for themselves.');
    expect(html).toContain('NavCom does not review, test, verify or endorse any of it.');
    expect(html).toContain('theirs to answer for');
  });

  it('says what nothing here is', () => {
    expect(page()).toContain('Nothing here is medical, legal or safety advice.');
  });

  it('promises no deletion it cannot perform, and says what its own pages can do', () => {
    // NavCom cannot delete from a relay. What it controls is what its own pages render, and that
    // narrow list is stated with its limit. There is still no reporting channel, so a notice
    // that invited reports would be a claim with nothing behind it.
    const html = page().toLowerCase();
    expect(html).toContain('cannot delete what somebody else published');
    expect(html).toContain('never over a disagreement between operators');
    expect(html).toContain('recorded, with its date');
    expect(html).not.toMatch(/report (it|this|abuse)|we will remove|request removal|takedown/);
  });
});

describe('the notice is reachable', () => {
  it('is linked from every page of the public site', () => {
    const pages = htmlFiles(BUILD)
      .map((p) => relative(BUILD, p).split('\\').join('/'))
      // The terminal is a different instrument with no footer; its screens that show other
      // people's words are checked below. `404.html` is a static file, not a rendered page.
      .filter((p) => !p.startsWith('terminal/') && !p.startsWith('_') && p !== '404.html');

    expect(pages.length, 'no pages found to check').toBeGreaterThan(10);
    const missing = pages.filter((p) => !readFileSync(join(BUILD, p), 'utf8').includes(LINK));
    expect(missing.slice(0, 20), `${missing.length} pages do not link the notice`).toEqual([]);
  }, 120_000);

  it('is linked from the terminal screen that lists other people’s cards', () => {
    const find = readFileSync(join(BUILD, 'terminal/find/index.html'), 'utf8');
    expect(find).toContain(LINK);
  });
});
