import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
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

  /*
   * Five minutes, declared rather than inherited.
   *
   * This scans the entire built site -- 26,634 files and 297 MB -- because that is the
   * assertion: not "the loader filters fixtures" (the test above covers that) but "no path out
   * of the data reintroduced one". `grep` does it in about eight seconds, which no amount of
   * tuning brings under vitest's five-second default.
   *
   * It was ninety, and that was measured against an idle machine. The same grep takes **38
   * seconds at load average 16** -- which is what committing 1,836 region directories does to
   * a laptop while Spotlight indexes them. Eight seconds of work with 90 allowed sounds like
   * ample margin and is 2.4x; the observed penalty is 4.75x. The budget is now set against the
   * loaded case, because that is the case a developer actually runs it in.
   *
   * It was failing as a **timeout**, which in this file reads exactly like a fixture leak --
   * the one thing it exists to detect. A guard whose failure mode is indistinguishable from
   * the bug it guards against is worse than a slow one, so the cost is stated here instead of
   * being discovered at 2am.
   */
  it('appears nowhere in the built site — no page, no index, no export', { timeout: 300_000 }, async () => {
    /*
     * The assertion that matters. A loader filter is easy to add and easy to bypass: the
     * console builds its own search index in `+page.server.ts`, `directory.json` is emitted by
     * the export, and record pages are prerendered per id. Three separate paths out of the
     * same data, and any one of them could reintroduce a fixture without the loader noticing.
     */
    /*
     * A cheap proof the build exists, rather than an expensive one.
     *
     * This was `filesUnder(BUILD).length > 100` -- a recursive walk with a `statSync` per
     * entry, which at 10,416 pages was the 52 seconds, not the search. The guard it provides
     * is "there is something here to scan", and three known files prove that as well as a
     * full enumeration does.
     */
    for (const proof of ['index.html', 'directory/index.html', 'terminal/index.html']) {
      expect(existsSync(join(BUILD, proof)), `no build output — run \`npm run build\` first`)
        .toBe(true);
    }

    /*
     * Scanned with `grep`, not by reading every file into JavaScript.
     *
     * The first version did `readFileSync` per file. At 68 regions that was a second; at 1,915
     * it was **54 seconds against vitest's 5-second default**, and the guard failed as a
     * timeout — reading exactly like a fixture leak, in the test whose whole job is catching
     * one. A guard that gets slower as the directory grows stops being a guard, and this is
     * the second time that shape has appeared here.
     *
     * `grep` exits 1 when nothing matches, which is the passing case; any other status is a
     * real error and is rethrown.
     */
    let leaked: string[] = [];
    try {
      /*
       * Async, not `execFileSync`. A synchronous child process blocks this worker's event loop
       * for the whole scan, so vitest's IPC heartbeat goes unanswered and the worker is killed
       * with `ERR_IPC_CHANNEL_CLOSED` -- which passes when the file runs alone and dies inside
       * the full suite, the worst possible way for a guard to fail.
       */
      const { stdout } = await run(
        'grep',
        ['-rlE', 'EXAMPLE-[a-z]+-[0-9]+', '--include=*.html', '--include=*.json', BUILD],
        { maxBuffer: 32 * 1024 * 1024 }
      );
      leaked = stdout.split('\n').filter(Boolean).map((p) => p.replace(BUILD, ''));
    } catch (err) {
      // grep exits 1 when nothing matches, which is the passing case.
      if ((err as { code?: number }).code !== 1) throw err;
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
