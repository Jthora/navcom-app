/**
 * Generates the grid's geometry: `static/grid/world.json`, and the time zones layer,
 * `static/grid/timezones.json`.
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
import { NATURAL_EARTH, download } from './lib/natural-earth.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('../static/grid/world.json', import.meta.url));
const TIMEZONES = fileURLToPath(new URL('../static/grid/timezones.json', import.meta.url));

/* Natural Earth, pinned in `lib/natural-earth.mjs`, which `label-points.mjs` reads it at too. */
const MAPSHAPER = 'mapshaper@0.7.78';
/** map.md §3: 20% keeps 146 records' positions onshore against the coastline where 1% kept 372. */
const SIMPLIFY = '20%';
const QUANTIZATION = 10000;
/**
 * The time zones layer (D8, decided 2026-10-18): Natural Earth's 1:10m zones, dissolved by standard
 * offset into one band each, at the finer of the two settings measured for `MAP_LINES.timezones`
 * (scripts/lib/budget.mjs). Each band keeps only its offset: its label is written from that number on
 * the phone, because the file's own `utc_format` disagrees with its `zone` on two polygons.
 */
const TIMEZONES_SIMPLIFY = '10%';

/**
 * Region country (ISO 3166-1 alpha-2, as `region.json` files it) to Natural Earth's codes.
 *
 * Puerto Rico's regions are filed as US — it dials and files as the US — but Natural Earth draws
 * it as its own country, so a US region implies both. A country missing from this table is a
 * failure rather than a silent omission: see `regionCountries`.
 */
/** @type {Record<string, string[]>} */
const NE_CODES = { US: ['USA', 'PRI'], GB: ['GBR'], AU: ['AUS'], CA: ['CAN'], NZ: ['NZL'], IE: ['IRL'] };

/** Sentinel regions used by tests and templates, which are not places. */
const NOT_A_PLACE = new Set(['XX', 'ZZ']);

function regionCountries() {
  const dir = join(ROOT, 'data', 'regions');
  /** @type {Set<string>} */
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
    // Antarctica is kept since 2026-10-18 (D1). Under Web Mercator it was a band across the whole
    // bottom edge, the largest shape on screen, and was dropped as scenery that misleads; Equal Earth
    // draws it at its true area, and Starcom's Terra Antarctica and Mare Australe run to the pole.
    '-simplify', 'target=provinces', SIMPLIFY, 'keep-shapes',
    // Every shape keeps its code, and what a hover or a tap needs to name it [map.md §6: every
    // shape is a door]. The code is how a mission says where it is (`jurisdiction: us-ca`, or `ke`
    // for a country), so the grid can find the shape to light. A country's is ISO_A2_EH,
    // lower-cased to read like a mission's: it fills in France and Norway, which ISO_A2 leaves as
    // -99. A country is named from its code on the phone (`Intl.DisplayNames`, topology.ts), so
    // only the two Natural Earth leaves at -99, both disputed (N. Cyprus, Somaliland), carry a name
    // here: 1.1 KB of names nobody needs to download, measured. grid.test.ts names those two, so a
    // third is a decision. A province carries its own name, because nothing on the phone has it.
    '-each', 'target=world', 'iso_a2 = ISO_A2_EH === "-99" ? null : ISO_A2_EH.toLowerCase(), name = ISO_A2_EH === "-99" ? NAME : undefined',
    '-filter-fields', 'target=world', 'iso_a2,name',
    '-filter-fields', 'target=provinces', 'iso_3166_2,name',
    '-o', 'target=world,provinces', 'format=topojson', `quantization=${QUANTIZATION}`, raw
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);

// The time zones: standard offsets as Natural Earth drew them in 2012, with no daylight saving.
const zonesSource = download('ne_10m_time_zones', work);
const zonesRaw = join(work, 'timezones.json');
execFileSync(
  'npx',
  [
    '-y', MAPSHAPER,
    '-i', zonesSource, 'name=bands',
    '-dissolve', 'zone',
    // On the sphere, as the budget measured it. Planar was tried (2026-10-18): it parted the
    // Chatham Islands' UTC+12:45 from the hole UTC+12 leaves for it, which Natural Earth does not
    // draw vertex for vertex. Each band's edge along a pole survives, being an arc of its own.
    '-simplify', TIMEZONES_SIMPLIFY, 'keep-shapes',
    '-o', 'format=topojson', `quantization=${QUANTIZATION}`, zonesRaw
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);
const bands = JSON.parse(readFileSync(zonesRaw, 'utf8'));
if (!bands.objects?.bands?.geometries?.length) throw new Error('layer "bands" is empty');
bands.navcom = {
  source: `natural-earth@${NATURAL_EARTH}`,
  layer: 'ne_10m_time_zones',
  simplify: TIMEZONES_SIMPLIFY,
  /** As the file's own timestamps say, and what the map says of it [invariant 7]. */
  drawn: '2012',
  standard: 'standard offsets from UTC only; no daylight saving'
};
writeFileSync(TIMEZONES, JSON.stringify(bands));

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
    `${topology.objects.provinces.geometries.length} provinces for ${provincesFor.join(' ')} → static/grid/world.json; ` +
    `${bands.objects.bands.geometries.length} time zone bands → static/grid/timezones.json`
);
