/**
 * Where the map draws a small state as a circle: Natural Earth's label point for every country with
 * no outline at the map's scale [the owner's map decision D9; docs/design/map.md, Spheres].
 *
 * The world is drawn from Natural Earth's 1:110m countries (`static/grid/world.json`), which leave out
 * the smallest states: Malta, Singapore, Barbados, Mauritius and some seventy more. A Sphere that lists
 * one must still show it, so each is drawn as a circle at the point Natural Earth itself labels it at,
 * `LABEL_X` and `LABEL_Y` on its 1:10m countries, which is inside the country by construction.
 *
 * **Run by hand, and the output is committed**, as `grid-geometry.mjs` is, from the same pinned commit
 * [lib/natural-earth.mjs]; a build never downloads it. It is not served: `spheres-vendor.mjs` reads it
 * and writes into `static/grid/spheres.json` only the points of the members a Sphere names.
 *
 *     node scripts/label-points.mjs
 *
 * Codes as the map files a country, ISO 3166-1 alpha-2 lower-cased, from `ISO_A2_EH`, which fills in
 * France and Norway where `ISO_A2` says -99. Two places, about a kilometre: a circle five pixels across
 * at any zoom the world is drawn at says nothing finer.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATURAL_EARTH, download } from './lib/natural-earth.mjs';

const WORLD = fileURLToPath(new URL('../static/grid/world.json', import.meta.url));
const OUT = fileURLToPath(new URL('./data/label-points.json', import.meta.url));
const LAYER = 'ne_10m_admin_0_countries';

/** Every country code the world's outlines already draw. */
const world = JSON.parse(readFileSync(WORLD, 'utf8'));
const drawn = new Set(world.objects.world.geometries.map((/** @type {any} */ g) => g.properties?.iso_a2).filter(Boolean));

const work = join(tmpdir(), `navcom-labels-${process.pid}`);
mkdirSync(work, { recursive: true });
const countries = JSON.parse(readFileSync(download(LAYER, work), 'utf8'));
rmSync(work, { recursive: true, force: true });

/** @type {Record<string, [number, number]>} */
const points = {};
/** @type {string[]} */
const missing = [];
for (const f of countries.features) {
  const p = f.properties;
  const code = typeof p.ISO_A2_EH === 'string' && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH.toLowerCase() : null;
  if (!code || drawn.has(code) || points[code]) continue;
  if (typeof p.LABEL_X !== 'number' || typeof p.LABEL_Y !== 'number') {
    missing.push(code);
    continue;
  }
  points[code] = [Math.round(p.LABEL_X * 100) / 100, Math.round(p.LABEL_Y * 100) / 100];
}
if (missing.length > 0) throw new Error(`${LAYER} at ${NATURAL_EARTH} has no LABEL_X/LABEL_Y for ${missing.join(', ')}`);

const sorted = Object.fromEntries(Object.entries(points).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(
  OUT,
  JSON.stringify(
    {
      navcom: {
        source: `natural-earth@${NATURAL_EARTH}`,
        layer: LAYER,
        fields: 'ISO_A2_EH, LABEL_X, LABEL_Y',
        for: 'every ISO 3166-1 alpha-2 code with no shape in static/grid/world.json',
        decimals: 2
      },
      points: sorted
    },
    null,
    1
  ) + '\n'
);
console.log(`label points: ${Object.keys(sorted).length} small states with no 1:110m shape → scripts/data/label-points.json`);
