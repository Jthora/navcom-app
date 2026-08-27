import { loadDirectory } from '$lib/directory/load';
import { allDocs } from '$lib/docs';

export const prerender = true;

/** Override at build time with PUBLIC_SITE_ORIGIN if the site is served elsewhere. */
const ORIGIN = (process.env.PUBLIC_SITE_ORIGIN ?? 'https://navcom.app').replace(/\/$/, '');

export function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const paths = [
    '/',
    '/terminal/',
    '/about/',
    '/directory/',
    '/status/',
    '/docs/',
    ...loadDirectory().map((r) => `/directory/${r.id}/`),
    ...allDocs().map((d) => `/docs/${d.slug}/`)
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
  .map((p) => `  <url><loc>${ORIGIN}${p}</loc><lastmod>${today}</lastmod></url>`)
  .join('\n')}
</urlset>
`;

  return new Response(body, { headers: { 'content-type': 'application/xml' } });
}
