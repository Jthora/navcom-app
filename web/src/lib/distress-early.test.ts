/**
 * The prerendered `Distress` is shown where it is parsed, on every page that carries one
 * [invariant 2; hooks.server.ts REVEAL].
 *
 * Read from the built pages, because the reveal is put there by the hook at prerender and the
 * source has no trace of it. The landing page's reveal ended its 158 kB body, so on a slow
 * connection the browser painted the map and the search for 2.4 s with no Distress on them, and
 * every test against the logic passed: the logic was right, and where the output put it was not.
 * `e2e/distress-before-hydration.spec.ts` measures the paint; this pins the cause.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { describe, expect, it } from 'vitest';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));
const ROUTES = fileURLToPath(new URL('../routes/', import.meta.url));

/** Each built page whose route carries a prerendered Distress, found the way the e2e spec finds them. */
const PAGES = (readdirSync(ROUTES, { recursive: true }) as string[])
  .filter((f) => /(^|[\\/])\+page\.svelte$/.test(f) && readFileSync(ROUTES + f, 'utf8').includes('id="distress-early"'))
  .map((f) => [...f.split(/[\\/]/).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)), 'index.html'].join('/'))
  .sort();

describe('the early Distress, as the host serves it', () => {
  it('is on the landing page and the terminal, at least', () => {
    expect(PAGES).toEqual(expect.arrayContaining(['index.html', 'terminal/index.html']));
  });

  for (const file of PAGES) {
    it(`${file}: is revealed by a classic inline script inside it, after the link, and by nothing at the end of the page`, () => {
      const raw = readFileSync(BUILD + file, 'utf8');
      const early = parse(raw).querySelector('#distress-early');
      expect(early, 'no prerendered Distress').not.toBeNull();
      expect(early!.hasAttribute('hidden'), 'shown to a device with no operator').toBe(true);

      const scripts = early!.querySelectorAll('script');
      expect(scripts, 'nothing inside the control reveals it').toHaveLength(1);
      const reveal = scripts[0]!;
      // Inline and classic: a source would be a request, and a module would wait for the parse to end.
      expect(reveal.getAttribute('src')).toBeUndefined();
      expect(reveal.getAttribute('type')).toBeUndefined();
      expect(reveal.textContent).toContain("getElementById('distress-early').hidden=false");
      // Only for somebody with a key on this device.
      expect(reveal.textContent).toContain('.secret');
      // After the link, so the control is there the moment it shows.
      const children = early!.childNodes.filter((n) => n.nodeType === 1);
      expect(children.at(-1)).toBe(reveal);
      expect(early!.querySelector('a[href="/terminal/distress/"]')).not.toBeNull();

      // One place reveals it before the bundle: a second, later copy would hide a broken first.
      expect(raw.split('distress-early').length - 1, 'the page names the early copy outside it').toBe(2);
    });
  }
});
