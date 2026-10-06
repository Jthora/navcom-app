/**
 * Generates the grid's geometry: `static/grid/world.json`.
 *
 * **Run by hand, and the output is committed.** A build never downloads this — Vercel building
 * the site must not depend on GitHub serving 40 MB of shapefiles that day. Rerun it when a region
 * appears in a country that has no provinces yet; `grid.test.ts` fails until somebody does, which
 * is how "detail follows the regions" stays true without anyone remembering it.
 *
 *     node scripts/grid-geometry.mjs
 *
 * Everything that decides the output is pinned here, so two people running it a year apart get
 * the same bytes: the Natural Earth commit, the mapshaper version, the simplification and the
 * quantisation. The numbers are the ones measured in docs/design/map.md §3 — change one, and
 * re-measure there.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('../static/grid/world.json', import.meta.url));

/** Natural Earth, pinned. Public domain; no attribution required, though it is credited. */
const NATURAL_EARTH = 'ca96624a56bd078437bca8184e78163e5039ad19';
const MAPSHAPER = 'mapshaper@0.7.78';
/** map.md §3: 20% keeps 146 records' positions onshore against the coastline where 1% kept 372. */
const SIMPLIFY = '20%';
const QUANTIZATION = 10000;

/**
 * Region country (ISO 3166-1 alpha-2, as `region.json` files it) to Natural Earth's codes.
 *
 * Puerto Rico's regions are filed as US — it dials and files as the US — but Natural Earth draws
 * it as its own country, so a US region implies both. A country missing from this table is a
 * failure rather than a silent omission: see `regionCountries`.
 */
const NE_CODES = { US: ['USA', 'PRI'], GB: ['GBR'], AU: ['AUS'], CA: ['CAN'], NZ: ['NZL'], IE: ['IRL'] };

/** Sentinel regions used by tests and templates, which are not places. */
const NOT_A_PLACE = new Set(['XX', 'ZZ']);

function regionCountries() {
  const dir = join(ROOT, 'data', 'regions');
  const found = new Set();
  for (const slug of readdirSync(dir)) {
    const file = join(dir, slug, 'region.json');
    if (slug.startsWith('_') || !existsSync(file)) continue;
    const country = JSON.parse(readFileSync(file, 'utf8')).country;
    if (!NOT_A_PLACE.has(country)) found.add(country);
  }
  const unmapped = [...found].filter((c) => !NE_CODES[c]);
  if (unmapped.length) {
    throw new Error(`No Natural Earth code for region country ${unmapped.join(', ')}. Add it to NE_CODES.`);
  }
  return [...found].sort();
}

function download(name, dir) {
  const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH}/geojson/${name}.geojson`;
  const path = join(dir, `${name}.geojson`);
  execFileSync('curl', ['-sSfL', '-o', path, url], { stdio: 'inherit' });
  return path;
}

const countries = regionCountries();
const provincesFor = countries.flatMap((c) => NE_CODES[c]).sort();

const work = join(tmpdir(), `navcom-grid-${process.pid}`);
mkdirSync(work, { recursive: true });
const world = download('ne_110m_admin_0_countries', work);
const provinces = download('ne_10m_admin_1_states_provinces', work);
const raw = join(work, 'grid.json');

execFileSync(
  'npx',
  [
    '-y', MAPSHAPER,
    '-i', world, 'name=world',
    '-i', provinces, 'name=provinces',
    '-filter', 'target=provinces', `${JSON.stringify(provincesFor)}.indexOf(adm0_a3) > -1`,
    // Web Mercator stretches Antarctica into a band across the whole bottom edge — the largest
    // shape on screen, for a continent no region is filed in. Scenery that misleads is dropped.
    '-filter', 'target=world', 'ADM0_A3 !== "ATA"',
    '-simplify', 'target=provinces', SIMPLIFY, 'keep-shapes',
    // Names and codes are not drawn and cost bytes; the grid is scenery, not a gazetteer.
    '-filter-fields', 'target=world',
    '-filter-fields', 'target=provinces',
    '-o', 'target=world,provinces', 'format=topojson', `quantization=${QUANTIZATION}`, raw
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);

const topology = JSON.parse(readFileSync(raw, 'utf8'));
for (const layer of ['world', 'provinces']) {
  // The measurement that came out too small had silently lost a layer. Never again quietly.
  if (!topology.objects?.[layer]?.geometries?.length) throw new Error(`layer "${layer}" is empty`);
}

// TopoJSON allows extra top-level members. This one says what the file is and what it covers,
// so the coverage test reads the file rather than trusting this script ran.
topology.navcom = {
  source: `natural-earth@${NATURAL_EARTH}`,
  simplify: SIMPLIFY,
  /** The region countries this file was generated for, as `region.json` writes them. */
  regionCountries: countries,
  provincesFor
};

mkdirSync(fileURLToPath(new URL('../static/grid/', import.meta.url)), { recursive: true });
writeFileSync(OUT, JSON.stringify(topology));
console.log(
  `grid: ${topology.objects.world.geometries.length} countries, ` +
    `${topology.objects.provinces.geometries.length} provinces for ${provincesFor.join(' ')} → static/grid/world.json`
);
