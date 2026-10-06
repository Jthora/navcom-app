/**
 * Bundle budget check.
 *
 * "The device floor is a real target, not an aspiration. Check bundle size." — CLAUDE.md
 * Budgets in docs/delivery.md. This fails the build rather than warning, because a budget
 * nobody enforces is a wish.
 *
 * It measures what a browser actually DOWNLOADS for a page — the HTML plus the assets that
 * HTML references — not everything sitting in build/. Those differ sharply here: with
 * client-side rendering off, SvelteKit still emits client chunks that no page ever loads.
 * Counting them would report a payload no reader is ever served.
 */

import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../build/', import.meta.url));

/**
 * Two surfaces, two budgets, and the split is the point.
 *
 * The public site is a document: it must deliver ZERO JavaScript, so a reader with
 * scripting off, an old phone, or a proxy in front of them still gets the directory. That
 * budget is not "small", it is nothing, and it fails on the first byte.
 *
 * The Field Terminal is an application. It needs script to sign, seal and hold state
 * offline.
 *
 * ## Where the terminal's number comes from
 *
 * It used to come from "a prepaid Android 8 with ~400MB free", which was never measured and
 * turned out to be the wrong axis entirely — see `docs/research/device-floor.md`. Measured
 * against the built terminal at a 6x CPU penalty:
 *
 * | bundle | 1.6 Mbps | 0.8 Mbps | 128 kbps |
 * |--------|----------|----------|----------|
 * | 139 kB |  1.81 s  |  3.00 s  |  10.6 s  |
 * | 240 kB |  2.41 s  |  4.05 s  |  17.3 s  |
 *
 * Two findings decide the shape of this budget:
 *
 * - **Bandwidth dominates, not the device.** Doubling the CPU penalty costs 250 ms;
 *   halving bandwidth costs seconds. A budget justified by a slow processor was measuring
 *   the wrong thing
 * - **The cost is paid once.** A repeat visit is ~300 ms on any network and identical
 *   offline, because the service worker has it. This number governs a first install, not a
 *   night on patrol
 *
 * So the budget is derived from a **time**, on the connection that actually degrades:
 *
 *   design point   0.8 Mbps, 6x CPU  — a congested LTE cell, which is where a first
 *                                      install most plausibly happens
 *   target         interactive within 4 s, cold
 *   measured       ~1540 ms fixed + ~1050 ms per 100 kB
 *   → limit        (4000 - 1540) / 1050 * 100  ≈  235 kB, rounded down to 220 kB
 *
 * **Re-derive it rather than nudging it.** The last time this number moved it went from
 * 100 kB to 140 kB with no comment, and the two figures disagreed in two files for months.
 * If 220 is wrong, change the target or the design point and recompute — both are here.
 */

/** Measured coefficients, so the report can state a time and not just a size. */
const COLD_FIXED_MS = 1540;
const COLD_MS_PER_KB = 1050 / 100;

