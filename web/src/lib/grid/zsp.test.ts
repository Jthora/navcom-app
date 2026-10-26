/**
 * Starcom's Zones, as NavCom vendors and reads them [docs/design/map.md, Zones; D6, D7, D10].
 *
 * The vendoring script first, run for real: it refuses what its checks refuse and writes nothing, it
 * takes a repository's files at a commit and by the manifest's digest rather than whatever a working
 * tree holds, and it will not ship NavCom's own fixture. Then the files it writes, read the way the
 * map reads them: the e2e fixture, which is what the script makes of the core fixture, and whatever is
 * committed under `static/grid/zsp/`, which until Stage 1 lands (23 Oct) is nothing at all.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkPartition, holds, placeAt, zspIndex } from '@navcom/core/zones';
import { decode, lonLat, type Topology } from './topology';
import { chainOf, edgesOf, outlinesOf, sectorsOf, type ZonesOutlines } from './layers/zones';
import { indexOf } from './layers/zones-lookup';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const CORE_FIXTURE = join(WEB, '../packages/core/test/fixtures/zsp');
const E2E_FIXTURE = join(WEB, 'e2e/fixtures/zsp');
const STATIC = join(WEB, 'static/grid/zsp');
const SCRIPT = join(WEB, 'scripts/zsp-vendor.mjs');

/**
 * The script, run for real, without blocking this worker: run with `spawnSync`, each run held the event
 * loop for 9 s here and longer on Vercel's builder, Vitest's `onTaskUpdate` went unanswered, and a deploy
 * failed over a suite that had passed whole (26 Oct, as e947f5bc found for the corpus scans).
 */
const vendor = (...args: string[]) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: WEB });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;

/** The core fixture copied somewhere it can be broken, with the manifest re-hashed to match. */
function copyOfFixture(edit?: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'navcom-zsp-'));
  cpSync(CORE_FIXTURE, dir, { recursive: true });
  if (edit) {
    edit(dir);
    const manifest = json<{ containers: { file: string; sha256: string; bytes: number }[] }>(join(dir, 'manifest.json'));
    for (const c of manifest.containers) {
      const body = readFileSync(join(dir, c.file));
      c.sha256 = sha(body);
      c.bytes = body.length;
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  }
  return dir;
}

