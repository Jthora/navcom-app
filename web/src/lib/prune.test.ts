/**
 * What the prune step removes, and — more importantly — what it must never remove.
 *
 * `scripts/prune-data.mjs` deletes the `__data.json` files that zero-JavaScript prerendered pages
 * can never fetch. The obvious test is that they are gone. The test that matters is the other
 * direction: **the terminal's data files must survive**, because an operator's saved area renders
 * its records from `__data.json` offline [service-worker.ts], and a prune that reached one would
 * empty a screen exactly when there is no signal to refill it. Nothing would look wrong online.
 *
 * Read from `build/`, after `prune` has run, because the rule is about what ships.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));

function dataFiles(dir: string): string[] {
  const root = join(BUILD, dir);
  if (!existsSync(root)) throw new Error(`${dir} was not built`);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === '__data.json') out.push(p);
    }
  };
  walk(root);
  return out;
}

describe('the prune step', () => {
  it('leaves no data files under the zero-JavaScript trees', () => {
    // These pages have no client router, so nothing can construct the URL of one of these, let
    // alone fetch it. What remains is storage on every retained deployment and crawler surface.
    expect(dataFiles('directory')).toEqual([]);
    expect(dataFiles('docs')).toEqual([]);
  });

  it('never reaches the terminal, whose saved areas render from these files offline', () => {
    // The failure path, and the one that would be silent: online, an emptied area refetches.
    expect(dataFiles('terminal').length).toBeGreaterThan(0);
    expect(dataFiles('terminal/directory').length).toBeGreaterThan(0);
  });
});