const SURFACES = {
  public: {
    label: 'public site',
    match: (name) =>
      !name.startsWith('terminal/') &&
      name !== 'index.html' &&
      name !== 'who/index.html' &&
      name !== 'grid/index.html',
    js: 0,
    warn: 0,
    page: 250 * 1024
  },
  /**
   * The root console. A sibling of the terminal, not nested under it — it never imports the
   * identity/storage/relay stack that gives every `terminal/*` page its floor, so it carries
   * its own, much smaller budget rather than inheriting one sized for that stack.
   *
   * Re-derived against a real build rather than guessed: measured at 49.7 kB JS / 66.8 kB
   * page total the day this shipped. `js` leaves ~20% headroom over that; `page` leaves more,
   * because — unlike a terminal screen — this page's HTML embeds a search index sized to the
   * whole directory, so its floor grows with real data, not just code.
   */
  root: {
    label: 'root console',
    match: (name) => name === 'index.html',
    js: 60 * 1024,
    warn: 52 * 1024,
    page: 120 * 1024
  },
  /**
   * The grid's proving ground [build-order 11.2], until 11.3 moves the map onto the landing page.
   *
   * Derived, not chosen: measured on 2026-10-06 at **44.9 kB JS / 48.0 kB page**, ~2.0 s to
   * interactive on a congested cell, with ~20% headroom as every surface here gets. Almost all
   * of it is SvelteKit's runtime; the map's own code is 3.1 kB, which is the number 11.3 has to
   * fit inside the console. The 55 kB of geometry is fetched, not referenced, so it is not in
   * these figures — the service worker caches it after the first visit.
   */
  grid: {
    label: 'grid',
    match: (name) => name === 'grid/index.html',
    js: 54 * 1024,
    warn: 49 * 1024,
    page: 58 * 1024
  },
  /**
   * The public roster, which is **not** the same kind of page as the console.
   *
   * They were given one budget on the assumption that they were, and the budget said no at
   * 130%. The console's comment above explains why its number is small: it never imports the
   * identity/storage/relay stack. The roster's entire job is reading signed events from a
   * relay, so it imports exactly that stack and cannot not.
   *
   * Derived rather than chosen to fit: measured at **78.3 kB JS / 82.2 kB page**, which the
   * coefficients above put at ~2.4 s to interactive on a congested cell — well inside the 4 s
   * design point the terminal's own budget is derived from. `js` leaves ~20% headroom, the
   * same margin the console gets.
   *
   * The floor here is signature verification. An unverified card on a public page is a
   * forgery anybody can publish, so the crypto is not the part to trim.
   */
  roster: {
    label: 'public roster',
    match: (name) => name === 'who/index.html',
    js: 95 * 1024,
    warn: 86 * 1024,
    page: 130 * 1024
  },
  terminal: {
    label: 'field terminal',
    match: (name) => name.startsWith('terminal/'),
    /** Hard stop. Derived above: 4 s to interactive at 0.8 Mbps on a cheap phone. */
    js: 220 * 1024,
    /**
     * The ratchet, and the actually useful line.
     *
     * A budget only forces a decision while it is near, and one at 99% forces a *crisis* —
     * which is how the last silent raise happened. This prints loudly and does not fail, so
     * growth is noticed while there is still room to decide what to do about it.
     */
    warn: 160 * 1024,
    page: 260 * 1024
  }
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(BUILD);
} catch {
  console.error('No build/ directory. Run `npm run build` first.');
  process.exit(1);
}

const gz = (p) => gzipSync(readFileSync(p)).length;
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

const htmlFiles = files.filter((f) => f.endsWith('.html'));
const referenced = new Set();

/** Assets pulled by a page: stylesheets, scripts, preloads. */
function assetsOf(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const found = new Set();
  const re = /(?:href|src)="([^"]+\.(?:css|js))"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref)) continue; // external; CSP blocks these anyway
    const abs = ref.startsWith('/')
      ? join(BUILD, ref.slice(1))
      : normalize(join(dirname(htmlPath), ref));
    if (existsSync(abs)) found.add(abs);
  }
  return [...found];
}

const pages = htmlFiles.map((html) => {
  const assets = assetsOf(html);
  assets.forEach((a) => referenced.add(a));
  referenced.add(html);

  let js = 0;
  let css = 0;
  for (const a of assets) {
    const size = gz(a);
    if (a.endsWith('.js')) js += size;
    else css += size;
  }
  const htmlSize = gz(html);
  return { name: relative(BUILD, html), html: htmlSize, css, js, total: htmlSize + css + js };
});

pages.sort((a, b) => b.total - a.total);

let failed = false;

for (const surface of Object.values(SURFACES)) {
  const own = pages.filter((p) => surface.match(p.name));
  if (own.length === 0) continue;

  console.log(`${surface.label} — ${own.length} page(s), gzipped\n`);
  console.log(`  ${'HTML'.padStart(9)} ${'CSS'.padStart(9)} ${'JS'.padStart(9)} ${'TOTAL'.padStart(9)}  page`);
  for (const p of own.slice(0, 6)) {
    console.log(
      `  ${kb(p.html).padStart(9)} ${kb(p.css).padStart(9)} ${kb(p.js).padStart(9)} ${kb(p.total).padStart(9)}  ${p.name}`
    );
  }
  if (own.length > 6) console.log(`  ${`+${own.length - 6} smaller`.padStart(41)}`);

  const worstJs = Math.max(...own.map((p) => p.js));
  const worst = own[0];

  console.log('');
  if (surface.js > 0) {
    // The number that matters, in the unit the budget was derived from. A size means
    // nothing on its own; seconds-to-usable is what somebody standing outside experiences.
    const cold = (COLD_FIXED_MS + (worstJs / 1024) * COLD_MS_PER_KB) / 1000;
    console.log(`  cold first load on a congested cell (0.8 Mbps, cheap phone): ~${cold.toFixed(1)}s to interactive`);
    console.log('  repeat visits and offline are ~0.3s regardless — this governs a first install.\n');
  }
  for (const [label, actual, budget, note] of [
    ['JavaScript', worstJs, surface.js, 'worst page'],
    ['Page total', worst.total, surface.page, worst.name]
  ]) {
    const ok = actual <= budget;
    if (!ok) failed = true;
    const pct = budget === 0 ? (actual === 0 ? 0 : Infinity) : Math.round((actual / budget) * 100);
    const warned = label === 'JavaScript' && ok && surface.warn > 0 && actual > surface.warn;
    console.log(
      `  ${!ok ? 'FAIL' : warned ? 'WARN' : 'PASS'}  ${label.padEnd(11)} ${kb(actual).padStart(9)} / ${kb(budget).padStart(9)}` +
        `  (${pct === Infinity ? 'over' : pct + '%'})  ${note}`
    );
    if (warned) {
      console.log(
        `        past the ${kb(surface.warn)} ratchet. Not a failure — but the next addition is a` +
          `\n        decision, not an accident. Re-derive the limit or take something out.`
      );
    }
  }
  console.log('');
}

