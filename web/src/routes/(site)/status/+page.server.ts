/**
 * What is actually built, derived rather than remembered.
 *
 * The component list on this page was hand-written, and `build-order.md` predicted in
 * writing that it *"will drift from this file"*. It did: by the time anybody checked, five
 * of six lines were wrong — escalation and the field terminal both said "not built" and had
 * shipped, the Console line described a decision that had been reversed, and the directory
 * said "no real data yet" while holding 479 records.
 *
 * Wrong in the modest direction, which is less dangerous than the other one and still
 * false. So the fix is not to correct the list — that only resets the clock on the same
 * drift — it is to **tie each line to something a build can check**.
 *
 * Where a claim cannot be derived, it says so rather than being asserted.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadDirectory, loadRegions } from '$lib/directory/load';
import { VERSION } from '$lib/server/version';

export const prerender = true;

/**
 * The repository root, found by walking up rather than counted in `../`.
 *
 * `import.meta.url` was the obvious choice and is wrong: SvelteKit compiles server code
 * into `.svelte-kit/output/server/`, so a relative path from it lands nowhere near the
 * source tree — and the failure mode was this page quietly reporting everything as not
 * built, which is exactly the drift it exists to prevent.
 */
function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (let up = 0; up < 6; up++) {
    if (existsSync(join(dir, 'packages')) && existsSync(join(dir, 'data'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Cannot find the repository root from ' + process.cwd());
}

const ROOT = repoRoot();

/** Built means the code is here. It does not mean it works, and nothing here says it does. */
const shipped = (path: string) => existsSync(join(ROOT, path));

export function load() {
  const records = loadDirectory();
  const regions = loadRegions();
  const withData = new Set(records.map((r) => r.region)).size;

  return {
    /**
     * When this page was built, absolutely.
     *
     * Absolute rather than "3 days ago" for the same reason the directory shows absolute
     * dates: this site ships no JavaScript, so a relative age would be frozen at build
     * time and start lying the moment it was read. A date stays true.
     *
     * It is also how the daily rebuild reports on itself. A date several days back means
     * the scheduled job is not running.
     */
    version: VERSION,

    components: [
      {
        name: 'Watch state machine',
        built: shipped('packages/watchtower/src/daemon/watchtower.ts'),
        note: 'The board, timers and signal routing. Runs on a box.'
      },
      {
        name: 'Escalation ladder',
        built: shipped('packages/watchtower/src/escalation/executor.ts'),
        note: 'Separate process, its own relay subscription. Its seven failure modes are tests.'
      },
      {
        name: 'Drills',
        built: shipped('packages/watchtower/src/escalation/drills.ts'),
        note: 'Unannounced and randomised. Results below, when a box is publishing them.'
      },
      {
        name: 'Field terminal',
        built: shipped('web/src/routes/terminal/+page.svelte'),
        note: 'navcom.app/terminal — status, signals, directory, your own record.'
      },
      {
        name: 'Accountability log',
        built: shipped('packages/watchtower/src/shared/accountability.ts'),
        note: 'Hash-chained, with inclusion proofs so an operator can check their own entries.'
      },
      {
        name: 'Directory',
        built: records.length > 0,
        note: `${records.length} records across ${withData} of ${regions.length} areas. ` +
          'Public facts only — the intake rules need a person.'
      }
    ],

    /**
     * The things that are true and cannot be derived from a file existing.
     *
     * These are the honest limits, and they matter more than the list above: code being
     * present is a much weaker claim than anybody wants it to be.
     */
    unproven: [
      'No watch is staffed. A Distress today pages nobody and says so.',
      'No drill has ever passed, because a pass needs a human on-call to answer one.',
      'The directory holds public facts. Nobody has verified an intake rule — whether a ' +
        'place takes pets, needs ID, or has a curfew — and those read as unknown.'
    ]
  };
}
