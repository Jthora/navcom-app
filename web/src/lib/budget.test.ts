/**
 * The budget's arithmetic, checked on a build small enough to know the answer to.
 *
 * `budget.mjs` gates every deploy and had no test of its own. It carried two walkers over Vite's
 * manifest that disagreed on what to follow, counted no stylesheet anywhere after first paint, and
 * filed the terminal's worst script figure under the page with the largest total. Each of those
 * was found by reading the numbers by hand. These fixtures are built so that each one fails a test
 * instead: a stylesheet reached two ways, a dynamic import first paint already loaded, a manifest
 * from another build, and a page that is heaviest on HTML beside one that is heaviest on script.
 *
 * The expected sizes are computed here with the same gzip the script uses, from the files each
 * figure should include, so a test names the set and the script has to arrive at the same sum.
 */

import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// Plain .mjs, deliberately: what the deploy runs, not a TypeScript copy of it. Never
// `scripts/budget.mjs` itself: that one measures the real build and exits whenever it is loaded.
import { closure, firstPaint, htmlRefs, isStale, readManifest, routeNodes } from '../../scripts/lib/closure.mjs';
import { COM_ENTRIES, DEFERRED, LAYER_CODE, MAP_LINES, MOUNT, ROOT_MOUNT, SURFACES, lineCodes, measure } from '../../scripts/lib/budget.mjs';
import { CAPS, HAZARD_FEEDS, HAZARDS_PEAK_KB, HAZARDS_ROUND_KB } from './outside';

const A = '_app/immutable';
const NODE = (n: string) => `.svelte-kit/generated/client-optimized/nodes/${n}.js`;
const APP = '.svelte-kit/generated/client-optimized/app.js';
const MAP = 'src/lib/components/grid/GridMap.svelte';
const LIVE = 'src/lib/missions/live.ts';
const MISSIONS = 'src/lib/components/missions/index.ts';
const COM = 'src/lib/components/com/index.ts';
const ERROR_PAGE = '.svelte-kit/generated/shared/error-template.js';

/**
 * A landing page that mounts a map, a feed and Com's registry, whose registry opens a missions
 * entry; a roster, a Status page heavy on script, a Find page heavy on HTML, and a public page with
 * none.
 *
 * - `_shared.js` is loaded at first paint and ALSO imported dynamically by the root: it must be
 *   charged to first paint and to nothing later
 * - `_core.js` is pulled by the mounted feed and by the missions entry: mount pays for it, the
 *   entry does not pay again
 * - `_only.css` is a CSS-only manifest entry, reached through the missions entry's `css` list and
 *   through `_pool.js`'s `imports`: counted once
 * - Status's HTML leaves out `_status.js`, which its node imports statically: the browser fetches it
 *   all the same, so first paint counts it. It also leaves out `lazy.css`, which `_lazy.js` carries:
 *   SvelteKit links only what server rendering used and loads the rest when it renders, so first
 *   paint does not count that
 */
function manifest(): Record<string, { file: string; isEntry?: boolean; isDynamicEntry?: boolean; imports?: string[]; dynamicImports?: string[]; css?: string[]; src?: string }> {
  return {
    [APP]: { file: `${A}/entry/app.js`, isEntry: true, imports: ['_shared.js'], dynamicImports: [NODE('0'), NODE('1'), NODE('2'), NODE('3'), NODE('4')] },
    [NODE('0')]: {
      file: `${A}/nodes/0.js`,
      isEntry: true,
      isDynamicEntry: true,
      imports: ['_shared.js'],
      dynamicImports: [MAP, LIVE, COM, '_shared.js', NODE('2'), ERROR_PAGE],
      css: [`${A}/assets/0.css`]
    },
    [NODE('1')]: { file: `${A}/nodes/1.js`, isEntry: true, isDynamicEntry: true, imports: ['_shared.js', '_core.js'] },
    [NODE('2')]: { file: `${A}/nodes/2.js`, isEntry: true, isDynamicEntry: true, imports: ['_shared.js', '_core.js', '_status.js', '_lazy.js'] },
    [NODE('3')]: { file: `${A}/nodes/3.js`, isEntry: true, isDynamicEntry: true, imports: ['_shared.js'] },
    [NODE('4')]: { file: `${A}/nodes/4.js`, isEntry: true, isDynamicEntry: true, imports: [] },
    [MAP]: { file: `${A}/chunks/map.js`, isDynamicEntry: true, src: MAP, imports: ['_shared.js'], css: [`${A}/assets/map.css`] },
    [LIVE]: { file: `${A}/chunks/live.js`, isDynamicEntry: true, src: LIVE, imports: ['_core.js'] },
    [COM]: { file: `${A}/chunks/com.js`, isDynamicEntry: true, src: COM, imports: ['_shared.js'], dynamicImports: [MISSIONS] },
    [MISSIONS]: {
      file: `${A}/chunks/missions.js`,
      isDynamicEntry: true,
      src: MISSIONS,
      imports: ['_core.js', '_pool.js', '_gone.js'],
      css: [`${A}/assets/missions.css`, `${A}/assets/only.css`]
    },
    [ERROR_PAGE]: { file: `${A}/chunks/error.js`, isDynamicEntry: true },
    '_shared.js': { file: `${A}/chunks/shared.js` },
    '_core.js': { file: `${A}/chunks/core.js` },
    '_status.js': { file: `${A}/chunks/status.js` },
    '_lazy.js': { file: `${A}/chunks/lazy.js`, css: [`${A}/assets/lazy.css`] },
    '_pool.js': { file: `${A}/chunks/pool.js`, imports: ['_only.css'] },
    '_only.css': { file: `${A}/assets/only.css`, src: '_only.css' }
  };
}

/** Incompressible text, so a chunk's gzipped size is mostly its length. */
const noise = (bytes: number) => randomBytes(bytes).toString('base64');

function link(page: string, file: string): string {
  const up = '../'.repeat(page.split('/').length - 1) || './';
  return file.endsWith('.css') ? `<link href="${up}${file}" rel="stylesheet">` : `<link href="${up}${file}" rel="modulepreload">`;
}

/**
 * Writes the fixture build and its manifest; returns where they are. Given `root`, they go where the
 * budget script looks for them beside itself, as `web/build` and `web/.svelte-kit` sit beside
 * `web/scripts`.
 */