/*
 * Weight a page can pull LATER, by dynamic import.
 *
 * Every budget above measures first paint, because `assetsOf` reads what the HTML references and a
 * chunk fetched by `import()` appears in no `src` or `href`. That was correct while nothing
 * code-split, and it is **about to stop being the whole truth**: Com loads its navigation stack,
 * chat and search when somebody opens the sheet [design/com.md §6], so those chunks will be
 * delivered to readers while being invisible to every number here — and the `dead` note below would
 * go on calling them "loaded by no page".
 *
 * Reported rather than enforced, deliberately. There is nothing to enforce against yet, and every
 * budget in this file was **derived from a measurement** rather than chosen to fit. This is how the
 * measurement becomes available before the decision has to be made.
 *
 * The graph comes from Vite's manifest, which records `dynamicImports` per chunk, so no JavaScript
 * is parsed. Missing manifest is not an error: a build without one simply has nothing to say here.
 */
// Resolved from this file, like BUILD, not from the working directory. Run from the repo root, a
// cwd-relative path finds no manifest and the check reports nothing — silently, which is the one way
// this note must never fail.
const MANIFEST = fileURLToPath(
  new URL('../.svelte-kit/output/client/.vite/manifest.json', import.meta.url)
);

function deferredWeight() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }

  // file -> entry, so a chunk found by its emitted name can be walked onward.
  const byFile = new Map();
  for (const entry of Object.values(manifest)) byFile.set(entry.file, entry);

  const reachable = new Set();
  const seen = new Set();

  /** Everything `entry` pulls, statically or dynamically, transitively. */
  const follow = (entry) => {
    if (!entry || seen.has(entry.file)) return;
    seen.add(entry.file);
    for (const dep of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
      const next = manifest[dep] ?? byFile.get(dep);
      if (!next) continue;
      // `file` is already build-root-relative, e.g. `_app/immutable/entry/app.<hash>.js`.
      reachable.add(join(BUILD, next.file));
      follow(next);
    }
  };

  /*
   * A manifest from a different build is worse than none: the hashes do not match anything in
   * `build/`, every path fails `existsSync`, and the check reports a confident zero. That is the
   * silent-pass failure this project keeps finding, so it is named rather than filtered away.
   */
  const entries = Object.values(manifest).filter((e) => e.isEntry);
  if (entries.length > 0 && !entries.some((e) => existsSync(join(BUILD, e.file)))) {
    return { stale: true, files: new Set(), count: 0, bytes: 0 };
  }

  for (const entry of entries) follow(entry);

  // Only what no page already loads at first paint, and only what actually exists on disk.
  const deferred = [...reachable].filter((f) => !referenced.has(f) && existsSync(f));
  const sized = deferred.map((f) => ({ f, bytes: gz(f) })).sort((a, b) => b.bytes - a.bytes);
  return {
    files: new Set(deferred),
    count: deferred.length,
    bytes: sized.reduce((n, x) => n + x.bytes, 0),
    worst: sized[0] ?? null
  };
}

