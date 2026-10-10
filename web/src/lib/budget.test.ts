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

import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
import { COM_ENTRIES, DEFERRED, ROOT_MOUNT, SURFACES, measure } from '../../scripts/lib/budget.mjs';

const A = '_app/immutable';
const NODE = (n: string) => `.svelte-kit/generated/client-optimized/nodes/${n}.js`;
const APP = '.svelte-kit/generated/client-optimized/app.js';
const MAP = 'src/lib/components/grid/GridMap.svelte';
const LIVE = 'src/lib/missions/live.ts';
const MISSIONS = 'src/lib/components/missions/index.ts';
const ERROR_PAGE = '.svelte-kit/generated/shared/error-template.js';

/**
 * A landing page that mounts a map and a feed and opens a missions entry, a roster, a Status page
 * heavy on script, a Find page heavy on HTML, and a public page with none.
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
      dynamicImports: [MAP, LIVE, MISSIONS, '_shared.js', NODE('2'), ERROR_PAGE],
      css: [`${A}/assets/0.css`]
    },
    [NODE('1')]: { file: `${A}/nodes/1.js`, isEntry: true, isDynamicEntry: true, imports: ['_shared.js', '_core.js'] },
    [NODE('2')]: { file: `${A}/nodes/2.js`, isEntry: true, isDynamicEntry: true, imports: ['_shared.js', '_core.js', '_status.js', '_lazy.js'] },
    [NODE('3')]: { file: `${A}/nodes/3.js`, isEntry: true, isDynamicEntry: true, imports: ['_shared.js'] },
    [NODE('4')]: { file: `${A}/nodes/4.js`, isEntry: true, isDynamicEntry: true, imports: [] },
    [MAP]: { file: `${A}/chunks/map.js`, isDynamicEntry: true, src: MAP, imports: ['_shared.js'], css: [`${A}/assets/map.css`] },
    [LIVE]: { file: `${A}/chunks/live.js`, isDynamicEntry: true, src: LIVE, imports: ['_core.js'] },
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

function run(f: ReturnType<typeof fixture>) {
  const lines: string[] = [];
  const { report, failed } = measure({ build: f.build, manifestPath: f.manifestPath, log: (l: string) => lines.push(l) });
  return { report, failed, out: lines.join('\n') };
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
    // The map, the feed and the core chunk the feed pulls: every visit pays for these.
    expect(tiers.mount.js).toBe(f.sum(`${A}/chunks/map.js`, `${A}/chunks/live.js`, `${A}/chunks/core.js`));
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
    expect(tiers.mount.js).toBe(f.sum(`${A}/chunks/map.js`, `${A}/chunks/live.js`, `${A}/chunks/core.js`));
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
    m[NODE('0')].dynamicImports = [MAP, MISSIONS, 'src/lib/components/people/index.ts'];
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
    expect(DEFERRED).toEqual({ limit: 45 * 1024, warn: 40 * 1024 });
  });

  it('still fails the build when what loads later outgrows the ceiling', () => {
    const f = fixture({ chunks: { [`${A}/chunks/missions.js`]: noise(48 * 1024) } });
    const { report, failed, out } = run(f);
    expect(failed).toBe(true);
    expect(report.passed).toBe(false);
    expect(out).toMatch(/FAIL {2}Deferred/);
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
    const { ran, report } = beside({ [`${A}/chunks/missions.js`]: noise(48 * 1024) });
    expect(ran.status).toBe(1);
    expect(report?.passed).toBe(false);
  });
});

describe('the root tiers are declared to match the page that loads them', () => {
  const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));
  const MANIFEST = fileURLToPath(new URL('../../.svelte-kit/output/client/.vite/manifest.json', import.meta.url));
  const PAGE = fileURLToPath(new URL('../routes/+page.svelte', import.meta.url));
  const spec = (key: string) => key.replace(/^src\/lib\//, '$lib/').replace(/\/index\.ts$/, '').replace(/\.ts$/, '');

  it('imports the mount tier as it mounts, and each Com entry only when a screen opens', () => {
    /*
     * The manifest cannot say when an import fires. `+page.svelte` can: fire-and-forget on mount,
     * awaited when a screen opens. A mount import moved behind the sheet, or an entry pulled into
     * mount, makes the declaration in budget.mjs wrong, and this is where that shows.
     */
    const page = readFileSync(PAGE, 'utf8');
    const quote = (s: string) => s.replace(/[$.*+?^{}()|[\]\\/]/g, '\\$&');
    for (const key of ROOT_MOUNT) expect(page, `${key} is not imported on mount`).toMatch(new RegExp(`void import\\('${quote(spec(key))}'\\)`));
    for (const key of Object.values(COM_ENTRIES)) {
      expect(page, `${key} is not awaited when a screen opens`).toMatch(new RegExp(`await import\\('${quote(spec(key))}'\\)`));
      expect(page).not.toMatch(new RegExp(`void import\\('${quote(spec(key))}'\\)`));
    }
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
    const undeclared = [...seeds, ...nested].filter((k) => !declared.has(k) && !k.startsWith('.svelte-kit/'));
    expect(undeclared, 'the landing page loads these later; say in scripts/lib/budget.mjs whether on mount or on opening a screen').toEqual([]);
    expect([...ROOT_MOUNT].filter((k) => !seeds.has(k)), 'imported on mount no longer, or not by the page itself').toEqual([]);
    expect([...declared].filter((k) => !seeds.has(k) && !nested.has(k)), 'declared in scripts/lib/budget.mjs and no longer imported by the landing page').toEqual([]);
  });
});
