/**
 * What the landing page may ask outside navcom.app and the relays, held in four places at once:
 * `outside.ts`, which asks; the root's `Content-Security-Policy` in `vercel.json`, which the browser
 * enforces; `docs/product/what-leaves.md`, which tells a person; and the landing page's "talks to
 * nobody" test, which names the same hosts [e2e/landing.spec.ts].
 *
 * The policy is the root's alone. `/terminal/who` checks a proof on api.github.com or any Mastodon
 * instance a card names, so a site-wide list of four hosts would break it, and the policy would ride
 * into the terminal on any link SvelteKit followed without a reload: so every link out of the root
 * reloads, and that is checked here against the built page. **And every link into it reloads**, from
 * each page that runs the client router: the root followed into without one opens under that page's
 * headers, and its own policy never arrives.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { describe, expect, it } from 'vitest';
import { HAZARD_FEEDS, NWS, OUTSIDE_HOSTS } from './outside';

const VERCEL = fileURLToPath(new URL('../../../vercel.json', import.meta.url));
const WHAT_LEAVES = fileURLToPath(new URL('../../../docs/product/what-leaves.md', import.meta.url));
const ROOT_HTML = fileURLToPath(new URL('../../build/index.html', import.meta.url));
const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));
const ERROR_PAGE = fileURLToPath(new URL('../routes/+error.svelte', import.meta.url));

type El = ReturnType<typeof parse>;
/** A link SvelteKit follows with a full load: it, or something around it, says `data-sveltekit-reload`. */
const reloads = (el: El) => {
  for (let at: El | null = el; at; at = at.parentNode as El | null) {
    if (at.getAttribute?.('data-sveltekit-reload') !== undefined) return true;
  }
  return false;
};
const htmlUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? htmlUnder(full) : entry.endsWith('.html') ? [full] : [];
  });

interface Rule {
  source: string;
  headers: { key: string; value: string }[];
}
const rules = (): Rule[] => (JSON.parse(readFileSync(VERCEL, 'utf8')) as { headers: Rule[] }).headers;
const policyOf = (source: string) =>
  rules()
    .filter((r) => r.source === source)
    .flatMap((r) => r.headers)
    .find((h) => h.key.toLowerCase() === 'content-security-policy')?.value ?? null;

describe('the root’s Content-Security-Policy', () => {
  it('lets the root connect to itself, to relays, and to exactly the hosts outside.ts asks', () => {
    const policy = policyOf('/');
    expect(policy, 'vercel.json gives the root no Content-Security-Policy').not.toBeNull();
    const directives = policy!.split(';').map((d) => d.trim()).filter(Boolean);
    // connect-src only: the inline Distress bootstrap and SvelteKit's start script are not touched.
    expect(directives.map((d) => d.split(/\s+/)[0])).toEqual(['connect-src']);
    const sources = directives[0]!.split(/\s+/).slice(1);
    const hosts = sources.filter((s) => s.startsWith('https://')).map((s) => new URL(s).host);
    expect(hosts.sort()).toEqual([...OUTSIDE_HOSTS].sort());
    // Relays are chosen by operators, so sockets stay open by scheme; nothing else is.
    expect(sources.filter((s) => !s.startsWith('https://')).sort()).toEqual(["'self'", 'wss:', 'ws:'].sort());
    expect(sources, 'a wildcard source lets the page ask anybody').not.toContain('*');
    expect(sources).not.toContain('https:');
    expect(sources).not.toContain('http:');
    // The root's alone, so /terminal/who can still check a proof wherever a card says it is.
    const elsewhere = rules().filter((r) => r.source !== '/' && r.headers.some((h) => h.key.toLowerCase() === 'content-security-policy'));
    expect(elsewhere.map((r) => r.source)).toEqual([]);
  });

  it('names the hosts what-leaves.md tells a person about, and only those', () => {
    const section = readFileSync(WHAT_LEAVES, 'utf8').split('## What it asks anyone else, only when you choose')[1]?.split('\n## ')[0];
    expect(section, 'what-leaves.md has no section for what it asks anybody else').toBeDefined();
    const named = [...section!.matchAll(/`([a-z0-9-]+(?:\.[a-z0-9-]+)+)`/g)].map((m) => m[1]!).filter((h) => !h.endsWith('navcom.app') && !/\.(json|ts|md|mjs|svelte)$/.test(h));
    expect([...new Set(named)].sort()).toEqual([...OUTSIDE_HOSTS].sort());
    expect(section).toMatch(/not where you are looking/);
    expect(HAZARD_FEEDS.map((f) => f.host)).toEqual(['earthquake.usgs.gov', 'eonet.gsfc.nasa.gov', 'www.gdacs.org']);
    expect(NWS.host).toBe('api.weather.gov');
  });
});

describe('the root page, as built', () => {
  it('reloads on every link out of it, so the root’s policy never governs another page', () => {
    if (!existsSync(ROOT_HTML)) throw new Error('No build output. Run `npm run build` first.');
    const root = parse(readFileSync(ROOT_HTML, 'utf8'));
    const out = root.querySelectorAll('a[href]').filter((a) => {
      const href = a.getAttribute('href') ?? '';
      return href.startsWith('/') && !href.startsWith('//') && href !== '/' && !href.startsWith('/#');
    });
    expect(out.length, 'no links out of the root were found, so this would pass on nothing').toBeGreaterThan(3);
    expect(out.filter((a) => !reloads(a)).map((a) => a.getAttribute('href'))).toEqual([]);
    // And the screens Com draws into the page later, after it was built: one wrapper holds them all.
    expect(root.querySelector('.landing')?.getAttribute('data-sveltekit-reload')).toBe('');
  });

  it('is reached by a reload from every page that runs the client router, so it never opens under another page’s headers', () => {
    if (!existsSync(ROOT_HTML)) throw new Error('No build output. Run `npm run build` first.');
    // The pages that run SvelteKit's router, as built: the terminal's, and /who on the public site.
    const pages = [join(BUILD, 'who/index.html'), ...htmlUnder(join(BUILD, 'terminal'))];
    const into: string[] = [];
    const without: string[] = [];
    for (const file of pages) {
      const html = readFileSync(file, 'utf8');
      if (!html.includes('_app/immutable/entry') || !html.includes('href="/"')) continue;
      for (const a of parse(html).querySelectorAll('a[href="/"]')) {
        into.push(relative(BUILD, file));
        if (!reloads(a)) without.push(`${relative(BUILD, file)}: ${a.text.trim()}`);
      }
    }
    expect(into, 'no link into the root was found on a page with the router, so this would pass on nothing').toContain('who/index.html');
    expect(into).toContain('terminal/index.html');
    expect(without).toEqual([]);
    // The error page is drawn only by the router, after a load fails, so no build holds it: its source does.
    const error = parse(readFileSync(ERROR_PAGE, 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''));
    const links = error.querySelectorAll('a[href="/"]');
    expect(links.length, '+error.svelte has no link into the root, so this would pass on nothing').toBeGreaterThan(0);
    expect(links.filter((a) => !reloads(a)).map((a) => a.text.trim())).toEqual([]);
  });
});
