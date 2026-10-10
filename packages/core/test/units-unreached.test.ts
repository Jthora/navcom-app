import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import {
  KIND_ANSWER_SIGNATURE, KIND_CREW_EVENT, KIND_CREW_STATEMENT, KIND_DISTRESS, KIND_RESPONSE, KIND_SIGNAL,
  KIND_WATCH_CODE_SIGNATURE, isEphemeral
} from '../src/events/kinds.js';
import * as kinds from '../src/events/kinds.js';

/**
 * The units code is a new composition on a boundary that protects people. Until somebody who did
 * not write it has reviewed it, nothing a person can reach may use it. This makes that structural
 * rather than a sentence in a docblock: core's own `./src/*` export would let a screen import it.
 */

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const UNREVIEWED = 'needs outside review before any screen uses it';

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const at = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(at));
    else if (/\.(ts|js|mjs|svelte)$/.test(entry.name)) out.push(at);
  }
  return out;
}

describe('nothing a person can reach uses units/ yet', () => {
  const places = [join(repo, 'web/src'), join(repo, 'packages/watchtower/src')];

  it('looks somewhere real', () => {
    // A glob that matches nothing passes beautifully, so make silence fail.
    expect(places.map(sources).flat().length).toBeGreaterThan(50);
  });

  it.each(places.map((p) => ({ p, name: p.slice(repo.length) })))('$name does not import units/', ({ p }) => {
    const offenders = sources(p).filter((f) => /from\s+['"][^'"]*units\/|import\(\s*['"][^'"]*units\//.test(readFileSync(f, 'utf8')));
    expect(offenders, UNREVIEWED).toEqual([]);
  });

  it('is not re-exported from the package root, and has no subpath', () => {
    for (const name of ['evaluate', 'readCharter', 'sealCrewState', 'signStatement', 'linearize']) {
      expect(name in core, `${name}: ${UNREVIEWED}`).toBe(false);
    }
    const pkg = JSON.parse(readFileSync(join(repo, 'packages/core/package.json'), 'utf8')) as { exports: Record<string, unknown> };
    expect(Object.keys(pkg.exports).some((k) => k.includes('units')), UNREVIEWED).toBe(false);
  });
});

describe('the two crew kinds', () => {
  it('1913 is regular and stored; 20917 is ephemeral and never published', () => {
    expect(KIND_CREW_EVENT).toBe(1913);
    expect(KIND_CREW_EVENT >= 1000 && KIND_CREW_EVENT <= 9999).toBe(true);
    expect(isEphemeral(KIND_CREW_EVENT)).toBe(false);
    expect(KIND_CREW_STATEMENT).toBe(20917);
    expect(isEphemeral(KIND_CREW_STATEMENT)).toBe(true);
  });

  it('collide with no other kind', () => {
    const numbers = Object.entries(kinds).filter(([k, v]) => k.startsWith('KIND_') && typeof v === 'number').map(([, v]) => v);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([KIND_ANSWER_SIGNATURE, KIND_WATCH_CODE_SIGNATURE]).not.toContain(KIND_CREW_STATEMENT);
  });

  it('no unit statement uses a Distress kind, 20910 to 20912', () => {
    const dir = fileURLToPath(new URL('../src/units/', import.meta.url));
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/\b2091[012]\b/);
      expect(src, f).not.toMatch(/KIND_(SIGNAL|DISTRESS|RESPONSE)\b/);
    }
    expect([KIND_SIGNAL, KIND_DISTRESS, KIND_RESPONSE]).toEqual([20910, 20911, 20912]);
  });
});
