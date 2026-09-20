/**
 * Strips what a zero-JavaScript page cannot use from the prerendered directory.
 *
 * Two transforms, both content-preserving:
 *
 *  - **Hydration markers.** Svelte emits `<!--[-->`, `<!--]-->` and friends so the client can
 *    resume a server-rendered tree. `src/routes/+layout.ts` sets `csr = false`, so the public
 *    site ships no client runtime and nothing ever resumes anything. They are inert bytes.
 *  - **Indentation.** Template whitespace, collapsed to a single space — never removed, because
 *    `<span>7701 Rannells Ave</span> <span>checked 14 Sep</span>` with the space taken out is
 *    two words welded together. A single space reads identically and costs one byte.
 *
 * Together, ~13% of the directory's bytes. Worth having on an account near its storage cap,
 * where every retained deployment carries a copy.
 *
 * **Only `/directory/`.** The root console, `/who/` and the whole field terminal set
 * `csr = true`: their markers are load-bearing and this must never touch them. The directory
 * is 151 MB of the 288 MB build in any case.
 *
 * Runs after `build`, before anything that reads the output — the tests that assert against
 * built HTML then assert against what actually ships.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../build/', import.meta.url));

/** Prerendered with `csr = false`. Nothing here hydrates. */
const SLIM = ['directory'];

/**
 * Svelte's hydration markers, and nothing else.
 *
 * Deliberately not "every comment": a conditional comment (`<!--[if ...]>`) is markup a
 * browser acts on, and the licence and provenance comments in the page source are there for
 * whoever reads it. This matches the anonymous block markers only.
 */
const MARKER = /<!--\[-?[0-9!]*--><!--|<!--\[-?[0-9!]*-->|<!--\]-->|<!---->/g;

/** @param {string} html */
export function slim(html) {
  return html.replace(MARKER, '').replace(/\s+/g, ' ');
}

/** @param {string} dir @returns {{ files: number, before: number, after: number }} */
function walk(dir) {
  let files = 0;
  let before = 0;
  let after = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = walk(path);
      files += inner.files;
      before += inner.before;
      after += inner.after;
    } else if (entry.name.endsWith('.html')) {
      const html = readFileSync(path, 'utf8');
      const out = slim(html);
      if (out !== html) writeFileSync(path, out);
      files++;
      before += Buffer.byteLength(html);
      after += Buffer.byteLength(out);
    }
  }
  return { files, before, after };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let files = 0;
  let before = 0;
  let after = 0;
  for (const name of SLIM) {
    try {
      const done = walk(join(BUILD, name));
      files += done.files;
      before += done.before;
      after += done.after;
    } catch (err) {
      // A missing tree is a build that changed shape, not a reason to fail a deploy.
      console.warn(`[slim] ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const saved = before - after;
  console.log(
    `[slim] ${files} page(s), ${(before / 1024 / 1024).toFixed(1)} MB → ` +
      `${(after / 1024 / 1024).toFixed(1)} MB (${(saved / 1024 / 1024).toFixed(1)} MB, ` +
      `${before ? ((100 * saved) / before).toFixed(1) : '0'}% less in every retained deployment)`
  );
}
