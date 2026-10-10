/**
 * What a page pulls in, walked one way for every figure the budget prints and every boundary a test
 * holds.
 *
 * `budget.mjs` used to carry two walkers over Vite's manifest, written days apart. They disagreed
 * on what to follow, neither counted a stylesheet, and neither had a test, so a figure could move
 * without anyone knowing which walk had moved it. GridMap's CSS and the mission screens' CSS were
 * downloaded on every visit that opened them and counted by nothing. This module is the only walk now.
 *
 * Plain `.mjs` and no `process.exit`, so the budget script and the vitest suite import the same
 * code. A test of a copy proves nothing about the thing that runs.
 *
 * The graph is Vite's manifest, which names chunks rather than modules: `imports` and
 * `dynamicImports` hold manifest keys, `css` holds emitted file paths, and `file` is where each key
 * landed in `build/`. Every path this module returns is relative to the build root, e.g.
 * `_app/immutable/chunks/Cm_76OO_.js`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';

/**
 * @typedef {{
 *   file: string,
 *   name?: string,
 *   src?: string,
 *   isEntry?: boolean,
 *   isDynamicEntry?: boolean,
 *   imports?: string[],
 *   dynamicImports?: string[],
 *   css?: string[]
 * }} ManifestEntry
 * @typedef {Record<string, ManifestEntry>} Manifest
 * @typedef {{ keys: Set<string>, files: Set<string>, sheets: Set<string> }} Closure
 *
 * `sheets` is the part of `files` that arrived only through a chunk's `css` list and never as a
 * manifest entry's own file. The deferred ceiling was derived counting every file reached through
 * an import and following no `css` list, so those stylesheets are the one part a caller can report
 * beside that figure without changing what it means.
 */

/**
 * The manifest, or null. A build without one has nothing to say about what loads later, and that
 * is not an error.
 *
 * @param {string} path
 * @returns {Manifest | null}
 */
export function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** @type {WeakMap<Manifest, Map<string, string>>} */
const byFile = new WeakMap();

/**
 * The manifest key for a key or an emitted file, or null when the manifest names neither.
 *
 * @param {Manifest} manifest
 * @param {string} ref
 * @returns {string | null}
 */
export function keyOf(manifest, ref) {
  if (Object.hasOwn(manifest, ref)) return ref;
  let index = byFile.get(manifest);
  if (!index) {
    index = new Map();
    for (const [key, entry] of Object.entries(manifest)) if (!index.has(entry.file)) index.set(entry.file, key);
    byFile.set(manifest, index);
  }
  return index.get(ref) ?? null;
}

/**
 * Everything `keys` pull in, transitively: each one's own file, its stylesheets, its static imports
 * and, unless `dynamic` is false, what it loads later by `import()`.
 *
 * `exclude` is what is neither counted nor walked through: what the page already has, or another
 * route's page, which is the router's to load on navigation and not this page's. Keys and emitted
 * files are both accepted there and in `keys`, because the HTML names files and the manifest names
 * keys.
 *
 * A stylesheet is counted once however it is reached, through a chunk's `css` list or through a
 * manifest entry of its own. A file the manifest does not know, passed in `keys`, is returned as
 * it is: it is what the caller said the page loads. One named in a chunk's `imports` and missing
 * from the manifest is skipped, as both old walkers did, because it names nothing on disk.
 *
 * @param {Manifest} manifest
 * @param {Iterable<string>} keys
 * @param {Iterable<string>} [exclude]
 * @param {{ dynamic?: boolean }} [options]
 * @returns {Closure}
 */
