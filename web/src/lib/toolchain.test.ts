/**
 * The checks before the checks: which Node runs them, and what `npm run check` reads.
 *
 * Both failed quietly. A shell on Node 18 failed about thirty unit tests with an error that
 * reads like a crypto regression. And the browser suite, the Playwright configs and the build
 * scripts were never type-checked at all, because svelte-check reads `src/` only and Vitest and
 * Playwright strip types without checking them.
 */

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compare } from '../../scripts/preflight.mjs';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const TSC = createRequire(join(WEB, 'package.json')).resolve('typescript/bin/tsc');

/** Every file under `dir` whose name passes `keep`, relative to `web/`. */
function files(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (keep(name)) out.push(relative(WEB, full).split('\\').join('/'));
    }
  };
  walk(join(WEB, dir));
  return out;
}

describe('npm run check type-checks the suite and the scripts', () => {
  it('runs the e2e type-check', () => {
    const scripts = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')).scripts;
    expect(scripts.check).toMatch(/(^|&&)\s*tsc -p tsconfig\.e2e\.json\s*($|&&)/);
  });

  it('and that type-check reads every spec, every Playwright config and every script', async () => {
    const listed = await new Promise<string>((done, fail) => {
      const child = spawn(process.execPath, [TSC, '-p', 'tsconfig.e2e.json', '--listFilesOnly'], { cwd: WEB });
      let out = '';
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (out += c));
      child.on('close', (status) => (status === 0 ? done(out) : fail(new Error(out))));
    });
    const read = new Set(
      listed
        .split('\n')
        .filter(Boolean)
        .map((f) => relative(WEB, f.trim()).split('\\').join('/'))
    );
    const wanted = [
      ...files('e2e', (n) => n.endsWith('.ts')),
      ...files('scripts', (n) => /\.(mjs|js|ts)$/.test(n)),
      ...readdirSync(WEB).filter((n) => /^playwright.*\.config\.ts$/.test(n))
    ];
    expect(wanted.length).toBeGreaterThan(50);
    expect(wanted.filter((f) => !read.has(f))).toEqual([]);
  });
});

describe('the Node preflight', () => {
  it('says nothing on the pinned version', () => {
    expect(compare('22.23.2\n', 'v22.23.2', {})).toEqual({ ok: true, say: null });
    expect(compare('v22\n', 'v22.23.2', {})).toEqual({ ok: true, say: null });
  });

  it('refuses another major, and names the error it would otherwise cause', () => {
    const r = compare('22.23.2', 'v18.16.0', {});
    expect(r.ok).toBe(false);
    expect(r.say).toMatch(/Node 18\.16\.0 is running, and \.nvmrc pins 22\.23\.2/);
    expect(r.say).toMatch(/crypto\.getRandomValues/);
    expect(r.say).toMatch(/nvm use/);
  });

  it('carries on, saying so, inside the same major', () => {
    const r = compare('22.23.2', 'v22.11.0', {});
    expect(r.ok).toBe(true);
    expect(r.say).toMatch(/Same major/);
  });

  it("warns rather than refuses on Vercel, whose Node is a setting this repository can't see", () => {
    const r = compare('22.23.2', 'v20.18.0', { VERCEL: '1' });
    expect(r.ok).toBe(true);
    expect(r.say).toMatch(/^\[preflight\] warning:/);
  });

  it('refuses an .nvmrc it cannot read rather than passing it', () => {
    expect(compare('lts/*', 'v22.23.2', {}).ok).toBe(false);
  });
});
