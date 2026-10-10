/**
 * What must stay out of which page, checked against the build rather than against the imports.
 *
 * Com splits so that first paint carries the peek bar and nothing more [com.md §6], and groups.md
 * §13 promises that people and crews never reach a terminal page or the roster, and that opening a
 * mission never loads crew code. Each promise is a chunk boundary, and a chunk boundary moves
 * without anybody choosing it: Rollup re-partitions shared chunks by who imports them, so one new
 * import of core's barrel can put a module on every terminal page. A test of the source imports
 * would go on passing while the output carried it.
 *
 * Vite's manifest names chunks, not modules, and this build emits no sourcemaps. So a module is
 * recognised in a built chunk by its **fingerprints**: string literals with a space in them that it
 * has and no other source file has. Minification renames every identifier and leaves a string as it
 * was written. A module with no such literal cannot be seen that way, so each one is named on a dated
 * list, with a marker read off the built chunk where one exists, and every guarded family the app
 * imports must be found in the real build by at least one module. The controls below prove the
 * recogniser finds what is really there before any rule is trusted to say something is absent.
 *
 * The exact answer is a module map written by the build, chunk file to module ids, which Rollup
 * has at `generateBundle`. That needs a plugin in `vite.config.ts` and a build to prove it, and
 * until it exists, what this file cannot see it says it cannot see.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { closure, firstPaint, htmlRefs, readManifest, routeNodes } from '../../scripts/lib/closure.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const BUILD = join(REPO, 'web/build');
const MANIFEST = join(REPO, 'web/.svelte-kit/output/client/.vite/manifest.json');
const MISSIONS_ENTRY = 'src/lib/components/missions/index.ts';

type Sources = Map<string, string>;
/** A fingerprint, or a marker: a pattern over minified code, for a module that has no fingerprint. */
type Print = string | RegExp;
type Prints = Map<string, Print[]>;
type Manifest = Parameters<typeof closure>[0];

/** What must stay out, by family. Paths are repo-relative. */
const FAMILIES: Record<string, (path: string) => boolean> = {
  'core missions': (p) => p.startsWith('packages/core/src/missions/'),
  'mission screens': (p) => p.startsWith('web/src/lib/components/missions/'),
  'units and crews': (p) => /^(packages\/core\/src|web\/src\/lib)\/(?:[^/]+\/)*(?:units|crews)\//.test(p),
  people: (p) => /^(packages\/core\/src|web\/src\/lib)\/(?:[^/]+\/)*people\//.test(p)
};
const ANY_FAMILY = (p: string) => Object.values(FAMILIES).some((inFamily) => inFamily(p));
const PEOPLE_OR_CREWS = (p: string) => FAMILIES['units and crews'](p) || FAMILIES.people(p);
/** The relay stack: the shipped relay addresses and the connection pool. */
const RELAYS = ['packages/core/src/relays.ts', 'web/src/lib/terminal/pool.ts'];
/**
 * What the landing page's first paint must not carry, beyond every guarded family: the relay stack,
 * because first paint connects nowhere; claims code, because `holding` reads storage instead
 * [+page.svelte]; and the map, which loads as the page mounts and is budgeted there.
 */
const ROOT_PAINT_OUT = [...RELAYS, 'web/src/lib/missions/claims.ts', 'web/src/lib/components/grid/GridMap.svelte'];

/**
 * Guarded modules with no literal of their own, so no fingerprint can find them. Dated, and held
 * both ways: a guarded module with no fingerprint fails a test until it is named here, and one named
 * here that has gained a fingerprint or gone fails until it comes off.
 *
 * Each has a **marker** where one could be found: a pattern over the minified chunk built from what
 * minification keeps, a property name or a literal without a space, read off the chunk by hand and
 * checked against the real build below. `null` means nothing in the output can be told apart as this
 * module's, so no rule here can say whether a page carries it, and that is said rather than passed.
 * A module that re-exports and does nothing else carries no code of its own and needs no entry.
 *
 * 2026-10-10, both read off core's barrel chunk (`y8zR6RGV.js` in the build stamped eb95b14):
 * - `claim.ts`: `const wt=1985,zr=5,Ti=10050,Te="navcom.mission",Fr=86400,Bc=3`, which is
 *   KIND_LABEL, KIND_DELETION, KIND_INBOX_RELAYS, MISSION_NAMESPACE, CLAIM_LEASE_SECONDS and
 *   CLAIM_CAP. The namespace string is in no other source file
 * - `seal.ts`: `["expiration",String(Math.max(r.ends,a+Pr+r.within))]`, sealToPoster's lapse,
 *   whose `ends` and `within` are property names and survive
 */