export function closure(manifest, keys, exclude = [], { dynamic = true } = {}) {
  /** @type {Set<string>} */
  const skip = new Set();
  for (const ref of exclude) {
    skip.add(ref);
    const key = keyOf(manifest, ref);
    if (key !== null) {
      skip.add(key);
      skip.add(manifest[key].file);
    }
  }

  /** @type {Closure} */
  const out = { keys: new Set(), files: new Set(), sheets: new Set() };
  /** Reached through a `css` list, and reached as some entry's own file. */
  const listed = new Set();
  const owned = new Set();
  /** @type {Array<[string, 'start' | 'key' | 'file']>} */
  const pending = [];
  for (const ref of keys) pending.push([ref, 'start']);

  while (pending.length > 0) {
    const [ref, kind] = /** @type {[string, 'start' | 'key' | 'file']} */ (pending.pop());
    if (skip.has(ref)) continue;
    const key = kind === 'file' ? null : keyOf(manifest, ref);
    if (key === null) {
      if (kind !== 'key') out.files.add(ref);
      if (kind === 'file') listed.add(ref);
      continue;
    }
    if (out.keys.has(key) || skip.has(key)) continue;
    const entry = manifest[key];
    if (skip.has(entry.file)) continue;
    out.keys.add(key);
    out.files.add(entry.file);
    owned.add(entry.file);
    for (const css of entry.css ?? []) pending.push([css, 'file']);
    for (const dep of entry.imports ?? []) pending.push([dep, 'key']);
    if (dynamic) for (const dep of entry.dynamicImports ?? []) pending.push([dep, 'key']);
  }
  for (const f of listed) if (!owned.has(f)) out.sheets.add(f);
  return out;
}

/**
 * SvelteKit's route nodes: one per page and layout. Another route's node is loaded by the router on
 * navigation, so a walk that measures one page stops there.
 *
 * @param {Manifest} manifest
 * @returns {string[]}
 */
export function routeNodes(manifest) {
  return Object.keys(manifest).filter((key) => key.includes('/nodes/'));
}

/**
 * The manifest's entries: the app, the router and every route node.
 *
 * @param {Manifest} manifest
 * @returns {string[]}
 */
export function entries(manifest) {
  return Object.keys(manifest).filter((key) => manifest[key].isEntry);
}

/**
 * Whether this manifest came from a different build than the one in `build`.
 *
 * Worse than no manifest: the hashes match nothing on disk, every file fails `existsSync`, and a
 * walk reports a confident zero. That is the silent pass this project keeps finding, so it is
 * named rather than filtered away.
 *
 * @param {Manifest} manifest
 * @param {string} build absolute path of the build root
 */
export function isStale(manifest, build) {
  const named = entries(manifest);
  return named.length > 0 && !named.some((key) => existsSync(join(build, manifest[key].file)));
}

/**
 * The stylesheets and scripts a page's HTML names, as build-root-relative paths. External URLs are
 * left out: the CSP blocks them anyway.
 *
 * @param {string} html the page's markup
 * @param {string} page the page's own path, relative to the build root, e.g. `terminal/find/index.html`
 * @returns {string[]}
 */
export function htmlRefs(html, page) {
  /** @type {Set<string>} */
  const found = new Set();
  const re = /(?:href|src)="([^"]+\.(?:css|js))"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref)) continue;
    found.add(ref.startsWith('/') ? ref.slice(1) : posix.normalize(posix.join(posix.dirname(page), ref)));
  }
  return [...found];
}

/**
 * What a page loads before anybody touches it: what its HTML names, and every script those pull in
 * statically.
 *
 * SvelteKit preloads the whole static closure of scripts today, so the two agree. The walk is here
 * so that if they ever stop agreeing the figure follows what a browser fetches: a static import
 * nobody preloaded is still downloaded before the page runs.
 *
 * Stylesheets come from the HTML alone. SvelteKit links a chunk's stylesheet at first paint only
 * when server rendering used it, and leaves the rest for the browser to load when the component
 * first renders [build_server.js, "eagerly load client stylesheets ... imported by the SSR-ed
 * page"]. `terminal/sign-on` imports HeardWhy's chunk and does not link its stylesheet, so counting
 * the walk's CSS there would charge first paint for a file it does not fetch.
 *
 * @param {Manifest | null} manifest
 * @param {Iterable<string>} refs build-root-relative paths the HTML names
 * @returns {Set<string>}
 */
export function firstPaint(manifest, refs) {
  const named = [...refs];
  if (!manifest) return new Set(named);
  const scripts = [...closure(manifest, named, [], { dynamic: false }).files].filter((f) => f.endsWith('.js'));
  return new Set([...named, ...scripts]);
}
