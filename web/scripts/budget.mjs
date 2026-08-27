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
    match: (name) => !name.startsWith('terminal/') && name !== 'index.html',
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

// Emitted but never referenced by any page. Harmless to a reader, but worth seeing: if it
// starts growing, something has begun shipping client code.
const dead = files.filter((f) => !referenced.has(f) && !f.endsWith('.txt'));
if (dead.length) {
  const deadBytes = dead.reduce((n, f) => n + gz(f), 0);
  console.log(
    `\n  note  ${dead.length} unreferenced file(s), ${kb(deadBytes)} gzipped — emitted by the` +
      `\n        client build, loaded by no page. Not delivered to anyone.`
  );
}

const publicJs = Math.max(0, ...pages.filter((p) => SURFACES.public.match(p.name)).map((p) => p.js));
if (publicJs === 0) {
  console.log('\n  Zero JavaScript on the public site. Every page there works with scripting disabled.');
}

process.exit(failed ? 1 : 0);
