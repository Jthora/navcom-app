/**
 * Vendors the Spheres' membership lists into `static/grid/spheres.json` [docs/design/map.md, Spheres;
 * the owner's map decision D9].
 *
 * **Run by hand, and the output is committed**, as `zsp-vendor.mjs` is. NavCom never fetches the
 * lists at runtime: from Starcom's host that would hand it every visitor's address and timing, would
 * not work offline, and fails the landing page's "talks to nobody" test by design. So the lists are
 * taken from starcom-app's repository at a pinned commit, by the manifest's digest, checked, and turned
 * into NavCom's own file:
 *
 *     node scripts/spheres-vendor.mjs --repo ../../starcom-app --commit <sha> --manifest-sha256 <hex> \
 *       --credit "<the attribution the licence asks for>" [--final]
 *
 * **By digest**, and out of git at the commit, never from a working tree, so nothing ships that was not
 * looked at. **With NavCom's own checks** [@navcom/core/spheres]: the edition, every Sphere's id, family
 * and ISO codes, a source cited for each, and a licence NavCom may vendor, for the lists and for every
 * source that names one. A list with any problem writes nothing.
 *
 * **Every member must have somewhere to be drawn**: an outline in the world's own file, or a label
 * point from Natural Earth (`scripts/data/label-points.json`, D9). A member with neither is refused by
 * name rather than left off the map unsaid. Only the points of the members a Sphere names are written.
 *
 * **A source's link is https or nothing** [@navcom/core/spheres isHttps]: a `javascript:` or `data:` link
 * would run in navcom.app's origin, where every operator's keys are, on one tap.
 *
 * **Draft until said otherwise**: the map labels the lists a draft unless `--final` is given, by
 * whoever has been told by the lists' author that they are.
 *
 * `--dir` reads a directory instead, for NavCom's own test fixture and nothing else: it is refused for
 * `static/grid/spheres.json` whatever path names it, and so is a manifest whose maker is the fixture.
 * `--out` must be a file named `spheres.json`, and replaces only what an earlier vendoring wrote, known
 * by its stamp. `src/lib/grid/spheres.test.ts` holds all of this.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpheres } from '@navcom/core/spheres';

const STATIC = fileURLToPath(new URL('../static/grid/spheres.json', import.meta.url));
const WORLD = fileURLToPath(new URL('../static/grid/world.json', import.meta.url));
const LABELS = fileURLToPath(new URL('./data/label-points.json', import.meta.url));
const IN_REPO = 'public/geopolitical/spheres';
/** What the fixture's manifest calls its maker, which nothing vendored may be. */
const FIXTURE = 'navcom-test-fixture';

/** @param {string} message @returns {never} */
function refuse(message) {
  console.error(`spheres-vendor: ${message}`);
  process.exit(1);
}

/** @type {Record<string, string | true>} */
const opts = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a?.startsWith('--')) refuse(`unexpected argument "${a}"`);
  if (a === '--final') {
    opts.final = true;
    continue;
  }
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) refuse(`${a} needs a value`);
  opts[a.slice(2)] = v;
  i++;
}
const str = (/** @type {string} */ k) => (typeof opts[k] === 'string' ? /** @type {string} */ (opts[k]) : undefined);

if (!str('repo') === !str('dir')) refuse('give exactly one of --repo (with --commit) or --dir');
const out = resolve(str('out') ?? STATIC);
if (basename(out) !== 'spheres.json') refuse(`--out must be a file named spheres.json, and ${out} is not`);
const parentOf = (/** @type {string} */ p) => {
  try {
    return realpathSync.native(dirname(p));
  } catch {
    return dirname(p);
  }
};
/** Whether this run writes where the map reads from, which deploys. */
const shipping = parentOf(out) === parentOf(STATIC);
if (shipping && str('dir')) {
  refuse(
    '--dir reads a working tree, and a working tree never ships: static/grid/spheres.json takes only --repo at a ' +
      'full --commit with --manifest-sha256, so what deploys is what was reviewed (map.md, Spheres)'
  );
}

