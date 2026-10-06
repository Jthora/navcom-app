/**
 * Deletes the `__data.json` files the public site cannot use.
 *
 * ## Why these are dead
 *
 * SvelteKit writes a `__data.json` beside every prerendered page with a server `load`, so its
 * client-side router can fetch the next page's data without a full navigation. **The public
 * site has no client-side router**: `src/routes/+layout.ts` sets `csr = false`, so those pages
 * ship zero JavaScript and every link is an ordinary browser navigation. Nothing can ever
 * request them — no HTML references one, and there is no router to construct the URL.
 *
 * They are not free. On 2026-09-19 the directory carried 11,546 of them, 15.7 MB, in every
 * deployment Vercel retains, on an account near its storage cap.
 *
 * ## Why only `/directory/` and `/docs/`
 *
 * `csr` is per route. The root console (`/`) and `/who/` set `csr = true`, and the whole
 * field terminal is an app — their data files are fetched at runtime by the router and must
 * stay. Only zero-JavaScript prerendered trees are pruned.
 *
 * `/docs/` joined on 2026-10-06. Its loads moved from universal to server so the markdown corpus
 * would leave the client bundle [build-order 11.0], and a server load is exactly what makes
 * SvelteKit write these: 64 of them, 1.5 MB, each a JSON copy of a page that already exists as
 * HTML — at URLs nothing links to, which is crawler surface and nothing else.
 *
 * Run after `build` and before anything that reads the output.
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../build/', import.meta.url));

/** Prerendered, zero-JavaScript, and therefore unable to fetch anything. */
const PRUNE = ['directory', 'docs'];

/** @param {string} dir @returns {{ files: number, bytes: number }} */
function prune(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = prune(path);
      files += inner.files;
      bytes += inner.bytes;
    } else if (entry.name === '__data.json') {
      bytes += statSync(path).size;
      rmSync(path);
      files++;
    }
  }
  return { files, bytes };
}

let files = 0;
let bytes = 0;
for (const name of PRUNE) {
  const dir = join(BUILD, name);
  try {
    const gone = prune(dir);
    files += gone.files;
    bytes += gone.bytes;
  } catch (err) {
    // A missing tree is a build that changed shape, not a reason to fail a deploy.
    console.warn(`[prune] ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(
  `[prune] ${files} __data.json file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB — the public ` +
    `site has no router to fetch them`
);
