/**
 * The service worker's two promises, checked against the file that actually ships.
 *
 * Since 2026-10-05 this worker serves the public site as well as the terminal, which earned it
 * a test it did not have before. Both of the things it now promises fail *silently* when they
 * break — the site still works, it just quietly re-downloads itself forever, or quietly serves
 * a build from last month. That is the `verification.md` class this project has shipped three
 * times: a rule the logic honoured and the output did not.
 *
 * Read from `build/service-worker.js` rather than the source, because the source imports
 * `$service-worker` and the interesting question is what Vite emitted.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));

function worker(): string {
  const path = join(BUILD, 'service-worker.js');
  if (!existsSync(path)) throw new Error('service-worker.js was not built');
  return readFileSync(path, 'utf8');
}

describe('the public site is cached, and invalidated by deploying', () => {
  it('keys both caches to the build version', () => {
    // The whole invalidation story is the version string. Without it in the SITE cache name, a
    // reader is served the build they first visited on until they clear site data by hand --
    // and nothing anywhere would look wrong.
    const src = worker();
    const names = [...src.matchAll(/["'`]navcom-(terminal|site)-/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(['terminal', 'site']));

    // Two distinct literal cache names, each interpolating something. A hardcoded version is
    // the shape this fails in.
    const versioned = [...src.matchAll(/`navcom-(?:terminal|site)-\$\{[^}]+\}`/g)];
    expect(versioned).toHaveLength(2);
  });

  it('is reachable at all, because the root console registers it', () => {
    // The public site is `csr = false` and registers nothing. It is served by the worker the
    // ROOT CONSOLE registers at scope `/`. Flip the root to csr=false for any reason -- a
    // bundle-budget panic is the plausible one -- and public caching silently stops existing
    // while every test here still passes. This is that test.
    const root = readFileSync(
      fileURLToPath(new URL('../routes/+page.ts', import.meta.url)),
      'utf8'
    );
    expect(root).toMatch(/export const csr = true/);
  });

  it('serves public documents from cache before the network', () => {
    // `caches.match` must come first for the request to cost nothing. A revalidating variant
    // would still be a request, which is the metric that spiked in August.
    const src = worker();
    expect(src).toMatch(/caches\.match/);
  });
});

describe('what the worker must never store', () => {
  it('refuses the directory payload, which is megabytes', () => {
    const src = worker();
    expect(src).toMatch(/\/directory\.json/);
    expect(src).toMatch(/\.car/);
    expect(src).toMatch(/\.well-known\//);
  });

  it('and that payload is still big enough for the refusal to be the point', () => {
    // If directory.json ever becomes small, this assertion is the place to find out and
    // reconsider, rather than carrying a guard whose reason nobody remembers. The device floor
    // is a phone with 400 MB free.
    const path = join(BUILD, 'directory.json');
    if (!existsSync(path)) throw new Error('directory.json was not built');
    expect(statSync(path).size).toBeGreaterThan(4_000_000);
  });

  it('caps the public set, because there are nearly two thousand region pages', () => {
    // Minification renames the constant, so the mechanism is what gets asserted: entries read
    // back with keys() and removed with delete(). A cache that only ever puts is the shape
    // that fills a phone, and it is indistinguishable from this one at a glance.
    const src = worker();
    expect(src).toMatch(/\.keys\(\)/);
    expect(src).toMatch(/caches\.open\([^)]*\)/);
    expect(src).toMatch(/\.delete\(/);
  });
});

describe('the deploy stamp, and which build a reload would load', () => {
  /** The commit the stamp beside this worker names. */
  const stamped = (): string => {
    const path = join(BUILD, 'version.json');
    if (!existsSync(path)) throw new Error('version.json was not built');
    return (JSON.parse(readFileSync(path, 'utf8')) as { commit: string }).commit;
  };

  it('never stores the stamp, so a page asking what is deployed is told what is', () => {
    // It was kept cache-first in the site cache like any public document, so within one build of the
    // worker the Watch screen asking what is deployed was told what was deployed when it first asked,
    // and could never hear of a newer one.
    //
    // In the never-cached predicate itself, beside the directory it already refused: one expression,
    // with no comma or statement between them. Named anywhere else -- a precache list, a cache-first
    // route -- the worker would store it, and a bare "the file is named" would still pass.
    expect(worker()).toMatch(
      /\/version\.json[`'"][^,;]*\/directory\.json[`'"]|\/directory\.json[`'"][^,;]*\/version\.json[`'"]/
    );
  });

  it('says which commit it is when asked, the one the stamp beside it names', () => {
    // The Watch screen asks the worker controlling it, because the worker's cache is what a reload
    // loads. A commit the build could not say ("unknown") leaves the screen nothing to compare.
    const commit = stamped();
    expect(commit, 'a build that cannot say its commit cannot say a newer one is waiting').toMatch(/^[0-9a-f]{7}$/);
    const src = worker();
    expect(src).toMatch(/["'`]build["'`]/);
    expect(src).toMatch(new RegExp(`["'\`]${commit}["'\`]`));
  });
});