/** @type {Buffer} */
let bytes;
/** @type {string} */
let source;
if (str('repo')) {
  const commit = str('commit');
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) refuse('--commit must be a full 40-character commit');
  if (!str('manifest-sha256')) refuse('--manifest-sha256 is required with --repo: vendor what was reviewed, by its digest');
  try {
    bytes = execFileSync('git', ['-C', resolve(/** @type {string} */ (str('repo'))), 'show', `${commit}:${IN_REPO}/manifest.json`], { maxBuffer: 16 * 1024 * 1024 });
  } catch {
    refuse(`${IN_REPO}/manifest.json is not in that repository at ${commit}`);
  }
  source = `starcom-app@${commit}:${IN_REPO}`;
} else {
  bytes = readFileSync(join(resolve(/** @type {string} */ (str('dir'))), 'manifest.json'));
  source = `dir:${resolve(/** @type {string} */ (str('dir')))}`;
}

const digest = createHash('sha256').update(bytes).digest('hex');
if (str('manifest-sha256') && str('manifest-sha256') !== digest) {
  refuse(`manifest.json is sha256 ${digest}, and --manifest-sha256 says ${str('manifest-sha256')}: not the manifest that was reviewed`);
}
/** @type {Record<string, unknown>} */
const manifest = JSON.parse(bytes.toString('utf8'));
const fixture = manifest.generator === FIXTURE;
if (fixture && shipping) refuse('this is NavCom’s test fixture, which never ships: give --out somewhere other than static/grid/spheres.json');
if (fixture) source = FIXTURE;

const { lists, problems } = checkSpheres(manifest);
if (!lists || problems.length > 0) refuse(`${problems.length} problem(s); nothing written.\n  ${problems.join('\n  ')}`);
const credit = str('credit') ?? lists.attribution ?? (fixture ? 'NavCom test fixture, never shipped' : null);
if (!credit) refuse('--credit is required: the licence asks for an attribution, and the lists give none');

// Somewhere to draw every member a list draws: an outline at the world's scale, or a label point (D9).
// One it lists and does not draw is never drawn, and needs nowhere.
const world = JSON.parse(readFileSync(WORLD, 'utf8'));
const outlined = new Set(world.objects.world.geometries.map((/** @type {any} */ g) => g.properties?.iso_a2).filter(Boolean));
/** @type {Record<string, [number, number]>} */
const labels = JSON.parse(readFileSync(LABELS, 'utf8')).points;
const nowhere = [...new Set(lists.spheres.flatMap((s) => s.members.filter((m) => m.drawn).map((m) => m.code)))].filter((c) => !outlined.has(c) && !labels[c]).sort();
if (nowhere.length > 0) {
  refuse(`nowhere to draw ${nowhere.join(', ')}: no outline in static/grid/world.json and no label point in scripts/data/label-points.json`);
}

/** @type {Record<string, [number, number]>} */
const points = {};
for (const s of lists.spheres) for (const m of s.members) if (m.drawn && !outlined.has(m.code)) points[m.code] = labels[m.code];

// When the lists were read: the oldest and the newest, and how many say nothing, so the map gives the
// cautious date and not only the freshest one.
const reads = lists.spheres.map((s) => s.read).filter((d) => d !== null).sort();
const file = {
  navcom: {
    source,
    manifest_sha256: digest,
    generated: typeof manifest.generated === 'string' ? manifest.generated : null,
    lists: lists.lists,
    /** The oldest and the newest day any of the lists was read, as they say, and how many do not say. */
    read: reads.length > 0 ? { oldest: reads[0], newest: reads.at(-1), unsaid: lists.spheres.length - reads.length } : null,
    draft: opts.final !== true,
    licence: lists.licence,
    credit,
    unread: lists.unread
  },
  spheres: lists.spheres.map((s) => ({
    id: s.id,
    name: s.name,
    family: s.family,
    members: s.members.map((m) => ({ code: m.code, ...(m.source ? { source: m.source } : {}), ...(m.drawn ? {} : { drawn: false }) })),
    groups: s.groups,
    sources: s.sources.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null))),
    read: s.read,
    ...(s.note ? { note: s.note } : {})
  })),
  points: Object.fromEntries(Object.entries(points).sort(([a], [b]) => a.localeCompare(b)))
};

// Replace only what an earlier vendoring wrote, known by its stamp.
if (existsSync(out)) {
  /** @type {any} */
  let had = null;
  try {
    had = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    had = null;
  }
  if (typeof had?.navcom?.manifest_sha256 !== 'string') refuse(`${out} is there and no vendoring wrote it: not replacing it`);
}
writeFileSync(out, JSON.stringify(file) + '\n');
console.log(
  `spheres: ${file.spheres.length} Spheres${file.navcom.draft ? ' (draft)' : ''} from ${source}, manifest ${digest.slice(0, 12)}, ` +
    `${Object.keys(points).length} small members as circles → ${out}`
);
