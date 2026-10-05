import { loadDirectory } from '$lib/directory/load';
import { allDocs } from '$lib/docs';

export const prerender = true;

/** Override at build time with PUBLIC_SITE_ORIGIN if the site is served elsewhere. */
const ORIGIN = (process.env.PUBLIC_SITE_ORIGIN ?? 'https://navcom.app').replace(/\/$/, '');

/**
 * ISO date, or null. A record's own `last_verified` is the only honest `lastmod` it has.
 *
 * **Every URL used to carry the build date.** All 8,488 of them, rewritten on every deploy —
 * which told every crawler that the entire site had changed and invited a complete re-crawl of
 * 8,429 record pages each time anything shipped. A record whose hours were checked in July did
 * not change because a stylesheet did, and saying so cost us the crawl budget of a site a
 * thousand times our size.
 *
 * No date is better than a wrong one here, exactly as it is in the directory itself: a blank
 * reads *unknown* and a crawler decides for itself, where a fresh date is a claim we cannot
 * support.
 */
const dateOf = (value: string | undefined): string | null =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;

export function GET() {
  /*
   * `/terminal/` is deliberately absent.
   *
   * It is the application shell: a screen that renders from local state and has nothing an
   * index can usefully hold. Submitting it fetched the heaviest JavaScript on the site for
   * every crawler that honoured the sitemap, and `robots.txt` now disallows it — a sitemap
   * that advertises a disallowed path is a contradiction a crawler resolves by complaining.
   */
  const pages = ['/', '/about/', '/directory/', '/status/', '/docs/'];

  const entries: { path: string; lastmod: string | null }[] = [
    ...pages.map((path) => ({ path, lastmod: null })),
    ...loadDirectory().map((r) => ({
      path: `/directory/${r.id}/`,
      lastmod: dateOf(r.last_verified)
    })),
    ...allDocs().map((d) => ({ path: `/docs/${d.slug}/`, lastmod: null }))
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `  <url><loc>${ORIGIN}${e.path}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, { headers: { 'content-type': 'application/xml' } });
}
