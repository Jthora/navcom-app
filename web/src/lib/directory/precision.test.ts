/**
 * No published file claims more precision than its position earned [docs/design/map.md §0].
 *
 * Read from `build/`, because this project has three times shipped a rule the logic honoured and
 * the output did not [verification.md]. The parser refuses an over-precise coordinate; this asks
 * what a reader actually receives — the directory file, the region centres the landing page picks
 * the nearest from, and the map link on every record page, where false precision becomes somebody
 * standing in the wrong car park [map.md §5].
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADDRESS_DECIMALS, REGION_DECIMALS, decimalsOf } from '@navcom/core';

const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));

function built(path: string): string {
  const file = join(BUILD, path);
  if (!existsSync(file)) throw new Error(`${path} was not built`);
  return readFileSync(file, 'utf8');
}

describe('the published files carry the precision their positions earned', () => {
  it('every coordinate in directory.json, to an address’s five decimals or fewer', () => {
    const { records } = JSON.parse(built('directory.json')) as {
      records: { id: string; fields: Record<string, { values?: string[] }> }[];
    };
    let seen = 0;
    const over: string[] = [];
    for (const r of records) {
      for (const k of ['lat', 'lon']) {
        for (const v of r.fields[k]?.values ?? []) {
          seen += 1;
          const d = decimalsOf(v);
          if (d === null || d > ADDRESS_DECIMALS) over.push(`${r.id} ${k}=${v}`);
        }
      }
    }
    // Something to check, so a passing run means something.
    expect(seen).toBeGreaterThan(19_000);
    expect(over.slice(0, 5)).toEqual([]);
  });

  it('every region centre, to a region’s two', () => {
    const { centroids } = JSON.parse(built('console-regions.json')) as {
      centroids: { region: string; lat: number; lon: number }[];
    };
    expect(centroids.length).toBeGreaterThan(1_900);
    const over = centroids.filter((c) => [c.lat, c.lon].some((n) => (decimalsOf(String(n)) ?? 99) > REGION_DECIMALS));
    expect(over.slice(0, 5)).toEqual([]);
  });

  it('no record page links out with a coordinate finer than an address', () => {
    const ids = readdirSync(join(BUILD, 'directory'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(ids.length).toBeGreaterThan(9_000);
    let links = 0;
    const over: string[] = [];
    for (const id of ids) {
      const file = join(BUILD, 'directory', id, 'index.html');
      if (!existsSync(file)) continue;
      for (const [, href] of readFileSync(file, 'utf8').matchAll(/href="([^"]*)"/g)) {
        if (!/maps|geo:|openstreetmap/.test(href!)) continue;
        links += 1;
        const fine = href!.match(/-?\d{1,3}\.\d{6,}/);
        if (fine) over.push(`${id}: ${fine[0]}`);
      }
    }
    expect(links).toBeGreaterThan(9_000);
    expect(over.slice(0, 5)).toEqual([]);
  });
});
