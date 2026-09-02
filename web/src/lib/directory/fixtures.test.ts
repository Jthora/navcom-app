import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDirectory, loadRegions } from './index';

/**
 * No fixture ever reaches a reader.
 *
 * `data/regions/example/` holds two invented shelters — *EXAMPLE — Riverside Emergency
 * Shelter* and *EXAMPLE — Eastside Warming Center* — with an address, a phone number and a
 * `last_verified` date. They existed to demonstrate the schema and they were **published**:
 * searchable at the root console, each with a full public record page, and both in
 * `directory.json` for anybody consuming the export.
 *
 * Only the `/directory/` index labelled them. The three surfaces a person in trouble actually
 * meets did not — and a record page that looks exactly like a real one is the "confident wrong
 * answer that sends someone somewhere that turns them away" the display rules exist to
 * prevent, arriving by a route the display rules never see.
 *
 * `_template` was excluded by folder name from the beginning; `status: 'example'` was excluded
 * by nothing. This asserts against the **built artifact** rather than the loader, because the
 * loader was correct about `_template` for months while the fixture shipped beside it.
 */

const BUILD = fileURLToPath(new URL('../../../build/', import.meta.url));

function filesUnder(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) filesUnder(path, out);
    else if (entry.endsWith('.html') || entry.endsWith('.json')) out.push(path);
  }
  return out;
}

/**
 * The marker every fixture record carries in its own name.
 *
 * Matched on the record id prefix rather than the word alone, so this cannot be defeated by a
 * real place that happens to be called "Example Street Mission" — and cannot pass vacuously
 * because a fixture was quietly renamed.
 */
const FIXTURE_ID = /EXAMPLE-[a-z]+-\d+/;

describe('fixture data never reaches a reader', () => {
  it('is excluded from the loader, regions and records alike', () => {
    const regions = loadRegions();
    const records = loadDirectory();

    expect(regions.length, 'no regions loaded at all — this proves nothing').toBeGreaterThan(10);
    expect(records.length, 'no records loaded at all — this proves nothing').toBeGreaterThan(100);

    expect(regions.filter((r) => r.status === 'example')).toEqual([]);
    expect(regions.map((r) => r.slug)).not.toContain('example');
    expect(records.filter((r) => FIXTURE_ID.test(r.id))).toEqual([]);
  });

  it('appears nowhere in the built site — no page, no index, no export', () => {
    /*
     * The assertion that matters. A loader filter is easy to add and easy to bypass: the
     * console builds its own search index in `+page.server.ts`, `directory.json` is emitted by
     * the export, and record pages are prerendered per id. Three separate paths out of the
     * same data, and any one of them could reintroduce a fixture without the loader noticing.
     */
    const files = filesUnder(BUILD);
    expect(files.length, 'no build output — run `npm run build` first').toBeGreaterThan(100);

    const leaked: string[] = [];
    for (const path of files) {
      // This file's own name would otherwise match; it is not in the build, but be exact.
      if (FIXTURE_ID.test(readFileSync(path, 'utf8'))) leaked.push(path.replace(BUILD, ''));
    }
    expect(leaked, `fixture records reached the published site: ${leaked.join(', ')}`).toEqual([]);
  });

  it('and no fixture region is offered anywhere a person picks one', () => {
    // The region picker on the console, and the area list in the terminal. A fake city between
    // Edinburgh and Fort Worth is its own small lie even before anybody opens it.
    for (const page of ['index.html', 'terminal/directory/index.html', 'directory/index.html']) {
      const path = join(BUILD, page);
      if (!existsSync(path)) continue;
      expect(readFileSync(path, 'utf8'), `${page} still offers the fixture region`).not.toContain(
        'Example Metro'
      );
    }
  });
});
