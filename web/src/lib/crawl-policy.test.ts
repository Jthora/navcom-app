/**
 * What this site invites a crawler to do, asserted against what ships.
 *
 * On 2026-10-04 edge requests spiked hard enough to threaten the account the site is served
 * from. Nothing had deployed for twenty-six days, so it was inbound traffic against a crawl
 * surface this site was advertising: **8,429 record pages plus the application shell, every
 * one of them stamped with the build date as `lastmod` on every deploy**, and a 25 MB export
 * reachable by anything with a user agent. `robots.txt` said `Allow: /` beneath a comment
 * claiming everything but the directory was "deliberately not indexable" — the comment was the
 * policy and the file was its opposite.
 *
 * That is the shape of defect this project already knows it makes: a rule the prose honoured
 * and the output did not. So the policy is executable now.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(ROOT + p, 'utf8');

const robots = () => read('web/static/robots.txt');
const vercel = () => JSON.parse(read('vercel.json')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

/** Paths that cost real bandwidth and that no crawler has ever needed. */
const EXPORTS = [
  '/directory.json',
  '/console-regions.json',
  '/console-index/',
  '/__data.json',
  '/_ipfs/',
  // The grid's geometry and its proving-ground page: 55 KB a request, and nothing to index.
  '/grid/'
];

describe('robots.txt', () => {
  it('keeps crawlers off every machine export', () => {
    // `/directory.json` is 25 MB uncompressed and 1.26 MB gzipped — a twentyfold penalty for
    // any client that omits Accept-Encoding, which a hand-rolled scraper routinely does. The
    // same records are on the pages at 3 KB each.
    const text = robots();
    for (const path of EXPORTS) {
      expect(text, `${path} is not disallowed`).toContain(`Disallow: ${path}`);
    }
  });

  it('keeps crawlers out of the application shell', () => {
    // Nothing there renders from a crawl, and it is the heaviest JavaScript on the site.
    expect(robots()).toContain('Disallow: /terminal/');
  });

  it('still lets the directory be found, because that is the point', () => {
    // The refusal list and the positioning both say the directory is meant to be found by
    // somebody looking for a bed. A fix for a traffic spike that hides it would be a worse
    // failure than the spike.
    const text = robots();
    expect(text).toMatch(/^Allow: \/$/m);
    expect(text).not.toMatch(/^Disallow: \/$/m);
    expect(text).not.toMatch(/^Disallow: \/directory\/$/m);
  });

  it('asks for a crawl delay, since some crawlers honour it', () => {
    expect(robots()).toMatch(/^Crawl-delay: \d+$/m);
  });
});

describe('the sitemap', () => {
  const sitemap = () => {
    const p = ROOT + 'web/build/sitemap.xml';
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };

  it('does not advertise a path robots.txt disallows', () => {
    // A sitemap submitting a disallowed URL is a contradiction the crawler resolves by
    // reporting it, and Search Console calls it an error against the whole file.
    const text = sitemap();
    if (!text) return; // Build-dependent; `npm run verify` sequences the build first.
    const disallowed = [...robots().matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1]!);
    for (const path of disallowed) {
      expect(text, `the sitemap advertises ${path}`).not.toContain(`<loc>https://navcom.app${path}`);
    }
  });

  it('never stamps every URL with the same date', () => {
    /*
     * The failure this exists for. Every entry carried the build date, so each deploy told
     * every crawler that all 8,488 URLs had changed — a full re-crawl invited by shipping a
     * stylesheet. A record's `lastmod` is now its own `last_verified`, and absent where there
     * is none: a blank reads unknown, and a fresh date is a claim we cannot support.
     */
    const text = sitemap();
    if (!text) return;
    const dates = [...text.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]!);
    const urls = [...text.matchAll(/<loc>/g)].length;
    expect(urls).toBeGreaterThan(100);
    if (dates.length > 0) {
      expect(new Set(dates).size, 'every lastmod is identical — this is the build date again')
        .toBeGreaterThan(1);
      expect(dates.length).toBeLessThan(urls);
    }
  });
});

describe('cache headers', () => {
  const valueFor = (source: string) =>
    vercel().headers.find((h) => h.source === source)?.headers.find((k) => k.key === 'cache-control')?.value ?? '';

  it('lets an edge hold every export rather than fetching it per region', () => {
    // Vercel caches per edge region, so `max-age=0, must-revalidate` on a 25 MB file means a
    // cold region pulls the whole thing again. Measured: HIT at age 133s, MISS when cold.
    for (const source of ['/directory.json', '/console-regions.json', '/console-index/(.*)', '/_ipfs/(.*)', '/sitemap.xml']) {
      expect(valueFor(source), `${source} has no s-maxage`).toMatch(/s-maxage=\d{4,}/);
    }
  });

  it('matches the TTL the intel declaration publishes, rather than inventing one', () => {
    // `navcom-intel.json` tells a consumer to cache for 3600 seconds. A client-side max-age
    // that disagreed with our own published contract would be two numbers for one policy.
    expect(valueFor('/directory.json')).toContain('max-age=3600');
  });

  it('keeps a record page revalidating in the browser, so nobody reads a stale bed', () => {
    // The edge may hold it; the operator's browser may not. Volatile fields already suppress
    // themselves by age, and this is the same rule one layer out.
    expect(valueFor('/directory/(.*)')).toContain('max-age=0');
    expect(valueFor('/directory/(.*)')).toContain('must-revalidate');
  });

  it('tells a crawler not to index the exports, in case it fetched one anyway', () => {
    // robots.txt asks a crawler not to fetch. This is the half that applies to the ones that do
    // it regardless: `noindex` keeps a 16 MB JSON file out of a search result even when the
    // request happened.
    const headerFor = (source: string) =>
      vercel().headers.find((h) => h.source === source)?.headers ?? [];
    for (const source of ['/directory.json', '/console-regions.json', '/console-index/(.*)', '/_ipfs/(.*)']) {
      const tag = headerFor(source).find((k) => k.key === 'x-robots-tag')?.value;
      expect(tag, `${source} can still be indexed`).toBe('noindex');
    }
  });

  it('leaves the deploy stamp revalidating, because that is what it is for', () => {
    expect(valueFor('/version.json')).toBe('public, max-age=0, must-revalidate');
    expect(valueFor('/version.json')).not.toContain('s-maxage');
  });
});