function fixture(overrides: { manifest?: ReturnType<typeof manifest>; chunks?: Record<string, string>; root?: string } = {}) {
  const build = overrides.root ? join(overrides.root, 'build') : mkdtempSync(join(tmpdir(), 'navcom-budget-build-'));
  const files: Record<string, string> = {
    [`${A}/entry/app.js`]: noise(400),
    [`${A}/nodes/0.js`]: noise(300),
    [`${A}/nodes/1.js`]: noise(200),
    [`${A}/nodes/2.js`]: noise(3000),
    [`${A}/nodes/3.js`]: noise(100),
    [`${A}/nodes/4.js`]: noise(50),
    [`${A}/chunks/map.js`]: noise(500),
    [`${A}/chunks/live.js`]: noise(250),
    [`${A}/chunks/com.js`]: noise(120),
    [`${A}/chunks/missions.js`]: noise(900),
    [`${A}/chunks/error.js`]: noise(60),
    [`${A}/chunks/shared.js`]: noise(700),
    [`${A}/chunks/core.js`]: noise(1500),
    [`${A}/chunks/status.js`]: noise(800),
    [`${A}/chunks/lazy.js`]: noise(150),
    [`${A}/assets/lazy.css`]: `.l{color:teal}${noise(30)}`,
    [`${A}/chunks/pool.js`]: noise(350),
    [`${A}/assets/0.css`]: `.a{color:red}${noise(80)}`,
    [`${A}/assets/map.css`]: `.m{color:blue}${noise(40)}`,
    [`${A}/assets/missions.css`]: `.s{color:green}${noise(60)}`,
    [`${A}/assets/only.css`]: `.o{color:gray}${noise(30)}`,
    'version.json': JSON.stringify({ commit: 'abc1234', builtAt: '2026-10-09T23:00:00.000Z', dirty: false }),
    ...overrides.chunks
  };
  const pages: Record<string, string[]> = {
    'index.html': [`${A}/entry/app.js`, `${A}/nodes/0.js`, `${A}/chunks/shared.js`, `${A}/assets/0.css`],
    'who/index.html': [`${A}/entry/app.js`, `${A}/nodes/1.js`, `${A}/chunks/shared.js`, `${A}/chunks/core.js`],
    'terminal/index.html': [`${A}/entry/app.js`, `${A}/nodes/2.js`, `${A}/chunks/shared.js`, `${A}/chunks/core.js`],
    'terminal/find/index.html': [`${A}/entry/app.js`, `${A}/nodes/3.js`, `${A}/chunks/shared.js`],
    'about/index.html': []
  };
  for (const [page, refs] of Object.entries(pages)) {
    // Find embeds an index in its HTML, the way the real one does, so it tops the total.
    const body = page === 'terminal/find/index.html' ? noise(9000) : 'x';
    files[page] = `<!doctype html><head>${refs.map((r) => link(page, r)).join('')}</head><body>${body}</body>`;
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(build, path)), { recursive: true });
    writeFileSync(join(build, path), text);
  }
  const manifestPath = overrides.root
    ? join(overrides.root, '.svelte-kit/output/client/.vite/manifest.json')
    : join(mkdtempSync(join(tmpdir(), 'navcom-budget-manifest-')), 'manifest.json');
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(overrides.manifest ?? manifest()));
  const gz = (path: string) => gzipSync(readFileSync(join(build, path))).length;
  const sum = (...paths: string[]) => paths.reduce((n, p) => n + gz(p), 0);
  return { build, manifestPath, gz, sum };
}

type Lines = NonNullable<Parameters<typeof measure>[0]['lines']>;

/** The fixture's own Com registry: one entry, as the landing page had before the map's layers. */
const FIXTURE_ENTRIES = { missions: MISSIONS };

function run(f: ReturnType<typeof fixture>, lines?: Lines) {
  const out: string[] = [];
  const { report, failed } = measure({ build: f.build, manifestPath: f.manifestPath, log: (l: string) => out.push(l), lines, comEntries: FIXTURE_ENTRIES });
  return { report, failed, out: out.join('\n') };
}

/** A map layer, as the map would load it: by `import()`, from the map's own chunk, which mount loads. */
const ZONES = `${LAYER_CODE}zones.ts`;
function layered(m = manifest()) {
  m[MAP].dynamicImports = [ZONES];
  /*
   * Its own chunk, a reader only it uses, and two it shares: `_shared.js`, which first paint loads,
   * and `_pool.js`, which the missions entry loads.
   */
  m[ZONES] = { file: `${A}/chunks/zones.js`, isDynamicEntry: true, src: ZONES, imports: ['_shared.js', '_reader.js', '_pool.js'] };
  m['_reader.js'] = { file: `${A}/chunks/reader.js` };
  return m;
}
const LAYER_FILES = () => ({
  [`${A}/chunks/zones.js`]: noise(400),
  [`${A}/chunks/reader.js`]: noise(300),
  'grid/zsp/outlines.json': noise(500)
});
/** Every file the fixture's Deferred line counted before any map layer existed. */
const DEFERRED_BEFORE = [
  `${A}/chunks/map.js`,
  `${A}/chunks/live.js`,
  `${A}/chunks/com.js`,
  `${A}/chunks/missions.js`,
  `${A}/chunks/pool.js`,
  `${A}/assets/only.css`,
  `${A}/chunks/error.js`,
  `${A}/nodes/4.js`
];

/** Ceilings no fixture comes near, unless a test says otherwise. */
const roomy = (over: Partial<{ limit: number; warn: number }> = {}) => ({ limit: 64 * 1024, warn: 60 * 1024, measured: 50 * 1024, why: 'a test', ...over });
function testLines(zones: Partial<Lines[string]> = {}): Lines {
  return {
    zones: { when: 'choosing Zones', code: ZONES, files: (f) => f === 'grid/zsp/outlines.json', per: 'all', js: roomy(), data: roomy(), ...zones },
    'zones-container': { when: 'opening one Terra or Mare', code: null, files: (f) => f.startsWith('grid/zsp/terra-'), per: 'each', js: null, data: roomy() }
  };
}

