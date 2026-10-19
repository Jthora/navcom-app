/**
 * Vendors one stage of Starcom's Zone and Sector Protocol 2.0 partition into `static/grid/zsp/`
 * [docs/design/map.md, Zones; the owner's map decision D6].
 *
 * **Run by hand, and the output is committed**, as `grid-geometry.mjs` is. NavCom never fetches
 * Zones from starcom.app: that would hand Starcom's host every visitor's address, would not work
 * offline, and fails the landing page's "talks to nobody" test by design. So each stage is taken from
 * starcom-app's repository at a pinned commit, checked, and turned into NavCom's own files:
 *
 *     node scripts/zsp-vendor.mjs --repo ../../starcom-app --commit <sha> --manifest-sha256 <hex> \
 *       --stage 1 --credit "<the attribution the licence asks for>"
 *
 * **By digest.** The manifest's sha256 is given on the command line, by whoever reviewed it, and the
 * files are read out of git at the commit rather than from a working tree, so nothing is vendored
 * that was not looked at. Every container file's sha256 and length must then equal the manifest's.
 *
 * **With the same checks Starcom's build runs, in NavCom's own reader** [@navcom/core/zones]: ids and
 * levels, rings, sizes, licences, landform words, retired ids, and coverage, at what the stage asks:
 * Stage 1's outlines cover the Earth once; a Terra or Mare with Zones has them, and their Sectors,
 * cover it; `final` has Zones and Sectors everywhere. A partition with any problem writes nothing.
 *
 * What it writes, quantised TopoJSON with each shared edge stored once, as `world.json` is:
 *
 * - `outlines.json`: every Terra, Mare and Zone, simplified for the world view, fetched whole when
 *   somebody chooses Zones (D10)
 * - `<terra-or-mare>.json`: one container's Sectors, fetched when somebody opens that container (D10)
 * - `index.json`: every Sector on Earth at lookup precision, fetched whole the first time somebody
 *   asks which Sector a place is in, and looked up on the phone (D7, D10)
 *
 * Each records where it came from in a `navcom` block: the source and commit, the manifest's digest,
 * the stage, and the credit. A stage before `final` is a draft (D6): the map says so, and nothing a
 * person keeps may name one of its ids.
 *
 * `--dir` reads a partition from a directory instead, for NavCom's own test fixture and nothing else.
 * **A working tree never ships**: `static/grid/zsp/` takes only `--repo` at a full commit with
 * `--manifest-sha256`, whatever a manifest read with `--dir` calls its maker, and the fixture is refused
 * there by any route. `--out` must be a directory named `zsp`, and what it held is replaced only where
 * an earlier vendoring wrote it, by the `navcom` block it stamped, so a mistyped `--out` deletes
 * nothing else. `zsp.test.ts` holds all of this.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPartition, zspStem } from '@navcom/core/zones';

const MAPSHAPER = 'mapshaper@0.7.78';
/** The world view: a Sector line there is a pixel or two, so the outlines keep a tenth of their points. */
const OUTLINES = { simplify: '10%', quantization: 10000 };
/** One container's Sectors, drawn when it is opened and zoomed toward: a quarter of their points. */
const SECTORS = { simplify: '25%', quantization: 10000 };
/** The lookup: every point the format gives, about 400 m apart at the most once quantised over the Earth. */
const INDEX = { quantization: 100000 };
/** What the fixture's manifest calls its maker, which nothing vendored may be. */
const FIXTURE = 'navcom-test-fixture';
const STATIC = fileURLToPath(new URL('../static/grid/zsp/', import.meta.url));
const IN_REPO = 'public/geopolitical/zones';

/** @param {string[]} argv */
function args(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith('--')) throw new Error(`unexpected argument "${a}"`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    out[a.slice(2)] = v;
    i++;
  }
  return out;
}

/**
 * @param {string} message
 * @returns {never}
 */
function refuse(message) {
  console.error(`zsp-vendor: ${message}`);
  process.exit(1);
}

const sha = (/** @type {Uint8Array} */ b) => createHash('sha256').update(b).digest('hex');