describe('the vendoring script', () => {
  /** Somewhere to write that is named as `--out` must be, and is nowhere the map reads from. */
  const outDir = () => join(mkdtempSync(join(tmpdir(), 'navcom-zsp-out-')), 'zsp');

  it('makes the e2e fixture out of the core fixture, byte for byte', async () => {
    const out = outDir();
    const ran = await vendor('--dir', CORE_FIXTURE, '--stage', 'final', '--out', out);
    expect(ran.status, ran.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual(readdirSync(E2E_FIXTURE).sort());
    for (const f of readdirSync(out)) expect(readFileSync(join(out, f), 'utf8'), f).toBe(readFileSync(join(E2E_FIXTURE, f), 'utf8'));
  }, 120_000);

  it('refuses a partition with a gap in it, says where, and writes nothing', async () => {
    const dir = copyOfFixture((d) => {
      const file = join(d, 'terra-europaea.zsp.geojson');
      const doc = json<{ features: { properties: { id: string } }[] }>(file);
      doc.features = doc.features.filter((f) => f.properties.id !== 'zone:europaea-east/sector:north');
      writeFileSync(file, JSON.stringify(doc));
    });
    const out = join(mkdtempSync(join(tmpdir(), 'navcom-zsp-out-')), 'zsp');
    const ran = await vendor('--dir', dir, '--stage', 'final', '--out', out);
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/nothing written/);
    expect(ran.stderr).toMatch(/in no Sector/);
    expect(existsSync(out), 'a refused partition wrote its files').toBe(false);
  });

  it('refuses a manifest that is not the one whose digest it was given', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'navcom-zsp-out-')), 'zsp');
    const ran = await vendor('--dir', CORE_FIXTURE, '--stage', 'final', '--out', out, '--manifest-sha256', '0'.repeat(64));
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/not the manifest that was reviewed/);
    expect(existsSync(out)).toBe(false);
  });

  it('never ships the fixture: it will not write it where the map reads from', async () => {
    const before = existsSync(STATIC) ? readdirSync(STATIC).sort() : null;
    const ran = await vendor('--dir', CORE_FIXTURE, '--stage', 'final');
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/never ships/);
    expect(existsSync(STATIC) ? readdirSync(STATIC).sort() : null).toEqual(before);
  });

  it('will not write a working tree where the map reads from, whatever its manifest calls its maker', async () => {
    // The fixture under another generator's name: --dir is refused for static/grid/zsp/ by what it is, not what it says.
    const dir = copyOfFixture((d) => {
      const m = json<Record<string, unknown>>(join(d, 'manifest.json'));
      m.generator = 'mecha-jono-export';
      writeFileSync(join(d, 'manifest.json'), JSON.stringify(m));
    });
    const before = existsSync(STATIC) ? readdirSync(STATIC).sort() : null;
    const ran = await vendor('--dir', dir, '--stage', 'final', '--credit', 'a test');
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/a working tree never ships/);
    expect(existsSync(STATIC) ? readdirSync(STATIC).sort() : null, 'a working tree was written where the map reads from').toEqual(before);
  });

  it('writes only to a directory named zsp, so a mistyped --out is refused before anything is read', async () => {
    const grid = mkdtempSync(join(tmpdir(), 'navcom-zsp-grid-'));
    writeFileSync(join(grid, 'world.json'), '{"navcom": {"source": "the world"}}');
    const ran = await vendor('--dir', CORE_FIXTURE, '--stage', 'final', '--out', grid);
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/--out must be a directory named zsp/);
    expect(readdirSync(grid)).toEqual(['world.json']);
  });

  it('replaces what an earlier vendoring wrote, and nothing else beside it', async () => {
    const out = outDir();
    mkdirSync(out, { recursive: true });
    // A container a stage dropped, which must not linger, and a file no vendoring wrote, which must not go.
    writeFileSync(join(out, 'terra-gone.json'), JSON.stringify({ navcom: { manifest_sha256: '0'.repeat(64) } }));
    writeFileSync(join(out, 'world.json'), JSON.stringify({ navcom: { source: 'the world' } }));
    const ran = await vendor('--dir', CORE_FIXTURE, '--stage', 'final', '--out', out);
    expect(ran.status, ran.stderr).toBe(0);
    expect(existsSync(join(out, 'terra-gone.json')), 'an earlier stage’s container lingered').toBe(false);
    expect(existsSync(join(out, 'world.json')), 'a file no vendoring wrote was deleted').toBe(true);
    expect(existsSync(join(out, 'outlines.json'))).toBe(true);
  }, 120_000);

  it('takes a repository’s files at the commit it is given, by digest, and never from its working tree', async () => {
    // A stand-in for starcom-app: the fixture committed where the export lands, then changed and not committed.
    const repo = mkdtempSync(join(tmpdir(), 'navcom-zsp-repo-'));
    const zones = join(repo, 'public/geopolitical/zones');
    mkdirSync(zones, { recursive: true });
    cpSync(CORE_FIXTURE, zones, { recursive: true });
    const git = (...a: string[]) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'stage');
    const commit = git('rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(zones, 'terra-sinica.zsp.geojson'), '{"changed": "and not committed"}');
    const digest = sha(readFileSync(join(CORE_FIXTURE, 'manifest.json')));

    const out = outDir();
    const ran = await vendor('--repo', repo, '--commit', commit, '--manifest-sha256', digest, '--stage', 'final', '--out', out, '--credit', 'a test');
    expect(ran.status, ran.stderr).toBe(0);
    const outlines = json<Topology & { navcom: { source: string; manifest_sha256: string } }>(join(out, 'outlines.json'));
    expect(outlines.navcom.source).toBe('navcom-test-fixture');
    expect(outlines.navcom.manifest_sha256).toBe(digest);
    // Without the digest it does not run at all: vendor what was reviewed.
    const blind = await vendor('--repo', repo, '--commit', commit, '--stage', 'final', '--out', out);
    expect(blind.status).toBe(1);
    expect(blind.stderr).toMatch(/--manifest-sha256 is required/);
  }, 120_000);

  it('reads Starcom’s drafts folder with --folder zones-draft, and never as the final set', async () => {
    // Starcom keeps a draft in public/geopolitical/zones-draft/ until its swap moves it (26 Oct).
    const repo = mkdtempSync(join(tmpdir(), 'navcom-zsp-repo-'));
    const drafts = join(repo, 'public/geopolitical/zones-draft');
    mkdirSync(drafts, { recursive: true });
    cpSync(CORE_FIXTURE, drafts, { recursive: true });
    const git = (...a: string[]) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'draft');
    const commit = git('rev-parse', 'HEAD').stdout.trim();
    const digest = sha(readFileSync(join(CORE_FIXTURE, 'manifest.json')));
    const at = ['--repo', repo, '--commit', commit, '--manifest-sha256', digest, '--credit', 'a test'];

    const final = await vendor(...at, '--folder', 'zones-draft', '--stage', 'final', '--out', outDir());
    expect(final.status).toBe(1);
    expect(final.stderr).toMatch(/holds drafts/);
    expect((await vendor(...at, '--stage', '3', '--out', outDir())).status, 'read zones/, where nothing is').toBe(1);
    const out = outDir();
    const ran = await vendor(...at, '--folder', 'zones-draft', '--stage', '3', '--out', out);
    expect(ran.status, ran.stderr).toBe(0);
    expect(json<{ navcom: { draft: boolean; stage: string } }>(join(out, 'outlines.json')).navcom).toMatchObject({ draft: true, stage: '3' });
  }, 120_000);
});