describe('one walk over the manifest', () => {
  it('counts a stylesheet once, whether a css list or an import reaches it', () => {
    const { files } = closure(manifest(), [MISSIONS]);
    expect([...files].filter((f) => f.endsWith('only.css'))).toEqual([`${A}/assets/only.css`]);
    expect(files.has(`${A}/assets/missions.css`)).toBe(true);
    // The import nobody built is skipped rather than counted as a file called `_gone.js`.
    expect([...files].some((f) => f.includes('gone'))).toBe(false);
  });

  it('tells a stylesheet only a css list names from a file an import reaches', () => {
    // The deferred ceiling was derived counting every file an import reached and no css list, so
    // only the first kind can be reported beside it without changing what it holds.
    const { files, sheets } = closure(manifest(), [MISSIONS]);
    expect([...sheets]).toEqual([`${A}/assets/missions.css`]);
    // `only.css` is in the same css list, and `_pool.js` imports it as well: an import reached it.
    expect(files.has(`${A}/assets/only.css`)).toBe(true);
    expect(sheets.has(`${A}/assets/only.css`)).toBe(false);
  });

  it('follows dynamic imports only when asked, so first paint is the static closure', () => {
    const paint = closure(manifest(), [NODE('0')], [], { dynamic: false }).files;
    expect(paint.has(`${A}/chunks/shared.js`)).toBe(true);
    expect(paint.has(`${A}/assets/0.css`)).toBe(true);
    expect(paint.has(`${A}/chunks/map.js`)).toBe(false);
    expect(closure(manifest(), [NODE('0')]).files.has(`${A}/chunks/map.js`)).toBe(true);
  });

  it('charges a dynamic import that first paint already loaded to first paint alone', () => {
    const m = manifest();
    const paint = firstPaint(m, [`${A}/entry/app.js`, `${A}/nodes/0.js`]);
    const later = closure(m, m[NODE('0')].dynamicImports!, [...paint, ...routeNodes(m)]).files;
    expect(later.has(`${A}/chunks/shared.js`)).toBe(false);
    expect(later.has(`${A}/chunks/map.js`)).toBe(true);
    // Another route's page is the router's to load, not this page's.
    expect(later.has(`${A}/nodes/2.js`)).toBe(false);
  });

  it('stops at what it is told to exclude, given as a key or as a file', () => {
    const m = manifest();
    for (const without of ['_core.js', `${A}/chunks/core.js`]) {
      const { files, keys } = closure(m, [LIVE], [without]);
      expect(files.has(`${A}/chunks/core.js`)).toBe(false);
      expect(keys.has('_core.js')).toBe(false);
      expect(files.has(`${A}/chunks/live.js`)).toBe(true);
    }
  });

  it('counts at first paint every script a page imports statically, and only the stylesheets it links', () => {
    const paint = firstPaint(manifest(), [`${A}/entry/app.js`, `${A}/nodes/2.js`]);
    expect(paint.has(`${A}/chunks/status.js`)).toBe(true);
    expect(paint.has(`${A}/chunks/lazy.js`)).toBe(true);
    expect(paint.has(`${A}/assets/lazy.css`)).toBe(false);
    expect(firstPaint(null, ['a.js', 'b.css'])).toEqual(new Set(['a.js', 'b.css']));
  });

  it('reads the files a page names relative to where the page is', () => {
    const html = `<link href="../../_app/immutable/x.js" rel="modulepreload"><link href="/_app/y.css" rel="stylesheet"><script src="https://elsewhere.example/z.js"></script>`;
    expect(htmlRefs(html, 'terminal/find/index.html')).toEqual(['_app/immutable/x.js', '_app/y.css']);
  });

  it('knows a manifest from another build when it sees one', () => {
    const f = fixture();
    expect(isStale(readManifest(f.manifestPath)!, f.build)).toBe(false);
    const other = Object.fromEntries(Object.entries(manifest()).map(([k, e]) => [k, { ...e, file: e.file.replace(/\.(js|css)$/, '.0ld.$1') }]));
    expect(isStale(other, f.build)).toBe(true);
    expect(readManifest('/nonexistent/manifest.json')).toBeNull();
  });
});