const opts = (() => {
  try {
    return args(process.argv.slice(2));
  } catch (e) {
    return refuse(/** @type {Error} */ (e).message);
  }
})();
const stage = opts.stage;
if (!stage) refuse('--stage is required: 1, 2, 3 or final (D6)');
if (!opts.repo === !opts.dir) refuse('give exactly one of --repo (with --commit) or --dir');
const out = resolve(opts.out ?? STATIC);
// A directory named for what it holds, so a mistyped --out (`static/grid`) is refused before anything is read.
if (basename(out) !== 'zsp') refuse(`--out must be a directory named zsp, and ${out} is not`);
/** A directory's parent as the disk names it, so `static/grid/../grid/zsp` and a case the disk ignores are still static/. */
const parentOf = (/** @type {string} */ p) => {
  try {
    return realpathSync.native(dirname(p));
  } catch {
    return dirname(p);
  }
};
/** Whether this run writes where the map reads from, which deploys. */
const shipping = parentOf(out) === parentOf(resolve(STATIC));
if (shipping && opts.dir) {
  refuse(
    '--dir reads a working tree, and a working tree never ships: static/grid/zsp/ takes only --repo at a full ' +
      '--commit with --manifest-sha256, so what deploys is what was reviewed (map.md §8)'
  );
}

/** @type {(name: string) => Buffer} */
let read;
/** @type {string} */
let source;
if (opts.repo) {
  if (!opts.commit || !/^[0-9a-f]{40}$/.test(opts.commit)) refuse('--commit must be a full 40-character commit');
  if (!opts['manifest-sha256']) refuse('--manifest-sha256 is required with --repo: vendor what was reviewed, by its digest');
  const repo = resolve(opts.repo);
  read = (name) => execFileSync('git', ['-C', repo, 'show', `${opts.commit}:${IN_REPO}/${name}`], { maxBuffer: 64 * 1024 * 1024 });
  source = `starcom-app@${opts.commit}:${IN_REPO}`;
} else {
  const dir = resolve(/** @type {string} */ (opts.dir));
  read = (name) => readFileSync(join(dir, name));
  source = `dir:${dir}`;
}

const manifestBytes = read('manifest.json');
const manifestSha = sha(manifestBytes);
if (opts['manifest-sha256'] && opts['manifest-sha256'] !== manifestSha) {
  refuse(`manifest.json is sha256 ${manifestSha}, and --manifest-sha256 says ${opts['manifest-sha256']}: not the manifest that was reviewed`);
}
/** @type {{ generator?: string, generated?: string, licence: string, containers: { id: string, name: string, level: string, file: string, sha256: string, bytes: number }[], retired: unknown[], attribution?: string, credit?: string }} */
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const fixture = manifest.generator === FIXTURE;
if (fixture && shipping) refuse('this is NavCom’s test fixture, which never ships: give --out somewhere other than static/grid/zsp/');
if (fixture) source = 'navcom-test-fixture';
const credit = opts.credit ?? manifest.attribution ?? manifest.credit ?? (fixture ? 'NavCom test fixture, never shipped' : null);
if (!credit) refuse('--credit is required: CC BY 4.0 asks for an attribution, and the manifest gives none');

/** @type {Record<string, Buffer>} */
const files = {};
for (const c of manifest.containers ?? []) {
  try {
    files[c.file] = read(c.file);
  } catch {
    refuse(`${c.file} is named in the manifest and could not be read`);
  }
}

const { problems, partition } = checkPartition({ manifest: manifestBytes, files, stage: /** @type {any} */ (stage) });
if (problems.length > 0 || !partition) {
  console.error(`zsp-vendor: ${problems.length} problem(s); nothing written.\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// ─── The derived files ────────────────────────────────────────────────────────────────────────

const work = join(tmpdir(), `navcom-zsp-${process.pid}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

/** Each container file's own GeoJSON features, by level, with only the properties NavCom shows. */
/** @type {Record<string, any[]>} */
const features = { containers: [], zones: [] };
/** @type {Record<string, any[]>} */
const sectorsOf = {};
for (const c of manifest.containers) {
  const doc = JSON.parse(files[c.file].toString('utf8'));
  for (const f of doc.features) {
    const p = f.properties;
    if (p.level === 'terra' || p.level === 'mare') {
      features.containers.push({ type: 'Feature', properties: { id: p.id, name: p.name, level: p.level }, geometry: f.geometry });
    } else if (p.level === 'zone') {
      features.zones.push({ type: 'Feature', properties: { id: p.id, name: p.name, parent: p.parent, system: p.system }, geometry: f.geometry });
    } else {
      (sectorsOf[c.id] ??= []).push({
        type: 'Feature',
        properties: { id: p.id, name: p.name, ...(p.descriptor ? { descriptor: p.descriptor } : {}) },
        geometry: f.geometry
      });
    }
  }
}

/** @param {string} name @param {any[]} list */
const geojson = (name, list) => {
  const path = join(work, `${name}.json`);
  writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features: list }));
  return path;
};