const INVISIBLE: { measured: string; modules: Record<string, RegExp | null> } = {
  measured: '2026-10-10',
  modules: {
    'packages/core/src/missions/claim.ts': /["'`]navcom\.mission["'`]/,
    'packages/core/src/missions/seal.ts': /Math\.max\([\w$]+\.ends,[\w$.]+\+[\w$.]+\+[\w$]+\.within\)/,
    // No literal of its own and no stable shape once minified. Held instead at the import graph:
    // packages/core/test/units-unreached.test.ts proves nothing in web/src or the box imports units/
    // (merged 2026-10-10), so no built chunk can carry it.
    'packages/core/src/units/chain.ts': null
  }
};

/**
 * Guarded modules every terminal page already carries, dated, so that the rule can hold from today
 * without pretending today is clean. **It may only shrink:** a module that leaves fails the test
 * below until it is taken off this list, so the room it held cannot be quietly reused.
 *
 * 2026-10-09: the mission package reader rides in core's barrel chunk, which every terminal page
 * and the roster load for signature checking, though only Com reads a mission package. Splitting
 * that chunk is the measurement the retrofit plan's step 24 makes.
 *
 * 2026-10-10: the claim and seal modules ride in the same chunk, and were left off because no
 * fingerprint can see them. Recognised now by their markers [INVISIBLE]. Without them here, step 24
 * taking `package.ts` out would have emptied this list and read as terminal pages free of core
 * missions while two of its modules were still on every one.
 */
const BASELINE = {
  measured: '2026-10-10',
  terminal: ['packages/core/src/missions/package.ts', 'packages/core/src/missions/claim.ts', 'packages/core/src/missions/seal.ts'],
  roster: ['packages/core/src/missions/package.ts', 'packages/core/src/missions/claim.ts', 'packages/core/src/missions/seal.ts']
};

// ─── Recognising a module in a built chunk ────────────────────────────────────────────────────

/** Every file under `roots` that a client chunk could be built from. */
function sourcesUnder(roots: string[], repo = REPO): Sources {
  const out: Sources = new Map();
  for (const root of roots) {
    for (const rel of readdirSync(join(repo, root), { recursive: true }) as string[]) {
      const path = posix.join(root, rel.split('\\').join('/'));
      if (!/\.(ts|js|mjs|svelte)$/.test(path) || /\.(test|spec)\.ts$/.test(path) || path.endsWith('.d.ts')) continue;
      if (statSync(join(repo, path)).isDirectory()) continue;
      out.set(path, readFileSync(join(repo, path), 'utf8'));
    }
  }
  return out;
}

/** Comments say things the bundle never will. A `//` after a colon is a URL, not a comment. */
function uncommented(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

/**
 * A quoted string on one line, read left to right so that the stretch of code between two strings is
 * never taken for one. Group 1 marks an import specifier, which the bundle does not keep.
 */
const LITERAL = /(\bfrom\s*|\bimport\s*\(?\s*)?(['"`])((?:\\.|(?!\2)[^\\\n])*)\2/g;

/**
 * The literals only `path` has. Prose, so a library's own strings cannot collide with one: at
 * least one space and a word in it, printable ASCII, and found in no other source file at all,
 * comments included.
 *
 * In a Svelte file, nothing with a brace or an entity in it. `"{label}. Arrow keys pan"` is an
 * attribute the compiler splits around the expression, and `&amp;` is decoded, so neither is ever
 * in a chunk as written: a print that can match nothing would let a module count as recognisable
 * while nothing could see it.
 */
function fingerprints(sources: Sources, path: string): string[] {
  const prints = new Set<string>();
  for (const m of uncommented(sources.get(path) ?? '').matchAll(LITERAL)) {
    const literal = m[3];
    if (m[1] || literal.length < 16 || /[\\'"`]|\$\{/.test(literal)) continue;
    if (path.endsWith('.svelte') && /[{}&]/.test(literal)) continue;
    if (!/^[\x20-\x7e]+$/.test(literal) || !/\s/.test(literal.trim()) || !/[A-Za-z]{3}/.test(literal)) continue;
    let unique = true;
    for (const [other, text] of sources) {
      if (other !== path && text.includes(literal)) {
        unique = false;
        break;
      }
    }
    if (unique) prints.add(literal);
  }
  return [...prints];
}

/**
 * Fingerprints for every module `guarded` names, or its marker when it has none [INVISIBLE]. A module
 * with neither is left out, and accounted for below.
 */
function printsFor(sources: Sources, guarded: (path: string) => boolean, invisible: Record<string, RegExp | null> = INVISIBLE.modules): Prints {
  const out: Prints = new Map();
  for (const path of sources.keys()) {
    if (!guarded(path)) continue;
    const prints: Print[] = fingerprints(sources, path);
    const marker = invisible[path];
    if (prints.length === 0 && marker) prints.push(marker);
    if (prints.length > 0) out.set(path, prints);
  }
  return out;
}

/** A module that only re-exports carries no code of its own into any chunk. */
const REEXPORT = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"][^'"\n]+['"]\s*;?/g;
function reexportsOnly(text: string): boolean {
  return uncommented(text).replace(REEXPORT, '').trim() === '';
}

/**
 * Guarded modules no fingerprint can find, that neither only re-export nor are on the invisible
 * list: each is a module every rule here would pass over without saying so.
 */
function unaccounted(sources: Sources, guarded: (path: string) => boolean, invisible: Record<string, RegExp | null>): string[] {
  return [...sources.keys()].filter(
    (path) => guarded(path) && fingerprints(sources, path).length === 0 && !reexportsOnly(sources.get(path)!) && !Object.hasOwn(invisible, path)
  );
}

/** Invisible-list entries that are not guarded modules without a fingerprint: gone, or seen now. */
function staleInvisible(sources: Sources, guarded: (path: string) => boolean, invisible: Record<string, RegExp | null>): string[] {
  return Object.keys(invisible).filter((path) => !sources.has(path) || !guarded(path) || fingerprints(sources, path).length > 0);
}

/**
 * The guarded modules whose code is in `files`. `seen` remembers each chunk's answer, because
 * nineteen hundred terminal pages share a few dozen chunks.
 */
function carried(files: Iterable<string>, read: (file: string) => string, prints: Prints, seen = new Map<string, string[]>()): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    let modules = seen.get(file);
    if (!modules) {
      const text = read(file);
      modules = [...prints].filter(([, ps]) => ps.some((p) => (typeof p === 'string' ? text.includes(p) : p.test(text)))).map(([path]) => path);
      seen.set(file, modules);
    }
    for (const module of modules) found.add(module);
  }
  return found;
}

// ─── The rules, as functions a fixture can break ──────────────────────────────────────────────

interface Page {
  name: string;
  files: Iterable<string>;
}

/** Each page whose first paint carries a module `banned` names and `allowed` does not excuse. */
function breaches(pages: Page[], banned: (p: string) => boolean, read: (f: string) => string, prints: Prints, allowed: readonly string[] = []) {
  const guarded: Prints = new Map([...prints].filter(([path]) => banned(path)));
  const seen = new Map<string, string[]>();
  const out: { page: string; module: string }[] = [];
  for (const page of pages) {
    for (const module of carried(page.files, read, guarded, seen)) if (!allowed.includes(module)) out.push({ page: page.name, module });
  }
  return out;
}

/**
 * Each guarded family the app imports of which no module is found in any chunk. Such a family is one
 * every rule here passes while seeing nothing: its fingerprints exist in source and match nothing the
 * build wrote. A family the app does not import yet has nothing in the build to find.
 */
function unseenFamilies(
  families: Record<string, (path: string) => boolean>,
  imported: Set<string>,
  prints: Prints,
  chunks: Iterable<string>,
  read: (file: string) => string
): string[] {
  const files = [...chunks];
  const out: string[] = [];
  for (const [family, inFamily] of Object.entries(families)) {
    const members = [...imported].filter(inFamily);
    if (members.length === 0) continue;
    const own: Prints = new Map([...prints].filter(([path]) => members.includes(path)));
    if (carried(files, read, own).size === 0) out.push(family);
  }
  return out;
}

/** What opening an entry loads, every chunk of it, less the router's pages. */
function entryLoads(manifest: Manifest, key: string): Set<string> {
  return closure(manifest, [key], routeNodes(manifest)).files;
}

const OUT_OF_BOUNDS = ['web/src/lib/terminal/watch-key.ts', 'web/src/lib/terminal/standing.ts', 'web/src/lib/terminal/paging.ts'];
const CONFIG = 'web/src/lib/terminal/config.ts';
/** The two ways into config.ts that write the watch's settings. Reading them is allowed. */
const CONFIG_WRITES = ['saveConfig', 'addOfferedWatch'];

/** A static import's specifier and what it names. `import type` is erased and does not count. */
const IMPORT = /\b(?:import|export)\s+(type\s+)?(?:([^'";]*?)\s*\bfrom\s*)?['"]([^'"\n]+)['"]/g;
/** An `import()` with a literal specifier. */
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
/** A namespace import or `export *`: every export handed over, whatever is named after it. */
const WHOLE = /(?:^|,)\s*\*/;

function resolve(sources: Sources, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = posix.join(posix.dirname(from), spec);
  else if (spec.startsWith('$lib/')) base = `web/src/lib/${spec.slice(5)}`;
  else if (spec === '@navcom/core') base = 'packages/core/src/index';
  else if (spec.startsWith('@navcom/core/')) {
    const rest = spec.slice('@navcom/core/'.length);
    base = rest.startsWith('src/') ? `packages/core/${rest}` : `packages/core/src/${rest}`;
  } else return null;
  const stem = base.replace(/\.js$/, '');
  for (const candidate of [base, `${stem}.ts`, `${stem}.js`, `${stem}.svelte.ts`, `${stem}/index.ts`, `${stem}/index.js`]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Every way a unit or crew module reaches, through static imports however deep, a module that
 * holds or uses the watch's key, a person's standing, paging, or the write path of the watch's
 * settings. A crew is a room among peers [groups.md §5]; none of those are a room's to touch.
 */
function reaches(sources: Sources, roots: string[]) {
  const out: { root: string; reaches: string; via: string[] }[] = [];
  for (const root of roots) {
    const via = new Map<string, string[]>([[root, [root]]]);
    const queue = [root];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const m of uncommented(sources.get(at) ?? '').matchAll(IMPORT)) {
        if (m[1]) continue;
        const target = resolve(sources, at, m[3]);
        if (target === null) continue;
        const path = [...via.get(at)!, target];
        if (OUT_OF_BOUNDS.includes(target)) out.push({ root, reaches: target, via: path });
        if (target === CONFIG) {
          const names = m[2] ?? '';
          const whole = WHOLE.test(names.trim());
          for (const write of CONFIG_WRITES) {
            if (whole || new RegExp(`\\b${write}\\b`).test(names)) out.push({ root, reaches: `${CONFIG} ${write}`, via: path });
          }
        }
        if (!via.has(target)) {
          via.set(target, path);
          queue.push(target);
        }
      }
    }
  }
  return out;
}

/** Every source module `roots` import, statically or by `import()`, however deep. */
function importedBy(sources: Sources, roots: string[]): Set<string> {
  const out = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const at = queue.shift()!;
    const text = uncommented(sources.get(at) ?? '');
    const specs = [...[...text.matchAll(IMPORT)].filter((m) => !m[1]).map((m) => m[3]), ...[...text.matchAll(DYNAMIC)].map((m) => m[1])];
    for (const spec of specs) {
      const target = resolve(sources, at, spec);
      if (target !== null && !out.has(target)) {
        out.add(target);
        queue.push(target);
      }
    }
  }
  return out;
}

// ─── Each rule breaks on a planted violation ──────────────────────────────────────────────────

describe('each rule, broken on purpose', () => {
  const sources: Sources = new Map([
    ['packages/core/src/units/charter.ts', `export const E = 'a charter needs two founding signatures';`],
    ['packages/core/src/missions/package.ts', `throw new Error('mission package has no end time');`],
    ['packages/core/src/relays.ts', `export const NOTE = 'a mission relay keeps everything it is sent';`],
    ['web/src/lib/people/profile.ts', `export const T = 'nobody on this phone has a card yet';`],
    ['web/src/lib/terminal/session.ts', `export const S = 'shared copy for two modules';`],
    ['web/src/lib/terminal/other.ts', `// 'shared copy for two modules' in a comment still counts as having it\nexport const O = 1;`]
  ]);
  const chunks: Record<string, string> = {
    'clean.js': 'var a=1;',
    'units.js': `const x="a charter needs two founding signatures";`,
    'package.js': `throw Error("mission package has no end time")`,
    'relays.js': `const n="a mission relay keeps everything it is sent"`,
    'people.js': `const t='nobody on this phone has a card yet'`
  };
  const read = (f: string) => chunks[f] ?? '';
  const prints = printsFor(sources, () => true);

  it('recognises a module by a literal only it has, never by one it shares or one in a comment', () => {
    expect(prints.get('packages/core/src/units/charter.ts')).toEqual(['a charter needs two founding signatures']);
    expect(prints.has('web/src/lib/terminal/session.ts')).toBe(false);
    expect(fingerprints(new Map([['a.ts', `import x from './a very long module name here.js';\n// 'a comment that is long enough'`]]), 'a.ts')).toEqual([]);
  });

  it('takes no print from a Svelte attribute the compiler rewrites', () => {
    // GridMap's label: the compiler splits it around `{label}`, so no chunk ever holds it as written.
    const svelte = `<div aria-label="{label}. Arrow keys pan, plus and minus zoom" title="Maps &amp; places for the night"></div>`;
    expect(fingerprints(new Map([['web/src/lib/crews/Map.svelte', svelte]]), 'web/src/lib/crews/Map.svelte')).toEqual([]);
    // The same text in a script module is a string, and survives as one.
    const ts = `export const L = '{label}. Arrow keys pan, plus and minus zoom';`;
    expect(fingerprints(new Map([['web/src/lib/crews/map.ts', ts]]), 'web/src/lib/crews/map.ts')).toEqual(['{label}. Arrow keys pan, plus and minus zoom']);
  });

  it('accounts for every guarded module no fingerprint can see, and keeps the list of them honest', () => {
    const tree: Sources = new Map([
      ['packages/core/src/units/chain.ts', `export const KIND = 1913;\nexport function link(a: number) { return a + 1; }`],
      ['packages/core/src/units/listed.ts', `export const NS = 'navcom.unit';`],
      ['packages/core/src/units/index.ts', `/** The barrel. */\nexport * from './chain.js';\nexport { NS } from './listed.js';\nexport type { X } from './x.js';`],
      ['packages/core/src/units/seen.ts', `export const E = 'a statement needs its signature';`],
      ['web/src/lib/terminal/other.ts', `export const O = 1;`]
    ]);
    const guarded = FAMILIES['units and crews'];
    // A module that only re-exports carries nothing; one with code of its own and no print is a gap.
    expect(unaccounted(tree, guarded, { 'packages/core/src/units/listed.ts': /"navcom\.unit"/ })).toEqual(['packages/core/src/units/chain.ts']);
    expect(unaccounted(tree, guarded, { 'packages/core/src/units/chain.ts': null, 'packages/core/src/units/listed.ts': null })).toEqual([]);
    // Listed and seen, listed and gone, listed and not guarded: each is a line that should come off.
    expect(
      staleInvisible(tree, guarded, {
        'packages/core/src/units/chain.ts': null,
        'packages/core/src/units/seen.ts': null,
        'packages/core/src/units/gone.ts': null,
        'web/src/lib/terminal/other.ts': null
      })
    ).toEqual(['packages/core/src/units/seen.ts', 'packages/core/src/units/gone.ts', 'web/src/lib/terminal/other.ts']);
    // A marker recognises the module in a chunk the way a fingerprint does.
    const marked = printsFor(tree, guarded, { 'packages/core/src/units/listed.ts': /"navcom\.unit"/ });
    expect([...carried(['u.js'], () => 'const q="navcom.unit",r=5;', marked)]).toEqual(['packages/core/src/units/listed.ts']);
  });

  it('reports a family the app imports that nothing in the build can be found for', () => {
    const families = { units: FAMILIES['units and crews'], people: FAMILIES.people, missions: FAMILIES['core missions'] };
    // Units: a print exists in source and matches nothing the build wrote. People: one does match.
    // Core missions: the app imports none of it, so there is nothing to find.
    const planted: Prints = new Map([
      ['packages/core/src/units/charter.ts', ['a sentence the build never kept']],
      ['web/src/lib/people/profile.ts', ['nobody on this phone has a card yet']],
      ['packages/core/src/missions/package.ts', ['mission package has no end time']]
    ]);
    const imported = new Set(['packages/core/src/units/charter.ts', 'web/src/lib/people/profile.ts']);
    expect(unseenFamilies(families, imported, planted, ['clean.js', 'people.js'], read)).toEqual(['units']);
  });

  it('follows what the app imports through barrels, aliases and import(), and not through a type', () => {
    const tree: Sources = new Map([
      ['web/src/routes/+page.svelte', `<script>\n  import { a } from '$lib/a';\n  import type { T } from '$lib/t';\n  const open = () => import('$lib/components/missions');\n</script>`],
      ['web/src/lib/a.ts', `import { claim } from '@navcom/core';`],
      ['web/src/lib/t.ts', `import { relay } from './relay';`],
      ['web/src/lib/relay.ts', ''],
      ['web/src/lib/components/missions/index.ts', `export { default as MissionList } from './MissionList.svelte';`],
      ['web/src/lib/components/missions/MissionList.svelte', ''],
      ['packages/core/src/index.ts', `export * from './missions/index.js';`],
      ['packages/core/src/missions/index.ts', `export * from './claim.js';`],
      ['packages/core/src/missions/claim.ts', '']
    ]);
    expect([...importedBy(tree, ['web/src/routes/+page.svelte'])].sort()).toEqual([
      'packages/core/src/index.ts',
      'packages/core/src/missions/claim.ts',
      'packages/core/src/missions/index.ts',
      'web/src/lib/a.ts',
      'web/src/lib/components/missions/MissionList.svelte',
      'web/src/lib/components/missions/index.ts',
      'web/src/routes/+page.svelte'
    ]);
  });

  it('flags a unit module on a terminal page, unless the dated baseline already holds it', () => {
    const pages = [{ name: 'terminal/index.html', files: ['clean.js', 'units.js'] }];
    expect(breaches(pages, ANY_FAMILY, read, prints)).toEqual([{ page: 'terminal/index.html', module: 'packages/core/src/units/charter.ts' }]);
    expect(breaches(pages, ANY_FAMILY, read, prints, ['packages/core/src/units/charter.ts'])).toEqual([]);
    expect(breaches([{ name: 'terminal/index.html', files: ['clean.js'] }], ANY_FAMILY, read, prints)).toEqual([]);
  });

  it('flags the relays chunk at the landing page’s first paint', () => {
    const banned = (p: string) => ROOT_PAINT_OUT.includes(p) || ANY_FAMILY(p);
    expect(breaches([{ name: 'index.html', files: ['relays.js'] }], banned, read, prints)).toEqual([
      { page: 'index.html', module: 'packages/core/src/relays.ts' }
    ]);
  });

  it('flags a people module pulled in by the missions entry, and ignores another route’s page', () => {
    const manifest: Manifest = {
      [MISSIONS_ENTRY]: { file: 'missions.js', isDynamicEntry: true, imports: ['_people.js', '_package.js'], dynamicImports: ['.svelte-kit/generated/client-optimized/nodes/9.js'] },
      '_people.js': { file: 'people.js' },
      '_package.js': { file: 'package.js' },
      '.svelte-kit/generated/client-optimized/nodes/9.js': { file: 'units.js', isEntry: true }
    };
    const found = [...carried(entryLoads(manifest, MISSIONS_ENTRY), read, prints)].filter(PEOPLE_OR_CREWS);
    expect(found).toEqual(['web/src/lib/people/profile.ts']);
  });

  it('flags a crew module that reaches paging, the watch key or the config write path, however deep', () => {
    const tree: Sources = new Map([
      ['web/src/lib/crews/room.ts', `import { helper } from './helper';\nimport type { WatchKey } from '$lib/terminal/watch-key';`],
      ['web/src/lib/crews/helper.ts', `import { page } from '../terminal/paging.js';\nexport const helper = page;`],
      ['web/src/lib/crews/settings.ts', `import {\n  loadConfig,\n  saveConfig\n} from '$lib/terminal/config';`],
      ['web/src/lib/crews/reader.ts', `import { loadConfig } from '$lib/terminal/config';\nimport { DEFAULT_RELAYS } from '@navcom/core';`],
      // Every export handed over at once, the write path with it.
      ['web/src/lib/crews/everything.ts', `import * as config from '$lib/terminal/config';\nexport const keep = () => config.saveConfig();`],
      ['web/src/lib/crews/barrel.ts', `export * from '$lib/terminal/config';`],
      ['packages/core/src/index.ts', `export * from './validate.js';`],
      ['packages/core/src/validate.ts', `export const ok = true;`],
      ['web/src/lib/terminal/paging.ts', 'export const page = 1;'],
      ['web/src/lib/terminal/watch-key.ts', 'export type WatchKey = string;'],
      ['web/src/lib/terminal/config.ts', 'export function saveConfig() {}\nexport function loadConfig() {}']
    ]);
    const found = reaches(tree, [
      'web/src/lib/crews/room.ts',
      'web/src/lib/crews/settings.ts',
      'web/src/lib/crews/reader.ts',
      'web/src/lib/crews/everything.ts',
      'web/src/lib/crews/barrel.ts'
    ]);
    expect(found.map((f) => [f.root, f.reaches])).toEqual([
      ['web/src/lib/crews/room.ts', 'web/src/lib/terminal/paging.ts'],
      ['web/src/lib/crews/settings.ts', 'web/src/lib/terminal/config.ts saveConfig'],
      ['web/src/lib/crews/everything.ts', 'web/src/lib/terminal/config.ts saveConfig'],
      ['web/src/lib/crews/everything.ts', 'web/src/lib/terminal/config.ts addOfferedWatch'],
      ['web/src/lib/crews/barrel.ts', 'web/src/lib/terminal/config.ts saveConfig'],
      ['web/src/lib/crews/barrel.ts', 'web/src/lib/terminal/config.ts addOfferedWatch']
    ]);
    expect(found[0].via).toEqual(['web/src/lib/crews/room.ts', 'web/src/lib/crews/helper.ts', 'web/src/lib/terminal/paging.ts']);
  });
});

// ─── The rules, held on the build that exists ─────────────────────────────────────────────────

describe('the boundaries the built site holds', () => {
  function built() {
    if (!existsSync(join(BUILD, 'index.html'))) throw new Error('No build output. Run `npm run build` first.');
    const manifest = readManifest(MANIFEST);
    if (!manifest) throw new Error('No Vite manifest beside the build.');
    const cache = new Map<string, string>();
    const read = (file: string) => {
      let text = cache.get(file);
      if (text === undefined) {
        text = existsSync(join(BUILD, file)) ? readFileSync(join(BUILD, file), 'utf8') : '';
        cache.set(file, text);
      }
      return text;
    };
    const paint = (page: string): Page => ({ name: page, files: firstPaint(manifest, htmlRefs(read(page), page)) });
    return { manifest, read, paint };
  }
  const sources = sourcesUnder(['web/src', 'packages/core/src']);
  const prints = printsFor(sources, (p) => ANY_FAMILY(p) || ROOT_PAINT_OUT.includes(p));

  it('recognises what it guards, in the chunks that really carry it', () => {
    // A recogniser that sees nothing would pass every rule below. These are known to be in the
    // missions entry today; if minification ever stops leaving them readable, this fails first.
    const { manifest, read } = built();
    const where: [string, string][] = [
      ['web/src/lib/components/missions/MissionPage.svelte', MISSIONS_ENTRY],
      ['web/src/lib/missions/claims.ts', MISSIONS_ENTRY],
      ['packages/core/src/missions/package.ts', MISSIONS_ENTRY],
      ['packages/core/src/relays.ts', MISSIONS_ENTRY],
      ['web/src/lib/terminal/pool.ts', MISSIONS_ENTRY],
      ['web/src/lib/components/grid/GridMap.svelte', 'src/lib/components/grid/GridMap.svelte']
    ];
    for (const [path, entry] of where) {
      expect(prints.has(path), `${path} has no literal of its own left to recognise it by`).toBe(true);
      expect(carried(entryLoads(manifest, entry), read, prints).has(path), `${path} is loaded by ${entry} and was not recognised there`).toBe(true);
    }
  });

  it('finds, in the real build, at least one module of every guarded family the app imports', () => {
    // A print in source proves nothing: GridMap's label was one, and matched no chunk.
    const { manifest, read } = built();
    const imported = importedBy(sources, [...sources.keys()].filter((p) => p.startsWith('web/src/routes/')));
    // The walk itself, or every family would be skipped as not imported and this would pass on nothing.
    expect([...imported].filter(FAMILIES['mission screens']).length, 'the routes import no mission screen').toBeGreaterThan(0);
    expect([...imported].filter(FAMILIES['core missions']).length, 'the routes import nothing of core missions').toBeGreaterThan(0);
    const chunks = Object.values(manifest).map((entry) => entry.file);
    expect(unseenFamilies(FAMILIES, imported, prints, chunks, read), 'imported, and nothing of it found in any chunk').toEqual([]);
  });

  it('names every guarded module no fingerprint can see, and only those', () => {
    const guarded = (p: string) => ANY_FAMILY(p) || ROOT_PAINT_OUT.includes(p);
    expect(unaccounted(sources, guarded, INVISIBLE.modules), `no literal of its own: add it to INVISIBLE (${INVISIBLE.measured}) with a marker, or null`).toEqual([]);
    expect(staleInvisible(sources, guarded, INVISIBLE.modules), `gone or recognisable now: take it off INVISIBLE (${INVISIBLE.measured})`).toEqual([]);
  });

  it('finds each invisible module’s marker in a chunk of the real build', () => {
    // A marker is read off minified code by hand, and the next minifier may write it differently.
    const { manifest, read } = built();
    const texts = Object.values(manifest).map((entry) => read(entry.file));
    for (const [path, marker] of Object.entries(INVISIBLE.modules)) {
      if (marker === null) continue;
      expect(texts.some((text) => marker.test(text)), `${path}'s marker matches no chunk: read the chunk again, or set it to null`).toBe(true);
    }
  });

  it('keeps every guarded module off every terminal page, beyond the dated baseline', () => {
    const { paint, read } = built();
    const pages = (readdirSync(join(BUILD, 'terminal'), { recursive: true }) as string[])
      .filter((f) => f.endsWith('.html'))
      .map((f) => paint(posix.join('terminal', f.split('\\').join('/'))));
    expect(pages.length).toBeGreaterThan(1);
    expect(breaches(pages, ANY_FAMILY, read, prints, BASELINE.terminal)).toEqual([]);
    // Only shrinks: a module that has left the terminal comes off the list.
    const still = new Set(breaches(pages, ANY_FAMILY, read, prints).map((b) => b.module));
    expect(BASELINE.terminal.filter((m) => !still.has(m)), `not found on any terminal page: it left, or nothing recognises it any more; remove it from the ${BASELINE.measured} baseline only once you know which`).toEqual([]);
  });

  it('keeps people, crews and the mission screens off the roster, beyond the dated baseline', () => {
    const { paint, read } = built();
    const roster = [paint('who/index.html')];
    expect(breaches(roster, ANY_FAMILY, read, prints, BASELINE.roster)).toEqual([]);
    const still = new Set(breaches(roster, ANY_FAMILY, read, prints).map((b) => b.module));
    expect(BASELINE.roster.filter((m) => !still.has(m)), `not found on the roster: it left, or nothing recognises it any more; remove it from the ${BASELINE.measured} baseline only once you know which`).toEqual([]);
  });

  it('keeps the relays chunk and every guarded module out of the landing page’s first paint', () => {
    const { paint, read } = built();
    expect(breaches([paint('index.html')], (p) => ROOT_PAINT_OUT.includes(p) || ANY_FAMILY(p), read, prints)).toEqual([]);
  });

  it('loads no people or crews module when a mission opens', () => {
    const { manifest, read } = built();
    expect(manifest[MISSIONS_ENTRY], 'the missions entry is gone from the manifest').toBeDefined();
    expect([...carried(entryLoads(manifest, MISSIONS_ENTRY), read, prints)].filter(PEOPLE_OR_CREWS)).toEqual([]);
  });

  it('lets no unit or crew module reach the watch key, standing, paging or the config write path', () => {
    const roots = [...sources.keys()].filter(FAMILIES['units and crews']);
    expect(reaches(sources, roots)).toEqual([]);
  });
});
