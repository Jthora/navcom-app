/**
 * The landing page alone draws edge to edge (hooks.server.ts, com.md §3): it asks for
 * `viewport-fit=cover`, so the map paints under the system bars and a camera's cutout, and it keeps
 * everything read or tapped inside the safe areas it is given. No other page is written against those
 * areas, so no other page may ask. Read from the build, because the tag is the host's doing, not a
 * component's: Capacitor's shell reads the last viewport tag on each load to decide whether to hand the
 * page the safe areas or pad the whole app with bars, so there must be exactly one.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { describe, expect, it } from 'vitest';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));
const ROUTES = fileURLToPath(new URL('../routes/', import.meta.url));

/** Each static route's built page, the way the early Distress test finds them: the dynamic ones are left out. */
const PAGES = (readdirSync(ROUTES, { recursive: true }) as string[])
  .filter((f) => /(^|[\\/])\+page\.svelte$/.test(f) && !/\[/.test(f))
  .map((f) => [...f.split(/[\\/]/).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)), 'index.html'].join('/'))
  .filter((f) => existsSync(BUILD + f))
  .sort();

const viewports = (file: string) =>
  parse(readFileSync(BUILD + file, 'utf8'))
    .querySelectorAll('meta[name="viewport"]')
    .map((m) => m.getAttribute('content') ?? '');

describe('drawing edge to edge, as the host serves it', () => {
  it('finds the landing page, the terminal and the public site among the built pages', () => {
    if (!existsSync(BUILD + 'index.html')) throw new Error('No build output. Run `npm run build` first.');
    expect(PAGES).toEqual(expect.arrayContaining(['index.html', 'terminal/index.html', 'terminal/distress/index.html', 'about/index.html']));
  });

  it('the landing page asks for it, in its one viewport tag', () => {
    expect(viewports('index.html')).toEqual(['width=device-width, initial-scale=1, viewport-fit=cover']);
  });

  it('no other page does: each keeps the one default tag, Distress among them', () => {
    const asking = PAGES.filter((f) => f !== 'index.html').flatMap((f) => {
      const tags = viewports(f);
      return tags.length === 1 && !tags[0]!.includes('viewport-fit') ? [] : [`${f}: ${JSON.stringify(tags)}`];
    });
    expect(asking).toEqual([]);
  });
});