/** @param {string[]} inputs @param {string[]} commands @param {string} output */
function mapshaper(inputs, commands, output) {
  execFileSync('npx', ['-y', MAPSHAPER, '-i', ...inputs, ...(inputs.length > 1 ? ['combine-files'] : []), ...commands, '-o', 'target=*', 'format=topojson', ...output.split(' ')], {
    stdio: ['ignore', 'ignore', 'inherit']
  });
}

const navcom = {
  source,
  manifest_sha256: manifestSha,
  generated: manifest.generated ?? null,
  stage,
  draft: stage !== 'final',
  licence: manifest.licence,
  credit,
  containers: manifest.containers.map((c) => ({
    id: c.id,
    name: c.name,
    level: c.level,
    file: `${zspStem(c.id)}.json`,
    sectors: sectorsOf[c.id]?.length ?? 0,
    source_sha256: c.sha256,
    source_bytes: c.bytes
  })),
  retired: manifest.retired ?? []
};

const written = join(work, 'out');
mkdirSync(written);
const inputs = [geojson('containers', features.containers), ...(features.zones.length > 0 ? [geojson('zones', features.zones)] : [])];
/*
 * Planar, in longitude and latitude, as the map draws them. Simplified on the sphere, a polar ring lost
 * its edge along the pole, where every point is one point, and was drawn as a diagonal across the cap.
 */
mapshaper(inputs, ['-simplify', 'planar', OUTLINES.simplify, 'keep-shapes'], `quantization=${OUTLINES.quantization} ${join(written, 'outlines.json')}`);
for (const [id, list] of Object.entries(sectorsOf)) {
  const stem = zspStem(id);
  mapshaper([geojson(`sectors-${stem}`, list)], ['-simplify', 'planar', SECTORS.simplify, 'keep-shapes', '-rename-layers', 'sectors'], `quantization=${SECTORS.quantization} ${join(written, `${stem}.json`)}`);
}
const everySector = Object.values(sectorsOf).flat().map((f) => ({ ...f, properties: { id: f.properties.id, name: f.properties.name } }));
if (everySector.length > 0) {
  mapshaper([geojson('sectors', everySector)], ['-rename-layers', 'sectors'], `quantization=${INDEX.quantization} ${join(written, 'index.json')}`);
}

/** @param {string} file @param {Record<string, unknown>} block */
function stamp(file, block) {
  const path = join(written, file);
  const topology = JSON.parse(readFileSync(path, 'utf8'));
  for (const [name, layer] of Object.entries(topology.objects ?? {})) {
    if (!/** @type {any} */ (layer).geometries?.length) throw new Error(`${file}: layer "${name}" is empty`);
  }
  topology.navcom = block;
  writeFileSync(path, JSON.stringify(topology));
}
stamp('outlines.json', navcom);
if (everySector.length > 0) stamp('index.json', { ...navcom, containers: undefined, retired: undefined, sectors: everySector.length });
for (const id of Object.keys(sectorsOf)) {
  stamp(`${zspStem(id)}.json`, { source, manifest_sha256: manifestSha, stage, draft: stage !== 'final', container: id, credit });
}

// Replace what an earlier vendoring wrote, so a container that went in this stage does not linger from
// the last; known by the stamp it carries, and nothing else is touched.
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) {
  if (!f.endsWith('.json')) continue;
  /** @type {unknown} */
  let stamp = null;
  try {
    stamp = JSON.parse(readFileSync(join(out, f), 'utf8'))?.navcom;
  } catch {
    stamp = null;
  }
  if (stamp && typeof (/** @type {any} */ (stamp).manifest_sha256) === 'string') rmSync(join(out, f));
  else console.warn(`zsp-vendor: left ${f} in ${out}, which no vendoring wrote`);
}
for (const f of readdirSync(written)) writeFileSync(join(out, f), readFileSync(join(written, f)));
rmSync(work, { recursive: true, force: true });

console.log(
  `zsp: stage ${stage}${stage === 'final' ? '' : ' (draft)'} from ${source}, manifest ${manifestSha.slice(0, 12)}: ` +
    `${partition.containers.length} containers, ${partition.zones.length} Zones, ${partition.sectors.length} Sectors → ${out}` +
    (existsSync(join(out, 'index.json')) ? '' : ' (no Sectors yet, so no index)')
);
