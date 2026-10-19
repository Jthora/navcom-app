/**
 * Natural Earth, pinned: the one commit every file NavCom derives from it is read at, and how a layer
 * is fetched from it. Shared by `grid-geometry.mjs` (the world's outlines and the time zones) and
 * `label-points.mjs` (where a small state is drawn as a circle, D9), so the two can never be read at
 * different commits.
 *
 * Public domain; no attribution required, though NavCom credits it [LICENSING.md].
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const NATURAL_EARTH = 'ca96624a56bd078437bca8184e78163e5039ad19';

/**
 * One layer's GeoJSON, at the pinned commit, into `dir`. Run by hand and never by a build: Vercel
 * building the site must not depend on GitHub serving 40 MB of shapefiles that day.
 *
 * @param {string} name a layer's file name without its extension, `ne_110m_admin_0_countries`
 * @param {string} dir
 */
export function download(name, dir) {
  const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH}/geojson/${name}.geojson`;
  const path = join(dir, `${name}.geojson`);
  execFileSync('curl', ['-sSfL', '-o', path, url], { stdio: 'inherit' });
  return path;
}
