/**
 * The documentation surface.
 *
 * The Journalist asks to see that the system works without seeing who is in it, and the
 * Skeptic will not install anything before reading what leaves his phone. For both, the
 * documentation *is* the auditable surface — so it is published rather than left in a
 * repository.
 *
 * Rendered at build time, so it costs the reader zero JavaScript.
 *
 * ## Why this lives under `server/`
 *
 * It used to sit in `$lib` and be imported by universal `+page.ts` loads, which put it in the
 * client module graph: `marked` plus every markdown file in the repository, emitted as one
 * **332.9 kB gzipped chunk**. The pages were `csr = false`, so nothing ever downloaded it — but
 * only because no client-rendered page happened to link to `/docs/`. The first link from the
 * console or Com would have turned it into a real download on a congested cell.
 *
 * `$lib/server` is enforced by SvelteKit: importing it from client code is a build error. So
 * this is no longer a convention somebody has to remember. [build-order 11.0]
 */

import { marked } from 'marked';

/**
 * Where documents that have no page here point instead — CLAUDE.md, the seed CSV, anything
 * above docs/. Override with PUBLIC_REPO_URL if the repository moves again; GitHub will
 * redirect a renamed repo, but a link that needs a redirect to work is a link that will
 * break the day someone claims the old name.
 */
const REPO =
  (process.env.PUBLIC_REPO_URL ?? 'https://github.com/Jthora/navcom-app') + '/blob/main';

const files = import.meta.glob('../../../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

/**
 * Root-level documents that belong to the reader rather than to the repository. Both are
 * addressed to someone who found the directory and wants to correct it or reuse it, so
 * leaving them where only a git clone reaches would defeat the point of writing them.
 *
 * They stay at the repository root because that is where a code host looks for them.
 */
const rootFiles = import.meta.glob(['../../../../CONTRIBUTING.md', '../../../../LICENSING.md'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

export interface DocPage {
  /** URL slug, e.g. "product/identity". */
  slug: string;
  title: string;
  html: string;
}

function slugOf(path: string): string {
  return path.replace(/^.*\/docs\//, '').replace(/\.md$/, '');
}

/** Root documents get a lowercase slug and sit alongside the rest. */
function rootSlugOf(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.md$/, '').toLowerCase();
}

function titleOf(markdown: string, slug: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : slug;
}

/**
 * Rewrites in-repo relative links.
 *
 * A link to another published document becomes a site route. Anything else — CLAUDE.md,
 * the seed CSV, anything above docs/ — points at the source on the repository host, so a
 * reader following a reference lands on the real file rather than a 404.
 */
function rewriteLinks(
  html: string,
  slug: string,
  known: Set<string>,
  /** Directory of the source file relative to the repo root: 'docs', 'docs/product', ''. */
  base: string
): string {
  const dir = base;

  return html.replace(/href="([^"]*)"/g, (whole, href: string) => {
    if (/^(https?:|mailto:|#|\/)/.test(href)) return whole;

    const [file, hash] = href.split('#');
    if (!file) return whole;

    const parts = (dir ? `${dir}/${file}` : file).split('/');
    const out: string[] = [];
    let aboveDocs = 0;
    for (const p of parts) {
      if (p === '.' || p === '') continue;
      if (p === '..') {
        if (out.length) out.pop();
        else aboveDocs++;
      } else out.push(p);
    }
    const resolved = out.join('/');

    // Resolved is now relative to the repo root for every caller.
    if (aboveDocs === 0 && resolved.endsWith('.md')) {
      const withoutDocs = resolved.replace(/^docs\//, '');
      const target = resolved.startsWith('docs/')
        ? withoutDocs.replace(/\.md$/, '')
        : resolved.replace(/\.md$/, '').toLowerCase();
      if (known.has(target)) return `href="/docs/${target}/${hash ? `#${hash}` : ''}"`;
    }

    return `href="${REPO}/${resolved}"`;
  });
}

let cache: DocPage[] | null = null;

export function allDocs(): DocPage[] {
  if (cache) return cache;

  const entries = [
    ...Object.entries(files).map(([path, raw]) => {
      const slug = slugOf(path);
      const dir = slug.includes('/') ? `docs/${slug.slice(0, slug.lastIndexOf('/'))}` : 'docs';
      return { slug, raw, base: dir };
    }),
    ...Object.entries(rootFiles).map(([path, raw]) => ({
      slug: rootSlugOf(path),
      raw,
      base: ''
    }))
  ];
  const known = new Set(entries.map((e) => e.slug));

  cache = entries
    .map(({ slug, raw, base }) => ({
      slug,
      title: titleOf(raw, slug),
      html: rewriteLinks(marked.parse(raw, { async: false }) as string, slug, known, base)
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return cache;
}

export function docBySlug(slug: string): DocPage | undefined {
  return allDocs().find((d) => d.slug === slug);
}

/** Grouped for the index: top-level pages first, then each subdirectory. */
export function docGroups(): { group: string; pages: DocPage[] }[] {
  const groups = new Map<string, DocPage[]>();
  for (const doc of allDocs()) {
    const g = doc.slug.includes('/') ? doc.slug.split('/')[0] : '';
    groups.set(g, [...(groups.get(g) ?? []), doc]);
  }
  const order = ['', 'spec', 'watch', 'product', 'research'];
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([group, pages]) => ({ group, pages }));
}