const deferred = deferredWeight();
if (deferred?.stale) {
  console.log(
    `\n  note  the Vite manifest does not match this build, so dynamic-import weight` +
      `\n        could not be measured. Re-run the build.`
  );
} else if (deferred && deferred.count > 0) {
  /*
   * Named, because the point of this note is the one chunk nobody knew about.
   *
   * On 2026-10-06 that was `docs` at 332.9 kB gzipped — more than twice the worst measured page,
   * sitting in the category the previous note called "not delivered to anyone". Whether a client-side
   * navigation ever actually pulls it is not something this script can prove, which is exactly why it
   * reports reachability and stops short of claiming delivery. `directory.json` was the same shape:
   * an artifact no budget was watching, found only once somebody went looking.
   */
  const worst = deferred.worst ? relative(BUILD, deferred.worst.f) : '';
  console.log(
    `\n  note  ${deferred.count} chunk(s) reachable by dynamic import, ${kb(deferred.bytes)} gzipped —` +
      `\n        not at first paint, so no budget above measures them. Largest:` +
      `\n        ${worst} at ${kb(deferred.worst.bytes)}.`
  );
}

/*
 * Emitted and reachable by nothing at all. Harmless to a reader, but worth seeing: if it starts
 * growing, something has begun shipping client code.
 *
 * Now excludes the dynamically-reachable set above, so the claim it makes stays true.
 */
const dead = files.filter(
  (f) => !referenced.has(f) && !f.endsWith('.txt') && !deferred?.files.has(f)
);
if (dead.length) {
  const deadBytes = dead.reduce((n, f) => n + gz(f), 0);
  console.log(
    `\n  note  ${dead.length} unreferenced file(s), ${kb(deadBytes)} gzipped — emitted by the` +
      `\n        client build, reachable from no page at all. Not delivered to anyone.`
  );
}

const publicJs = Math.max(0, ...pages.filter((p) => SURFACES.public.match(p.name)).map((p) => p.js));
if (publicJs === 0) {
  console.log('\n  Zero JavaScript on the public site. Every page there works with scripting disabled.');
}

/*
 * A ceiling on any single file, because the page budgets above were watching the wrong thing.
 *
 * Every budget in this file models what one reader downloads on one page. They said nothing
 * about a file no page links — and on 2026-10-04 the artifact that threatened the account the
 * site is served from was `directory.json`, a 25 MB export in production that no page has ever
 * referenced and no budget here was measuring. It appeared, grew with the directory, and the
 * only thing that would have noticed was a bill.
 *
 * Raw rather than gzipped, deliberately. A client that omits `Accept-Encoding` pays the
 * uncompressed size, and a hand-rolled consumer routinely does: this export is 16 MB raw and
 * 1.3 MB gzipped, a twelvefold difference that only the raw number makes visible.
 *
 * An artifact over the ceiling is not forbidden. It has to be named here with a reason and a
 * number, so that growing past it is a decision somebody makes rather than a thing that happens.
 */
const ARTIFACT_CEILING = 1024 * 1024;
const NAMED = [
  {
    path: 'directory.json',
    max: 20 * 1024 * 1024,
    why: 'The whole directory as one export. No page links it, robots.txt disallows it, and a bulk consumer is pointed at the CAR instead.'
  },
  {
    path: '_ipfs/navcom-directory.car',
    max: 8 * 1024 * 1024,
    why: 'The content-addressed directory, fetched by whoever pins it. This is the path bulk traffic is supposed to take.'
  },
  {
    path: 'sitemap.xml',
    max: 2 * 1024 * 1024,
    why: 'One line per record. Grows with the directory and is fetched once per crawl.'
  }
];

const rel = (f) => f.slice(BUILD.length).replace(/^\/+/, '');
const over = [];
for (const f of files) {
  const name = rel(f);
  const bytes = statSync(f).size;
  const named = NAMED.find((n) => n.path === name);
  const limit = named ? named.max : ARTIFACT_CEILING;
  if (bytes > limit) over.push({ name, bytes, limit, named: Boolean(named) });
}

if (over.length) {
  failed = true;
  console.log('\n  ARTIFACT CEILING');
  for (const o of over) {
    console.log(
      `  FAIL  ${o.name}  ${kb(o.bytes)} raw, over ${kb(o.limit)}` +
        (o.named
          ? ' — it has a budget here and has outgrown it. Decide, then raise it.'
          : ' — no page links it and nothing here allows it. Name it in NAMED with a reason, or do not ship it.')
    );
  }
} else {
  const biggest = NAMED.map((n) => {
    const f = files.find((x) => rel(x) === n.path);
    return f ? `${n.path} ${kb(statSync(f).size)}` : null;
  }).filter(Boolean);
  if (biggest.length) console.log(`\n  PASS  Artifacts    ${biggest.join(' · ')}`);
}

process.exit(failed ? 1 : 0);