describe('the budget, run on a build whose answers are known', () => {
  it('names the worst script page apart from the worst page, and keeps every field it had', () => {
    const f = fixture();
    const { report } = run(f);
    const terminal = report.surfaces.terminal;
    expect(terminal.worst_page).toBe('terminal/find/index.html');
    expect(terminal.worst_js_page).toBe('terminal/index.html');
    // The two chunks its HTML did not name are imported statically, so the browser fetches them.
    expect(terminal.js).toBe(
      f.sum(`${A}/entry/app.js`, `${A}/nodes/2.js`, `${A}/chunks/shared.js`, `${A}/chunks/core.js`, `${A}/chunks/status.js`, `${A}/chunks/lazy.js`)
    );
    expect(Object.keys(terminal).sort()).toEqual(['js', 'js_budget', 'page', 'page_budget', 'pages', 'worst_js_page', 'worst_page']);
    expect(terminal.js_budget).toBe(SURFACES.terminal.js);
    expect(report.unit).toBe('bytes, gzipped');
  });

  it('names no worst script page on a surface that has no script', () => {
    // A tie at zero would name the largest page, and send somebody looking for script that is not there.
    const { report } = run(fixture());
    expect(report.surfaces.public).toMatchObject({ js: 0, worst_page: 'about/index.html', worst_js_page: null });
  });

  it('splits the root into first paint, mount and each Com entry, and charges a shared chunk once', () => {
    const f = fixture();
    const { report } = run(f);
    const tiers = report.root_tiers;
    expect(tiers.first_paint.js).toBe(report.surfaces.root.js);
    expect(tiers.first_paint.js).toBe(f.sum(`${A}/entry/app.js`, `${A}/nodes/0.js`, `${A}/chunks/shared.js`));
    expect(tiers.first_paint.css).toBe(f.gz(`${A}/assets/0.css`));
    // The map, the feed, the core chunk the feed pulls and Com's registry: every visit pays for these.
    expect(tiers.mount.js).toBe(f.sum(`${A}/chunks/map.js`, `${A}/chunks/live.js`, `${A}/chunks/core.js`, `${A}/chunks/com.js`));
    expect(tiers.mount.css).toBe(f.gz(`${A}/assets/map.css`));
    // The entry pays for its own code and what mount did not already load: not core again.
    expect(tiers.entries.missions.js).toBe(f.sum(`${A}/chunks/missions.js`, `${A}/chunks/pool.js`));
    expect(tiers.entries.missions.css).toBe(f.sum(`${A}/assets/missions.css`, `${A}/assets/only.css`));
    expect(tiers.framework.js).toBe(f.gz(`${A}/chunks/error.js`));
    expect(tiers.unclassified).toEqual({});
    expect(tiers.later.js).toBe(tiers.mount.js + tiers.entries.missions.js + tiers.framework.js);
    // The field the health file has always published keeps its meaning: every file an import
    // reaches, so `only.css`, which `_pool.js` imports, and no stylesheet only a css list names.
    expect(report.root_later).toEqual({ bytes: tiers.later.js + f.gz(`${A}/assets/only.css`) });
  });

  it('charges what an entry or the mount opens later to a tier of its own, never to the one that opens it', () => {
    /*
     * A people card opened lazily from a mission screen, and an older-missions view the feed loads
     * on demand. Walked with their dynamic imports, the first would be charged to missions and the
     * second to mount, the tier the report calls every visit.
     */
    const PEOPLE = 'src/lib/components/people/index.ts';
    const OLDER = 'src/lib/missions/older.ts';
    const m = manifest();
    m[MISSIONS].dynamicImports = [PEOPLE, '_pool.js'];
    m[LIVE].dynamicImports = [OLDER];
    m[PEOPLE] = { file: `${A}/chunks/people.js`, isDynamicEntry: true, src: PEOPLE, imports: ['_core.js', '_cards.js'] };
    m['_cards.js'] = { file: `${A}/chunks/cards.js` };
    m[OLDER] = { file: `${A}/chunks/older.js`, isDynamicEntry: true, src: OLDER, imports: ['_core.js'] };
    const f = fixture({
      manifest: m,
      chunks: { [`${A}/chunks/people.js`]: noise(220), [`${A}/chunks/cards.js`]: noise(330), [`${A}/chunks/older.js`]: noise(140) }
    });
    const { report } = run(f);
    const tiers = report.root_tiers;
    expect(tiers.mount.js).toBe(f.sum(`${A}/chunks/map.js`, `${A}/chunks/live.js`, `${A}/chunks/core.js`, `${A}/chunks/com.js`));
    expect(tiers.entries.missions.js).toBe(f.sum(`${A}/chunks/missions.js`, `${A}/chunks/pool.js`));
    // Each in its own tier, named for what to declare it as, and paying nothing mount already loaded.
    expect(tiers.unclassified).toEqual({
      [PEOPLE]: { js: f.sum(`${A}/chunks/people.js`, `${A}/chunks/cards.js`), css: 0, chunks: 2 },
      [OLDER]: { js: f.gz(`${A}/chunks/older.js`), css: 0, chunks: 1 }
    });
    // An import of a chunk the importer already has is no tier at all.
    expect(Object.keys(tiers.unclassified)).not.toContain('_pool.js');
    // Counted once each across the tiers, and every one of them still in the total.
    expect(tiers.later.js).toBe(
      tiers.mount.js + tiers.entries.missions.js + tiers.unclassified[PEOPLE].js + tiers.unclassified[OLDER].js + tiers.framework.js
    );
  });

  it('reports a dynamic import nobody declared on a line of its own, and a declared one that went away', () => {
    const m = manifest();
    m['src/lib/components/people/index.ts'] = { file: `${A}/chunks/people.js`, isDynamicEntry: true };
    m[NODE('0')].dynamicImports = [MAP, COM, 'src/lib/components/people/index.ts'];
    const f = fixture({ manifest: m, chunks: { [`${A}/chunks/people.js`]: noise(120) } });
    const { report, out } = run(f);
    expect(report.root_tiers.unclassified['src/lib/components/people/index.ts'].js).toBe(f.gz(`${A}/chunks/people.js`));
    expect(report.root_tiers.undeclared).toEqual([LIVE]);
    expect(out).toMatch(/src\/lib\/components\/people\/index\.ts: name it in ROOT_MOUNT or COM_ENTRIES/);
  });

  it('keeps the deferred ceiling counting what it was derived on, and reports the other stylesheets beside it', () => {
    const f = fixture();
    const { report } = run(f);
    // Reachable later and loaded by no page at first paint. The routes' own nodes are named by
    // their pages; node 4 has no page, so it is the router's to fetch later.
    expect(report.deferred).toEqual({
      /*
       * Every file an import reaches, as the ceiling was derived. `only.css` is among them because
       * `_pool.js` imports it: the walker before this one counted it against the ceiling, and a new
       * walker that moved it out would have let the ceiling hold less without anybody deciding so.
       */
      bytes: f.sum(
        `${A}/chunks/map.js`,
        `${A}/chunks/live.js`,
        `${A}/chunks/com.js`,
        `${A}/chunks/missions.js`,
        `${A}/chunks/pool.js`,
        `${A}/assets/only.css`,
        `${A}/chunks/error.js`,
        `${A}/nodes/4.js`
      ),
      limit: DEFERRED.limit,
      // Only a css list names these. lazy.css too: no page links it, and Status loads it when the
      // component renders.
      css: f.sum(`${A}/assets/map.css`, `${A}/assets/missions.css`, `${A}/assets/lazy.css`)
    });
    expect(DEFERRED).toEqual({ limit: 69 * 1024, warn: 62 * 1024 });
  });

  it('still fails the build when what loads later outgrows the ceiling', () => {
    const f = fixture({ chunks: { [`${A}/chunks/missions.js`]: noise(DEFERRED.limit + 1024) } });
    const { report, failed, out } = run(f);
    expect(failed).toBe(true);
    expect(report.passed).toBe(false);
    expect(out).toMatch(/FAIL {2}Deferred/);
  });

  it('caps what every visit fetches as the root mounts: the mount tier’s script and the map’s geometry', () => {
    /*
     * Reported and never enforced until 2026-10-18, when a review found the map's chunk had grown
     * 2.2 kB and its geometry 3.0 kB in one change, on the tier the device floor pays on every visit,
     * and nothing had said so [budget.mjs MOUNT].
     */
    const f = fixture({ chunks: { 'grid/world.json': noise(900) } });
    const { report, failed, out } = run(f);
    expect(report.mount).toEqual({
      bytes: report.root_tiers.mount.js + f.gz('grid/world.json'),
      js: report.root_tiers.mount.js,
      geometry: f.gz('grid/world.json'),
      limit: MOUNT.limit
    });
    expect(failed).toBe(false);
    expect(out).toMatch(/PASS {2}Mount/);
  });

  it('fails the build when what every visit fetches on mount outgrows its ceiling, geometry included', () => {
    const script = fixture({ chunks: { [`${A}/chunks/map.js`]: noise(MOUNT.limit) } });
    expect(run(script).out).toMatch(/FAIL {2}Mount/);
    expect(run(script).failed).toBe(true);
    // The geometry alone, with the script as small as the fixture's: the map's file counts too.
    const geometry = fixture({ chunks: { 'grid/world.json': noise(MOUNT.limit) } });
    expect(run(geometry).out).toMatch(/FAIL {2}Mount/);
  });

  it('says a manifest from another build could not be measured, rather than reporting zero', () => {
    const f = fixture();
    const other = Object.fromEntries(Object.entries(manifest()).map(([k, e]) => [k, { ...e, file: e.file.replace(/\.(js|css)$/, '.0ld.$1') }]));
    writeFileSync(f.manifestPath, JSON.stringify(other));
    const { report, out } = run(f);
    expect(out).toMatch(/the Vite manifest does not match this build/);
    expect(report.deferred).toBeNull();
    expect(report.root_later).toBeUndefined();
    expect(report.root_tiers).toBeUndefined();
  });

  it('records which build it measured, and writes nothing itself', () => {
    const f = fixture();
    const { report } = run(f);
    expect(report.build).toEqual({ commit: 'abc1234', dirty: false, built_at: '2026-10-09T23:00:00.000Z' });
    expect(existsSync(join(f.build, '.budget.json'))).toBe(false);
  });
});