/** Every directory of vendored files a build could carry: the e2e fixture always, and `static/` once a stage lands. */
const SETS = [E2E_FIXTURE, ...(existsSync(STATIC) ? [STATIC] : [])];

describe('the files the map reads', () => {
  for (const dir of SETS) {
    const label = dir === STATIC ? 'static/grid/zsp' : 'the e2e fixture';
    const outlines = json<Topology & { navcom: ZonesOutlines['navcom'] }>(join(dir, 'outlines.json'));

    it(`${label}: names, for every container, the source file the manifest hashed, and its Sectors' file`, () => {
      const { navcom } = outlines;
      expect(navcom.licence).toBe('CC-BY-4.0');
      expect(navcom.credit.length).toBeGreaterThan(0);
      expect(navcom.draft).toBe(navcom.stage !== 'final');
      const manifest = dir === E2E_FIXTURE ? json<{ containers: { id: string; sha256: string; bytes: number }[] }>(join(CORE_FIXTURE, 'manifest.json')) : null;
      for (const c of navcom.containers) {
        expect(c.file).toBe(`${c.id.replace(':', '-')}.json`);
        if (c.sectors > 0) expect(existsSync(join(dir, c.file)), c.file).toBe(true);
        if (manifest) expect(manifest.containers.find((m) => m.id === c.id), c.id).toMatchObject({ sha256: c.source_sha256, bytes: c.source_bytes });
      }
      // And nothing else beside them that no container names.
      const named = new Set(['outlines.json', 'index.json', ...navcom.containers.map((c) => c.file)]);
      expect(readdirSync(dir).filter((f) => !named.has(f))).toEqual([]);
    });

    it(`${label}: labels every Terra, Mare, Zone and Sector inside itself, and says how far its lines drift`, () => {
      // Where the map hangs a count of open missions: inside the area as drawn, never in a hollow of it.
      const files = ['outlines.json', ...outlines.navcom.containers.filter((c) => c.sectors > 0).map((c) => c.file)];
      let labelled = 0;
      for (const f of files) {
        for (const layer of Object.values(decode(json<Topology>(join(dir, f)), lonLat))) {
          for (const shape of layer.shapes) {
            const at = shape.props.label as [number, number] | undefined;
            expect(Array.isArray(at), `${shape.id} has no label`).toBe(true);
            expect(at!.map((v) => Math.round(v * 100) / 100), `${shape.id}'s label to two places`).toEqual(at);
            expect(holds(shape.rings, at![0], at![1]), `${shape.id}'s label ${at} is outside it`).toBe(true);
            labelled += 1;
          }
        }
      }
      expect(labelled).toBeGreaterThan(outlines.navcom.containers.length);
      // Measured by the script, at every source vertex: a figure, never a guess.
      const drift = outlines.navcom.simplified_m!;
      expect(Number.isInteger(drift)).toBe(true);
      expect(drift % 100).toBe(0);
      expect(drift).toBeGreaterThan(0);
      expect(drift).toBeLessThan(100_000);
    });

    it(`${label}: its index holds every Sector the containers' files hold, and nothing else, under the same digest`, () => {
      const index = json<Topology & { navcom: { manifest_sha256: string } }>(join(dir, 'index.json'));
      expect(index.navcom.manifest_sha256).toBe(outlines.navcom.manifest_sha256);
      const indexed = decode(index, lonLat)['sectors']!.shapes.map((s) => s.id).sort();
      const held = outlines.navcom.containers.flatMap((c) => (c.sectors > 0 ? decode(json<Topology>(join(dir, c.file)))['sectors']!.shapes.map((s) => s.id) : [])).sort();
      expect(indexed).toEqual(held);
    });
  }

  it('static/grid/zsp, if it exists, is a vendored stage and never the fixture', () => {
    if (!existsSync(STATIC)) return;
    for (const f of readdirSync(STATIC)) {
      const navcom = json<{ navcom?: { source?: string } }>(join(STATIC, f)).navcom;
      expect(navcom?.source, f).toMatch(/^starcom-app@[0-9a-f]{40}:/);
    }
  });
});

