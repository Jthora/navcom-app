/**
 * The Spheres, as NavCom vendors and reads them [docs/design/map.md, Spheres; D9].
 *
 * The vendoring script first, run for real: it refuses what its checks refuse and writes nothing, it
 * takes a repository's lists at a commit and by the manifest's digest, it refuses a member it has
 * nowhere to draw, and it will not ship NavCom's own fixture. Then what it writes, read the way the map
 * reads it. **Nothing synthetic ships**: `static/grid/spheres.json` is Mecha Jono's Part 2 lists, vendored
 * 26 Oct, and the browser tests serve the fixture by route.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decode, type Topology } from './topology';
import { spheresOf, type SpheresFile } from './layers/spheres';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const CORE_FIXTURE = join(WEB, '../packages/core/test/fixtures/spheres');
const E2E_FIXTURE = join(WEB, 'e2e/fixtures/spheres.json');
const STATIC = join(WEB, 'static/grid/spheres.json');
const SCRIPT = join(WEB, 'scripts/spheres-vendor.mjs');
const LABELS = join(WEB, 'scripts/data/label-points.json');

const vendor = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: WEB, encoding: 'utf8' });
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const outFile = () => join(mkdtempSync(join(tmpdir(), 'navcom-spheres-')), 'spheres.json');

/** The core fixture copied somewhere it can be changed. */
function copyOfFixture(edit: (m: Record<string, any>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'navcom-spheres-in-'));
  const m = json<Record<string, any>>(join(CORE_FIXTURE, 'manifest.json'));
  edit(m);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  return dir;
}

describe('the vendoring script', () => {
  it('makes the e2e fixture out of the core fixture, byte for byte, as a draft', () => {
    const out = outFile();
    const ran = vendor('--dir', CORE_FIXTURE, '--out', out);
    expect(ran.status, ran.stderr).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(readFileSync(E2E_FIXTURE, 'utf8'));
    expect(json<SpheresFile>(out).navcom).toMatchObject({ draft: true, source: 'navcom-test-fixture', credit: 'NavCom test fixture, never shipped', unread: 0 });
  });

  it('writes a point for each small member only: the four with no outline at the world’s scale', () => {
    const file = json<SpheresFile>(E2E_FIXTURE);
    expect(Object.keys(file.points).sort()).toEqual(['bb', 'mt', 'mu', 'sg']);
    const labels = json<{ points: Record<string, [number, number]> }>(LABELS).points;
    for (const [code, at] of Object.entries(file.points)) expect(at, code).toEqual(labels[code]);
  });

  it('never ships the fixture, or any working tree: neither is written where the map reads from', () => {
    const before = existsSync(STATIC);
    const ran = vendor('--dir', CORE_FIXTURE);
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/a working tree never ships/);
    expect(existsSync(STATIC)).toBe(before);
  });

  it('refuses a manifest whose digest is not the one given, and lists with any problem, writing nothing', () => {
    const out = outFile();
    const wrong = vendor('--dir', CORE_FIXTURE, '--out', out, '--manifest-sha256', '0'.repeat(64));
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toMatch(/not the manifest that was reviewed/);
    const uncited = copyOfFixture((m) => (m.spheres[1].sources = []));
    const bad = vendor('--dir', uncited, '--out', out);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/test-francophonie: cites no source/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a member it has nowhere to draw, by name, rather than leave it off the map unsaid', () => {
    // A code in the right form with no outline at the world's scale and no label point: no such country.
    const dir = copyOfFixture((m) => m.spheres[0].members.push({ code: 'xq' }));
    const out = outFile();
    const ran = vendor('--dir', dir, '--out', out);
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/nowhere to draw xq/);
    expect(existsSync(out)).toBe(false);
  });

  it('takes a repository’s lists at the commit it is given, by digest, never from its working tree', () => {
    const repo = mkdtempSync(join(tmpdir(), 'navcom-spheres-repo-'));
    const lists = join(repo, 'public/geopolitical/spheres');
    mkdirSync(lists, { recursive: true });
    cpSync(join(CORE_FIXTURE, 'manifest.json'), join(lists, 'manifest.json'));
    const git = (...a: string[]) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'lists');
    const commit = git('rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(lists, 'manifest.json'), '{"changed": "and not committed"}');
    const digest = sha(readFileSync(join(CORE_FIXTURE, 'manifest.json')));
    const out = outFile();
    const ran = vendor('--repo', repo, '--commit', commit, '--manifest-sha256', digest, '--out', out, '--credit', 'a test', '--final');
    expect(ran.status, ran.stderr).toBe(0);
    expect(json<SpheresFile>(out).navcom).toMatchObject({ manifest_sha256: digest, draft: false, credit: 'a test' });
    const blind = vendor('--repo', repo, '--commit', commit, '--out', outFile());
    expect(blind.status).toBe(1);
    expect(blind.stderr).toMatch(/--manifest-sha256 is required/);
  });
});

describe('the file the map reads', () => {
  it('is in this build only once real lists are vendored, and never the fixture', () => {
    if (!existsSync(STATIC)) return;
    expect(json<SpheresFile>(STATIC).navcom.source).toMatch(/^starcom-app@[0-9a-f]{40}:/);
  });

  it('names, for each Sphere, the countries it shades and the circles it draws', () => {
    const world = decode(json<Topology>(join(WEB, 'static/grid/world.json')))['world']!.shapes;
    const spheres = spheresOf(json<SpheresFile>(E2E_FIXTURE), world);
    const anglo = spheres.find((s) => s.id === 'sphere:test-anglosphere')!;
    expect(anglo.shapes.map((s) => s.id).sort()).toEqual(['ca', 'gb', 'ie', 'us']);
    expect(anglo.circles.map((c) => c.code).sort()).toEqual(['bb', 'mt', 'mu', 'sg']);
    const franco = spheres.find((s) => s.id === 'sphere:test-francophonie')!;
    expect(franco.shapes.map((s) => s.id).sort()).toEqual(['ca', 'fr']);
    expect(franco.circles.map((c) => c.code)).toEqual(['mu']);
  });
});

describe('the service worker', () => {
  it('caches the lists on first use and never in its install precache, as every layer’s data', () => {
    const source = readFileSync(join(WEB, 'src/service-worker.ts'), 'utf8');
    const body = /const isLayerData = \(f: string\) => (.+);/.exec(source)?.[1];
    expect(body, 'isLayerData moved: read it from where it went').toBeDefined();
    const isLayerData = new Function('f', 'base', `return ${body};`) as (f: string, base: string) => boolean;
    expect(isLayerData('/grid/spheres.json', '')).toBe(true);
    expect(isLayerData('/grid/zsp/outlines.json', '')).toBe(true);
    expect(isLayerData('/grid/world.json', ''), 'the map’s own geometry is installed').toBe(false);
  });
});