describe('the map’s layers, each a line of its own', () => {
  /*
   * On 2026-10-18 the root's first paint had 762 B left and Deferred 1.6 kB, and the Zones reader and
   * lookup alone were estimated at 3 to 5 kB [budget.mjs MAP_LINES]. Charged to Deferred, the first
   * layer to land would have spent it, and the second would have been the reason to raise it.
   */
  it('charges a layer’s code to its own line and never to Deferred, and leaves there what it shares', () => {
    const f = fixture({ manifest: layered(), chunks: LAYER_FILES() });
    const { report, failed } = run(f, testLines());
    // Deferred holds exactly what it held before the layer existed: the pool stays, the layer's own go.
    expect(report.deferred.bytes).toBe(f.sum(...DEFERRED_BEFORE));
    const tiers = report.root_tiers;
    // Its own chunk, its reader, and the pool the missions entry also loads; not what first paint has.
    const js = f.sum(`${A}/chunks/zones.js`, `${A}/chunks/reader.js`, `${A}/chunks/pool.js`);
    expect(tiers.lines.zones.js).toBe(js);
    expect(report.lines.zones).toEqual({
      js,
      js_limit: 64 * 1024,
      data: f.gz('grid/zsp/outlines.json'),
      data_limit: 64 * 1024,
      files: ['grid/zsp/outlines.json']
    });
    expect(tiers.unclassified).toEqual({});
    // Every visit's tier is untouched, and the total still counts each chunk once.
    expect(tiers.mount.js).toBe(f.sum(`${A}/chunks/map.js`, `${A}/chunks/live.js`, `${A}/chunks/core.js`, `${A}/chunks/com.js`));
    expect(tiers.later.js).toBe(tiers.mount.js + tiers.entries.missions.js + f.sum(`${A}/chunks/zones.js`, `${A}/chunks/reader.js`) + tiers.framework.js);
    expect(failed).toBe(false);
  });

  it('fails the build when a layer’s code or data outgrows its own ceiling, and warns past its ratchet', () => {
    const f = fixture({ manifest: layered(), chunks: LAYER_FILES() });
    const code = run(f, testLines({ js: roomy({ limit: 100, warn: 90 }) }));
    expect(code.failed).toBe(true);
    expect(code.out).toMatch(/FAIL {2}zones code/);
    // Deferred never saw it, so it is not Deferred that says no.
    expect(code.out).not.toMatch(/FAIL {2}Deferred/);
    const data = run(f, testLines({ data: roomy({ limit: 100, warn: 90 }) }));
    expect(data.failed).toBe(true);
    expect(data.out).toMatch(/FAIL {2}zones data/);
    const warned = run(f, testLines({ js: roomy({ warn: 100 }) }));
    expect(warned.failed).toBe(false);
    expect(warned.out).toMatch(/WARN {2}zones code/);
    const within = run(f, testLines());
    expect(within.out).toMatch(/PASS {2}zones code/);
    expect(within.out).toMatch(/PASS {2}zones data/);
  });

  it('fails the build when a layer arrives before its ceiling is derived, and prints what to derive', () => {
    /*
     * The real declaration, with one layer more whose code and data are written and not yet measured:
     * the change that writes a layer is the one that has to derive its ceilings, and here both arrive,
     * a chunk the map imports and a file it fetches. Time zones', Zones' and Spheres' were measured,
     * so they have.
     */
    const HEAT = `${LAYER_CODE}heat.ts`;
    const lines = { ...MAP_LINES, heat: { when: 'choosing heat', code: HEAT, files: (f: string) => f === 'grid/heat.json', per: 'all' as const, js: null, data: null } };
    const m = manifest();
    m[MAP].dynamicImports = [HEAT];
    m[HEAT] = { file: `${A}/chunks/heat.js`, isDynamicEntry: true, src: HEAT, imports: ['_shared.js'] };
    const f = fixture({
      manifest: m,
      chunks: { [`${A}/chunks/heat.js`]: noise(400), 'grid/heat.json': noise(700), 'grid/zsp/outlines.json': noise(500), 'grid/timezones.json': noise(600), 'grid/spheres.json': noise(700) }
    });
    const { report, failed, out } = run(f, lines);
    expect(failed).toBe(true);
    expect(out).toMatch(/FAIL {2}heat code +\S+ kB arrived with no ceiling/);
    expect(out).toMatch(/FAIL {2}heat data +\S+ kB arrived with no ceiling/);
    const js = report.lines.heat.js as number;
    expect(js).toBeGreaterThan(0);
    expect(out).toContain(`measured ${js} B, so a limit near ${Math.floor(js * 1.2)} B and a warning\n        near ${Math.round(js * 1.08)} B.`);
    expect(out).toMatch(/PASS {2}zones data/);
    expect(out).toMatch(/PASS {2}spheres data/);
    expect(report.lines.timezones).toEqual({
      js: null,
      js_limit: MAP_LINES.timezones.js!.limit,
      data: f.gz('grid/timezones.json'),
      data_limit: MAP_LINES.timezones.data!.limit,
      files: ['grid/timezones.json']
    });
    expect(out).toMatch(/PASS {2}timezones data/);
    // And a line with nothing in the build says so, rather than passing at zero.
    expect(out).toMatch(/---- {2}zones-container +not in this build/);
  });

  it('fails the build when a layer’s code loads at mount or first paint, or is imported statically', () => {
    // Imported statically by the map, which mount loads: every visit pays for it.
    const atMount = layered();
    atMount[MAP].dynamicImports = [];
    atMount[MAP].imports = ['_shared.js', ZONES];
    const mounted = run(fixture({ manifest: atMount, chunks: LAYER_FILES() }), testLines());
    expect(mounted.failed).toBe(true);
    expect(mounted.out).toMatch(/FAIL {2}zones code +loads at mount/);
    expect(mounted.out).toContain(`imported statically by ${MAP}`);
    // Imported statically by the landing page's own node: it is in first paint.
    const atPaint = layered();
    atPaint[NODE('0')].imports = ['_shared.js', ZONES];
    const painted = run(fixture({ manifest: atPaint, chunks: LAYER_FILES() }), testLines());
    expect(painted.failed).toBe(true);
    expect(painted.out).toMatch(/FAIL {2}zones code +loads at first paint/);
  });

  it('fails the build on a layer’s module that no line declares, rather than reporting it unclassified', () => {
    const HEAT = `${LAYER_CODE}heat.ts`;
    const m = manifest();
    m[MAP].dynamicImports = [HEAT];
    m[HEAT] = { file: `${A}/chunks/heat.js`, isDynamicEntry: true, src: HEAT };
    const { failed, out } = run(fixture({ manifest: m, chunks: { [`${A}/chunks/heat.js`]: noise(200) } }));
    expect(failed).toBe(true);
    expect(out).toContain(`FAIL  ${HEAT} is a map layer's code with no line of its own`);
  });

  it('takes a Com entry named as a line’s code from the entries, onto that line', () => {
    // The layer picker, say, if it is an entry of Com's own rather than part of the missions entry.
    const f = fixture();
    const { report } = run(f, { picker: { when: 'opening the layer picker', code: MISSIONS, files: null, per: 'all', js: roomy(), data: null } });
    expect(report.root_tiers.entries).toEqual({});
    expect(report.root_tiers.lines.picker.js).toBe(f.sum(`${A}/chunks/missions.js`, `${A}/chunks/pool.js`));
    // Nothing else reaches either chunk, so neither is Deferred's any more.
    expect(report.deferred.bytes).toBe(f.sum(...DEFERRED_BEFORE.filter((p) => !/missions|pool|only\.css/.test(p))));
    expect(report.root_tiers.undeclared).toEqual([]);
  });

  it('takes the largest file for a moment that fetches one of several, and names it', () => {
    const f = fixture({ chunks: { 'grid/zsp/terra-a.json': noise(300), 'grid/zsp/terra-b.json': noise(900) } });
    const { report, out } = run(f, testLines());
    expect(out).toMatch(/PASS {2}zones-container data .*grid\/zsp\/terra-b\.json, the largest of 2/);
    expect(report.lines['zones-container']).toEqual({
      js: null,
      js_limit: null,
      data: f.gz('grid/zsp/terra-b.json'),
      data_limit: 64 * 1024,
      files: ['grid/zsp/terra-b.json']
    });
  });

  it('declares each of the map’s new layers, with every ceiling ~20% over the measurement it came from', () => {
    expect(Object.keys(MAP_LINES).sort()).toEqual(['ages', 'daylight', 'fine', 'hazards', 'labels', 'layers', 'spheres', 'timezones', 'zone-missions', 'zones', 'zones-container', 'zones-lookup']);
    for (const [name, line] of Object.entries(MAP_LINES)) {
      // A layer's own module, or a Com entry of the same name: the picker's screens are `layers`.
      if (line.code !== null) expect([`${LAYER_CODE}${name}.ts`, COM_ENTRIES[name]], name).toContain(line.code);
      for (const ceiling of [line.js, line.data]) {
        if (ceiling === null) continue;
        expect(ceiling.limit / ceiling.measured, name).toBeGreaterThanOrEqual(1.15);
        expect(ceiling.limit / ceiling.measured, name).toBeLessThanOrEqual(1.25);
        expect(ceiling.warn, name).toBeGreaterThan(ceiling.measured);
        expect(ceiling.warn, name).toBeLessThan(ceiling.limit);
        // The reason names the measurement it was derived from.
        expect(ceiling.why, name).toContain(ceiling.measured.toLocaleString('en-US'));
      }
    }
    // The picker and the screens a layer opens are Com's entry and this line's at once, so Deferred never holds them.
    expect(MAP_LINES.layers!.code).toBe(COM_ENTRIES.layers);
    expect(MAP_LINES.layers!.files).toBeNull();
    // Natural Earth's time zones, as D8 decided them, at the finer setting, with each region's own zone beside them.
    expect(MAP_LINES.timezones.data).toMatchObject({ measured: 53_698, limit: 63 * 1024, warn: 57 * 1024 });
    // Every line whose code is written has a ceiling for it, and every file the layers fetch has one too.
    for (const name of ['layers', 'zones', 'zones-lookup', 'timezones', 'spheres', 'daylight', 'ages', 'zone-missions', 'hazards', 'labels', 'fine'] as const) {
      expect(MAP_LINES[name]!.js, name).not.toBeNull();
    }
    expect(MAP_LINES.zones.data).toMatchObject({ measured: 70_466 });
    expect(MAP_LINES['zones-container']!.data).toMatchObject({ measured: 36_234 });
    expect(MAP_LINES['zones-lookup']!.data).toMatchObject({ measured: 239_360 });
    expect(MAP_LINES.spheres.data).toMatchObject({ measured: 11_286, limit: 13_543, warn: 12_189 });
    // Day and night is worked out on the phone, and the Zones' counts from what it holds: neither fetches a file, and nor do the names.
    expect(MAP_LINES.daylight!.files).toBeNull();
    expect(MAP_LINES.labels!.files).toBeNull();
    expect(MAP_LINES['zone-missions']!.files).toBeNull();
    // Hazards fetches nothing from navcom.app: what it reads is the feeds', on a line of its own [remote].
    expect(MAP_LINES.hazards!.files).toBeNull();
    expect(MAP_LINES.hazards!.data).toBeNull();
    // Each file the layers will fetch belongs to exactly one line, and a container's file is not an outline.
    for (const file of ['grid/zsp/outlines.json', 'grid/zsp/index.json', 'grid/zsp/terra-africana.json', 'grid/timezones.json', 'grid/spheres.json', 'grid/region-ages.json']) {
      expect(Object.entries(MAP_LINES).filter(([, l]) => l.files?.(file)).length, file).toBe(1);
    }
    expect(MAP_LINES['zones-container'].files!('grid/zsp/sectors/terra-africana.json')).toBe(false);
    expect(MAP_LINES['zones-container'].files!(MOUNT.geometry)).toBe(false);
  });
});