describe('reading them on the phone', () => {
  const outlines = outlinesOf(json<Topology>(join(E2E_FIXTURE, 'outlines.json')));
  const africana = sectorsOf(json<Topology>(join(E2E_FIXTURE, 'terra-africana.json')));

  it('knows every Terra and Mare and every Zone, and which holds which', () => {
    expect(outlines.containers.map((c) => c.id)).toEqual(expect.arrayContaining(['terra:sahulica', 'terra:laurentia', 'terra:amazonia', 'terra:europaea', 'mare:pacificum']));
    expect(outlines.zones).toHaveLength(18);
    expect(outlines.navcom.stage).toBe('final');
  });

  it('strokes every edge once: a Zone’s edge that is also its container’s is the container’s alone', () => {
    const topology = json<Topology>(join(E2E_FIXTURE, 'outlines.json'));
    const key = (r: Float32Array) => {
      const ends = [`${r[0]},${r[1]}`, `${r[r.length - 2]},${r[r.length - 1]}`].sort();
      return `${ends.join('|')}|${r.length}`;
    };
    const { containers, zones } = outlines.edges;
    const seen = [...containers, ...zones].map(key);
    expect(new Set(seen).size, 'an edge stroked twice').toBe(seen.length);
    expect(edgesOf(topology, 'zones').length, 'the Zones’ own edges, with their containers’').toBe(zones.length + containers.length);
    // Every point a ring draws is on some edge, and no edge is drawn for each ring that has it.
    const ringPoints = [...outlines.containers, ...outlines.zones].reduce((n, s) => n + s.rings.reduce((m, r) => m + r.length, 0), 0);
    const edgePoints = [...containers, ...zones].reduce((n, r) => n + r.length, 0);
    expect(edgePoints).toBeLessThan(ringPoints / 2);
  });

  it('names a Sector’s Zone and container, from what is loaded', () => {
    const s = africana.find((x) => x.id === 'zone:africana-west/sector:north')!;
    expect(chainOf(outlines, s.id!, { 'terra:africana': africana })).toMatchObject({
      container: { id: 'terra:africana', name: 'Terra Africana' },
      zone: { id: 'zone:africana-west', name: 'Africana West Zone', props: { system: 'rift' } },
      sector: { id: s.id, name: 'Africana west, north', props: { descriptor: 'Montes' } }
    });
    // A Zone alone, before its container's Sectors are loaded.
    expect(chainOf(outlines, 'zone:sinica-east', {})).toMatchObject({ container: { id: 'terra:sinica' }, zone: { id: 'zone:sinica-east' }, sector: null });
    expect(chainOf(outlines, 'terra:sinica', {})).toMatchObject({ container: { id: 'terra:sinica' }, zone: null, sector: null });
    expect(chainOf(outlines, 'zone:nowhere', {})).toBeNull();
  });

  it('looks a point up in the index exactly as the checks found it in the source, at the poles and across the antimeridian', () => {
    const index = indexOf(json<Topology>(join(E2E_FIXTURE, 'index.json')));
    const files = Object.fromEntries(readdirSync(CORE_FIXTURE).filter((f) => f !== 'manifest.json').map((f) => [f, readFileSync(join(CORE_FIXTURE, f))]));
    const { partition } = checkPartition({ manifest: readFileSync(join(CORE_FIXTURE, 'manifest.json')), files, stage: 'final' });
    const truth = zspIndex(partition!.sectors);
    // Half-degrees, never on an edge: quantising moves an edge by up to 0.002°, and both sides of it agree.
    for (let lat = -87.5; lat <= 87.5; lat += 5) {
      for (let lon = -177.5; lon <= 177.5; lon += 5) expect(placeAt(index, lon, lat, 0).inside, `${lon},${lat}`).toBe(placeAt(truth, lon, lat, 0).inside);
    }
    expect(placeAt(index, 10, 89.9).inside).toBe('zone:arcticum-east/sector:north');
    expect(placeAt(index, 179.99, -10).inside).toBe(placeAt(index, -179.99, -10).inside);
  });
});
