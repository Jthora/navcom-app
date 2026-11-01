#!/usr/bin/env node
/**
 * What the app carries: the site's own static build, as `web/` built it, copied into `www/` for
 * Capacitor to bundle. The app is the site served from the device, so it opens with no network.
 *
 * Left out: `directory.json`, the 15 MB export no page reads [web/scripts/lib/budget.mjs, the single
 * file ceiling], and the build's own dot-files. Everything else goes, the directory's own pages and
 * `.well-known/` with it: they are what a phone with no signal still needs to read.
 *
 * Refuses to stage a build that is not there or not whole, rather than bundle half a site.
 */
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const BUILD = join(HERE, '../../web/build');
const OUT = join(HERE, 'www');
const LEFT_OUT = new Set(['directory.json']);
/** The build's own records, `.budget.json` and the like: everything at the top that starts with a dot but the site's `.well-known/`. */
const own = (rel) => rel.startsWith('.') && !rel.startsWith('.well-known');

for (const needed of ['index.html', 'terminal/index.html', '_app', 'grid/world.json']) {
  if (!existsSync(join(BUILD, needed))) {
    console.error(`[stage] web/build has no ${needed}: run \`npm run build --workspace navcom-web\` first.`);
    process.exit(1);
  }
}
rmSync(OUT, { recursive: true, force: true });
cpSync(BUILD, OUT, { recursive: true, filter: (src) => !LEFT_OUT.has(relative(BUILD, src)) && !own(relative(BUILD, src)) });
console.log(`[stage] www/ from web/build (built ${statSync(join(BUILD, 'index.html')).mtime.toISOString()}), without ${[...LEFT_OUT].join(', ')}`);