describe('what a line asks of hosts outside navcom.app', () => {
  it('measures what Hazards asks of the feeds, from the feeds, and caps each answer on the phone as outside.ts does', () => {
    const remote = MAP_LINES.hazards!.remote!;
    expect(remote, 'Hazards has no measurement of what it asks').toBeTruthy();
    expect(remote.limit / remote.measured).toBeGreaterThanOrEqual(1.15);
    expect(remote.limit / remote.measured).toBeLessThanOrEqual(1.25);
    expect(remote.warn).toBeGreaterThan(remote.measured);
    expect(remote.warn).toBeLessThan(remote.limit);
    expect(remote.why).toContain(remote.measured.toLocaleString('en-US'));
    // Every URL it asks, measured or derived from a measurement, and the round is their sum on the wire.
    expect(remote.feeds.map((f) => f.url)).toEqual(HAZARD_FEEDS.flatMap((f) => f.urls));
    expect(remote.feeds.reduce((n, f) => n + f.wire, 0)).toBe(remote.measured);
    // Each as written, fetched once: a URL derived and never asked can hold a parameter its host ignores.
    for (const f of remote.feeds) expect(f.how, f.url).toBe('measured: one GET');
    // The phone enforces these, not the build: they must be the ones it enforces.
    expect(remote.caps).toEqual(CAPS);
    // And the cost the layers screen states before anybody turns it on is this one.
    expect(Math.abs(HAZARDS_ROUND_KB * 1000 - remote.measured)).toBeLessThan(10_000);
    // A measurement is one day's: the round when the answer that swings with the seasons passes its cap,
    // everything else as measured, which the screen states beside it.
    const peak = remote.peak!;
    expect(peak, 'Hazards states no round for a busy season').toBeTruthy();
    const swings = remote.feeds.find((f) => f.url === peak.swings)!;
    const owner = HAZARD_FEEDS.find((f) => f.urls.includes(peak.swings))!;
    expect(peak.bytes).toBe(remote.measured - swings.wire + CAPS[owner.id]);
    expect(peak.why).toContain(peak.bytes.toLocaleString('en-US'));
    expect(Math.abs(HAZARDS_PEAK_KB * 1000 - peak.bytes)).toBeLessThan(10_000);
    expect(remote.why).toMatch(/quiet month/);
    // Only Hazards asks anybody outside navcom.app from the map.
    expect(Object.entries(MAP_LINES).filter(([, l]) => l.remote).map(([n]) => n)).toEqual(['hazards']);
  });

  it('prints what a line asks outside navcom.app beside its code, as measured from the feeds and not by the build', () => {
    const f = fixture();
    const remote = { measured: 1_000, limit: 1_200, warn: 1_080, why: 'a test, measured at 1,000 B', feeds: [], caps: {} };
    const { out, report, failed } = run(f, { ...testLines(), hazards: { when: 'turning Hazards on', code: null, files: null, per: 'all', js: null, data: null, remote } });
    expect(out).toMatch(/hazards remote +1\.0 kB \/ +1\.2 kB .*measured from the live feeds/);
    expect(report.lines.hazards.remote).toEqual({ measured: 1_000, limit: 1_200 });
    expect(failed).toBe(false);
  });
});

