/**
 * Every field the app keeps is declared, in the tier it is kept in [fields.ts].
 *
 * The registry is only as good as its coverage: a field written and not declared is never sealed
 * into a backup, so somebody's record would be missing from the one artifact meant to survive a
 * lost phone. This reads the source the way a reviewer would, and fails on any field it finds that
 * the registry does not list.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCRUING_FIELDS, WIPEABLE_FIELDS, carryOf } from './fields';
import { MAX_RESTORED_KEYS } from './backup';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

type Tier = 'accruing' | 'wipeable';
interface Use {
  /** Null where the tier is chosen at run time, as the patrol record's is. */
  tier: Tier | null;
  /** Null where the name could not be read from the source. */
  field: string | null;
  text: string;
}

/**
 * The index just past a balanced `<…>` starting at `at`, or -1 for one that does not close within
 * a few hundred characters. A type argument may hold `(a) => b` and `{ ends: number }`.
 */
function pastTypeArgs(source: string, at: number): number {
  let depth = 0;
  for (let i = at; i < Math.min(source.length, at + 400); i++) {
    const c = source[i];
    if (c === '<') depth++;
    // `=>` inside a type argument is an arrow, not a closing bracket.
    else if (c === '>' && source[i - 1] !== '=' && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Calls to storage's get, set and clearField in one file that imports it; null for one that does not.
 *
 * **Two passes, so it fails closed.** One pattern that both found a call and read its arguments
 * skipped every call it could not read — a double-quoted or template field, `KEYS.crews`,
 * `prefix + 'x'`, a type argument holding parentheses — and a computed key is the likely shape of a
 * keyed store. So every call of an imported name is found first, loosely, and only then read: one
 * whose tier or field is not a literal or a known constant comes back with a null field, which is a
 * problem unless `READ_BY_HAND` excuses it.
 */
export function usesIn(source: string): Use[] | null {
  const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*\/storage'/g)];
  if (imports.length === 0) return null;
  // A renamed import would let a call past this scan unread.
  for (const [, names] of imports) if (/\bas\b/.test(names!)) throw new Error(`storage imported under another name: ${names}`);
  const imported = new Set(imports.flatMap(([, names]) => names!.split(',').map((n) => n.replace(/^\s*type\s+/, '').trim())));
  const accessors = ['get', 'set', 'clearField'].filter((n) => imported.has(n));
  if (accessors.length === 0) return [];
  const consts = new Map([...source.matchAll(/\bconst ([A-Z_]+) = '([a-z_]+)';/g)].map((m) => [m[1]!, m[2]!]));
  const uses: Use[] = [];
  const name = new RegExp(`(?<![.\\w$])(?:${accessors.join('|')})\\s*(?=[<(])`, 'g');
  const args = /\(\s*('accruing'|'wipeable'|[A-Za-z_$][\w$]*(?:\(\))?)\s*,\s*('[^']*'|[A-Za-z_$][\w$]*)\s*[,)]/y;
  for (const m of source.matchAll(name)) {
    let at = m.index! + m[0].length;
    if (source[at] === '<') at = pastTypeArgs(source, at);
    while (at >= 0 && /\s/.test(source[at] ?? '')) at++;
    // A type argument this cannot close is a call it cannot read, and says so.
    if (at < 0) {
      uses.push({ tier: null, field: null, text: source.slice(m.index!, m.index! + 60) });
      continue;
    }
    // A name with no call after it, such as `get` in a type: nothing to read.
    if (source[at] !== '(') continue;
    args.lastIndex = at;
    const read = args.exec(source);
    const text = source.slice(m.index!, read ? args.lastIndex : source.indexOf(')', at) + 1 || at + 40);
    if (!read) {
      uses.push({ tier: null, field: null, text });
      continue;
    }
    const [, tier, field] = read as unknown as [string, string, string];
    uses.push({
      tier: tier.startsWith("'") ? (tier.slice(1, -1) as Tier) : null,
      field: field.startsWith("'") ? field.slice(1, -1) : (consts.get(field) ?? null),
      text
    });
  }
  return uses;
}

const declared = (tier: Tier, field: string) =>
  tier === 'accruing' ? carryOf(field) !== null : (WIPEABLE_FIELDS as readonly string[]).includes(field);

/** What a use gets wrong, or null. */
function undeclared(use: Use): string | null {
  if (use.field === null) return `cannot read the field in ${use.text}`;
  const tiers: Tier[] = use.tier ? [use.tier] : ['accruing', 'wipeable'];
  const missing = tiers.filter((t) => !declared(t, use.field!));
  return missing.length ? `${missing.join(' and ')} field "${use.field}" is not in fields.ts` : null;
}

/**
 * Calls whose field is a variable, each with why it can only be a declared one. Checked to still
 * exist, so a reason cannot outlive its code.
 */
const READ_BY_HAND: Record<string, { text: RegExp; why: string; fields: string[] }> = {
  'lib/terminal/backup.ts': {
    text: /^set\('accruing', key,$/,
    why: 'restore writes only the entries carryOf() says a kit carries',
    fields: []
  },
  'lib/terminal/funding.ts': {
    text: /^(?:set|clearField)\('accruing', field[,)]$/,
    why: 'save(field) is only ever called with MINE or SQUAD',
    fields: ['lightning', 'lightning_squad']
  }
};

describe('every field the app keeps is declared', () => {
  const found: { file: string; use: Use }[] = [];
  for (const path of sources(SRC)) {
    const file = relative(SRC, path).split('\\').join('/');
    const uses = usesIn(readFileSync(path, 'utf8'));
    for (const use of uses ?? []) found.push({ file, use });
  }

  it('reads enough of the source to mean something', () => {
    expect(found.length).toBeGreaterThan(60);
    // Known ones, in each shape this has to read: literal, constant, and a tier chosen at run time.
    expect(found).toContainEqual(expect.objectContaining({ file: 'lib/terminal/identity.ts', use: expect.objectContaining({ tier: 'accruing', field: 'secret' }) }));
    expect(found).toContainEqual(expect.objectContaining({ file: 'lib/missions/live.ts', use: expect.objectContaining({ tier: 'wipeable', field: 'missions' }) }));
    expect(found).toContainEqual(expect.objectContaining({ file: 'lib/terminal/patrol.ts', use: expect.objectContaining({ tier: null, field: 'patrols' }) }));
    expect(found).toContainEqual(expect.objectContaining({ file: 'routes/+page.svelte', use: expect.objectContaining({ field: 'mission_claims' }) }));
  });

  it('in the tier it is kept in', () => {
    const problems = found
      .filter(({ file, use }) => !(use.field === null && READ_BY_HAND[file]?.text.test(use.text)))
      .map(({ file, use }) => {
        const wrong = undeclared(use);
        return wrong && `${file}: ${wrong}`;
      })
      .filter(Boolean);
    expect(problems).toEqual([]);
  });

  it('and each call read by hand is still there, with its fields declared', () => {
    for (const [file, { text, fields }] of Object.entries(READ_BY_HAND)) {
      expect(found.some((f) => f.file === file && text.test(f.use.text)), `${file} no longer has the call it was excused for`).toBe(true);
      for (const field of fields) expect(carryOf(field), field).not.toBeNull();
    }
    // Funding's reason is checked rather than taken on its word: `save` is only called with these.
    const funding = readFileSync(join(SRC, 'lib/terminal/funding.ts'), 'utf8');
    const saves = [...funding.matchAll(/(?<!function )\bsave\(\s*([^,)\s]+)/g)].map((m) => m[1]);
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.filter((a) => a !== 'MINE' && a !== 'SQUAD')).toEqual([]);
  });

  it('catches a field somebody writes without declaring it', () => {
    const planted = `import { set } from '$lib/terminal/storage';\nconst ROSTER = 'crews';\nset('wipeable', ROSTER, []);\nset('accruing', 'crew_key', 'x');`;
    expect(usesIn(planted)!.map(undeclared)).toEqual([
      'wipeable field "crews" is not in fields.ts',
      'accruing field "crew_key" is not in fields.ts'
    ]);
  });

  it('reports a call it cannot read, rather than skipping it', () => {
    // Each of these passed unread: the pattern that found a call was the one that read it, so a
    // call it could not read was a call it never found. A computed key is how a keyed store looks.
    const planted = [
      `import { get, set } from '$lib/terminal/storage';`,
      `set('accruing', "crews", 1);`,
      'set(\'accruing\', `crew_${id}`, 1);',
      `set('accruing', KEYS.crews, 1);`,
      `set('wipeable', prefix + 'x', 1);`,
      `get<Map<string, (a: number) => void>>('accruing', 'cb');`
    ].join('\n');
    expect(usesIn(planted)!.map(undeclared)).toEqual([
      `cannot read the field in set('accruing', "crews", 1)`,
      'cannot read the field in set(\'accruing\', `crew_${id}`, 1)',
      `cannot read the field in set('accruing', KEYS.crews, 1)`,
      `cannot read the field in set('wipeable', prefix + 'x', 1)`,
      'accruing field "cb" is not in fields.ts'
    ]);
  });

  it('catches storage imported under another name, which would hide every call', () => {
    expect(() => usesIn(`import { set as keep } from './storage';\nkeep('accruing', 'crews', 1);`)).toThrow(/another name/);
  });

  it('is never imported by storage itself, which is on the root page’s first paint', () => {
    expect(readFileSync(join(SRC, 'lib/terminal/storage.ts'), 'utf8')).not.toMatch(/from '\.\/fields'/);
  });
});

describe('what a kit may carry', () => {
  it('every kit this build can make, restore accepts', () => {
    // A kit restore refused would be a backup that holds nothing, found out on the day it is needed.
    const carried = Object.values(ACCRUING_FIELDS).filter((c) => c !== 'device');
    expect(carried.length).toBeLessThanOrEqual(MAX_RESTORED_KEYS);
  });

  it('never carries the keys this phone keeps for itself', () => {
    for (const field of ['relays_own', 'kem_keys', 'watch_secret', 'watch_founded']) {
      expect(carryOf(field), field).toBe('device');
    }
  });

  it('reads nothing off an object’s prototype as a declaration', () => {
    // A kit is JSON somebody handed over, and `__proto__` is a key JSON can carry.
    for (const field of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect(carryOf(field), field).toBeNull();
  });
});