describe('the command the deploy runs', () => {
  /*
   * `npm run budget` is `node scripts/budget.mjs`, run from `web/`. It used to run its check only
   * when `import.meta.url` equalled `file://${process.argv[1]}`, and from a directory with a space in
   * its name, or one reached through a symlink, the two differ: it measured nothing, wrote nothing
   * and exited 0, and verify passed. The scripts are copied to a directory that is both on macOS,
   * where the temporary directory is a symlink, and has a space everywhere.
   */
  const SCRIPTS = fileURLToPath(new URL('../../scripts/', import.meta.url));
  function beside(chunks?: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'navcom budget '));
    cpSync(join(SCRIPTS, 'budget.mjs'), join(root, 'scripts/budget.mjs'));
    cpSync(join(SCRIPTS, 'lib'), join(root, 'scripts/lib'), { recursive: true });
    const f = fixture({ root, chunks });
    const ran = spawnSync(process.execPath, ['scripts/budget.mjs'], { cwd: root, encoding: 'utf8' });
    const written = join(f.build, '.budget.json');
    return { ran, report: existsSync(written) ? JSON.parse(readFileSync(written, 'utf8')) : null };
  }

  it('measures and writes its report from a path with a space in it', () => {
    const { ran, report } = beside();
    expect(ran.stdout, ran.stderr).toMatch(/Deferred/);
    expect(report, 'no .budget.json: the check did not run').not.toBeNull();
    expect(report.surfaces.terminal.worst_js_page).toBe('terminal/index.html');
    expect(ran.status).toBe(0);
  });

  it('fails there too, when something is over', () => {
    const { ran, report } = beside({ [`${A}/chunks/missions.js`]: noise(DEFERRED.limit + 1024) });
    expect(ran.status).toBe(1);
    expect(report?.passed).toBe(false);
  });
});

describe('the root tiers are declared to match the page that loads them', () => {
  const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));
  const MANIFEST = fileURLToPath(new URL('../../.svelte-kit/output/client/.vite/manifest.json', import.meta.url));
  const PAGE = fileURLToPath(new URL('../routes/+page.svelte', import.meta.url));
  const REGISTRY = fileURLToPath(new URL('./com/screens.ts', import.meta.url));
  const spec = (key: string) => key.replace(/^src\/lib\//, '$lib/').replace(/\/index\.ts$/, '').replace(/\.ts$/, '');

  it('imports the mount tier as it mounts, and leaves every Com entry to Com’s registry', () => {
    /*
     * The manifest cannot say when an import fires. `+page.svelte` can: it imports its mount tier as
     * it mounts, waiting on none of it, and no Com entry at all. Each entry's one import site is the
     * registry's, so a new entry adds nothing to the page, its preload list included, and the page's
     * first paint stays where it was [groups.md §13]. A mount import moved behind the sheet, or an
     * entry imported by the page again, makes the declaration in budget.mjs wrong, and this is where
     * that shows.
     */
    const imports = (file: string) => [...new Set([...readFileSync(file, 'utf8').matchAll(/\bimport\s*\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]))].sort();
    expect(imports(PAGE), 'what the page imports later is its mount tier, and nothing else').toEqual(ROOT_MOUNT.map(spec).sort());
    expect(readFileSync(PAGE, 'utf8'), 'the page waits on an import').not.toMatch(/\bawait\s+import\s*\(/);
    expect(imports(REGISTRY), 'Com’s registry imports each entry, and only those').toEqual(Object.values(COM_ENTRIES).map(spec).sort());
  });

  it('declares every dynamic import the built landing page makes, and none it no longer makes', () => {
    if (!existsSync(join(BUILD, 'index.html'))) throw new Error('No build output. Run `npm run build` first.');
    const m = readManifest(MANIFEST);
    if (!m) throw new Error('No Vite manifest beside the build.');
    const refs = htmlRefs(readFileSync(join(BUILD, 'index.html'), 'utf8'), 'index.html');
    const nodes = routeNodes(m);
    const paint = closure(m, refs, [], { dynamic: false });
    const lazyFrom = (keys: Iterable<string>, has: Set<string>) =>
      [...keys].flatMap((key) => (m[key].dynamicImports ?? []).filter((dep) => !nodes.includes(dep) && m[dep] && !has.has(dep)));
    const seeds = new Set(lazyFrom(paint.keys, paint.keys));
    // And what those open later in turn, however deep: each is a tier the script has to name.
    const nested = new Set<string>();
    const queue = [...seeds];
    while (queue.length > 0) {
      const reach = closure(m, [queue.shift()!], [...paint.files, ...nodes], { dynamic: false });
      for (const dep of lazyFrom(reach.keys, reach.keys)) {
        if (!seeds.has(dep) && !nested.has(dep) && !paint.keys.has(dep)) {
          nested.add(dep);
          queue.push(dep);
        }
      }
    }
    const declared = new Set([...ROOT_MOUNT, ...Object.values(COM_ENTRIES)]);
    // A map line is declared before its code exists, so one the build does not have yet is no fault.
    const undeclared = [...seeds, ...nested].filter((k) => !declared.has(k) && !lineCodes(MAP_LINES).includes(k) && !k.startsWith('.svelte-kit/'));
    expect(undeclared, 'the landing page loads these later; say in scripts/lib/budget.mjs whether on mount, on opening a screen or on choosing a layer').toEqual([]);
    expect([...ROOT_MOUNT].filter((k) => !seeds.has(k)), 'imported on mount no longer, or not by the page itself').toEqual([]);
    expect([...declared].filter((k) => !seeds.has(k) && !nested.has(k)), 'declared in scripts/lib/budget.mjs and no longer imported by the landing page').toEqual([]);
    // Opened from inside the mount tier, never by first paint itself, which would carry its preload list.
    expect(Object.values(COM_ENTRIES).filter((k) => seeds.has(k)), 'a Com entry imported by the landing page’s first paint').toEqual([]);
  });

  it('loads no map layer’s code as the landing page paints or mounts, and leaves no map file without a line', () => {
    /*
     * The built landing page, not the declaration: whatever a layer is, it is not in what every
     * visit downloads. And every file under grid/ is paid for somewhere a number is kept: the map's
     * geometry by mount [MOUNT], Places' records by `PLACES_MAX_GZ` in places.test.ts, and every other
     * one by its line. A layer's file with another name would otherwise measure as nothing at all.
     */
    if (!existsSync(join(BUILD, 'index.html'))) throw new Error('No build output. Run `npm run build` first.');
    const m = readManifest(MANIFEST);
    if (!m) throw new Error('No Vite manifest beside the build.');
    const paint = closure(m, htmlRefs(readFileSync(join(BUILD, 'index.html'), 'utf8'), 'index.html'), [], { dynamic: false });
    const mount = closure(m, ROOT_MOUNT, [...paint.files], { dynamic: false });
    for (const code of lineCodes(MAP_LINES)) {
      expect(paint.keys.has(code), `${code} at first paint`).toBe(false);
      expect(mount.keys.has(code), `${code} at mount`).toBe(false);
      expect(Object.keys(m).filter((k) => m[k].imports?.includes(code)), `${code} imported statically`).toEqual([]);
    }
    const grid = (function walk(dir: string, at: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name), `${at}${e.name}/`) : [`${at}${e.name}`]
      );
    })(join(BUILD, 'grid'), 'grid/');
    expect(grid, 'the map’s geometry is in the build').toContain(MOUNT.geometry);
    const paidFor = (f: string) => f === MOUNT.geometry || f === 'grid/places.json' || Object.values(MAP_LINES).some((l) => l.files?.(f));
    expect(grid.filter((f) => !paidFor(f)), 'a file under grid/ that no line, and no other budget, measures').toEqual([]);
  });

  it('holds the directory’s ages inside their ceiling however many days it is re-checked on, region by region', () => {
    /*
     * The ceiling was first set from a file with three check dates, and one index per record: ten dates
     * would have failed it before the directory grew by a record. The file is runs now, and the ceiling
     * is derived from this model of it: the real regions, each re-checked on one of 90 days, a tenth of
     * those with three or more places in three runs. A directory checked record by record on scattered
     * days is not this, and outgrows it; the line says so, and is re-derived then.
     */
    const file = join(BUILD, 'grid/region-ages.json');
    if (!existsSync(file)) throw new Error('No build output. Run `npm run build` first.');
    const built = JSON.parse(readFileSync(file, 'utf8')) as { regions: Record<string, [number, number][]>; dates: string[] };
    const model = agesModel(built, 90);
    expect(model.dates).toHaveLength(90);
    const bytes = gzipSync(JSON.stringify(model)).length;
    expect(bytes, `the 90-day model is ${bytes} B`).toBeLessThanOrEqual(MAP_LINES.ages!.data!.limit);
    // The ceiling is that model's, with the ~20% every line gets: not a figure picked to fit it.
    expect(MAP_LINES.ages!.data!.measured / bytes).toBeGreaterThan(0.97);
    expect(MAP_LINES.ages!.data!.measured / bytes).toBeLessThan(1.03);
    // And today's file, three dates, well under it.
    expect(gzipSync(readFileSync(file)).length).toBeLessThan(bytes);
  });
});

/**
 * The directory's ages as they would be re-checked region by region over `days` days: every region on
 * one day, a tenth of those with three or more places on two, in three runs. Seeded, so the same build
 * always models the same file.
 */
function agesModel(built: { regions: Record<string, [number, number][]>; dates: string[] }, days: number) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const regions: Record<string, [number, number][]> = {};
  for (const [slug, runs] of Object.entries(built.regions)) {
    const count = runs.reduce((t, r) => t + r[1], 0);
    if (count === 0) {
      regions[slug] = [];
      continue;
    }
    const d = Math.floor(rnd() * days);
    if (rnd() < 0.1 && count >= 3) {
      const a = Math.floor(count / 3);
      regions[slug] = [[d, a], [Math.floor(rnd() * days), a], [d, count - 2 * a]];
    } else regions[slug] = [[d, count]];
  }
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  return { ...built, dates, regions };
}
