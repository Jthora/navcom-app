/**
 * Evidence that the suite ran, written by the run itself.
 *
 * ## Why this exists now
 *
 * There is no CI and there is not going to be. That is a decision rather than a gap — see
 * [`build-order.md`](../../docs/build-order.md) 9.9 — and it makes the deploy the only gate this
 * project has. `vercel.json` runs every workspace's `verify` as its build command, so a deploy
 * that ships is a deploy whose tests passed.
 *
 * But nobody outside can see that. A static site looks identical whether it was tested or thrown
 * over the wall, which is the thing the whole EIN round kept finding: *a check that never runs
 * looks exactly like a check that passes.* So the run leaves a receipt, and the health endpoint
 * publishes it.
 *
 * ## Reaching this file is most of the proof
 *
 * The verify chain is `&&`-joined, so this only executes if `check`, `check:data`, `build` and
 * `test` all succeeded. Its **existence** is the evidence; the counts inside it are detail. A
 * receipt that could be written by a failed run would be worth nothing, which is why this is a
 * separate step late in the chain rather than a flag on the test command.
 *
 * ## What it refuses to claim
 *
 * Whether the *browser* suite ran, unless it did. `verify:deploy` omits Playwright — it is too
 * heavy for a build container — so a deployed build has 400-odd unit tests behind it and none of
 * the 269 that drive a real page. Reporting that as "tested" would be the same conflation this
 * project has spent a week refusing, so the receipt names the two separately and a reader can
 * weigh them.
 */

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const BUILD = join(WEB, 'build');
const RESULT = join(WEB, '.vitest.json');

/**
 * Counts from vitest's own JSON report, or null.
 *
 * Null rather than zero when the file is missing or unreadable: a receipt claiming zero tests
 * passed reads like a pass with nothing in it, and *unknown* is the honest word for a number
 * nobody established. Invariant 9, pointed at this project's own verification.
 */
function counts() {
  if (!existsSync(RESULT)) return null;
  try {
    const r = JSON.parse(readFileSync(RESULT, 'utf8'));
    if (typeof r.numTotalTests !== 'number') return null;
    return {
      total: r.numTotalTests,
      passed: r.numPassedTests ?? null,
      failed: r.numFailedTests ?? null,
      files: r.numTotalTestSuites ?? null
    };
  } catch {
    return null;
  }
}

/**
 * Whether the browser suite ran in this same pass.
 *
 * Inferred from Playwright's own output rather than from which npm script was invoked — a
 * receipt that trusted the script name would keep saying "browser: true" the day somebody
 * reorders the chain.
 */
function browserRan() {
  for (const marker of ['playwright-report/index.html', 'test-results/.last-run.json']) {
    const path = join(WEB, marker);
    if (!existsSync(path)) continue;
    try {
      // Within the hour, so a report left over from last week is not counted as this run.
      if (Date.now() - statSync(path).mtimeMs < 3_600_000) return true;
    } catch {
      // An unreadable marker is not evidence of anything. Keep looking.
    }
  }
  return false;
}

const unit = counts();
const receipt = {
  /*
   * Where the tests ran, not where the build ran. Vercel sets `CI`, so a build container would
   * otherwise report itself as continuous integration — which is the exact overclaim this file
   * exists to prevent. A deploy is a gate, and calling it CI would imply a schedule that no
   * longer exists.
   */
  ran: process.env.CI ? 'deploy' : 'local',
  at: new Date().toISOString(),
  counts: unit,
  browser: browserRan(),
  /** Said in the artifact, because it is the limit a reader most needs and least expects. */
  note: browserRan()
    ? 'unit and browser suites, this pass'
    : 'unit suite only — the browser suite is not run on deploy'
};

mkdirSync(BUILD, { recursive: true });
writeFileSync(join(BUILD, '.verify-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');

// Removed once recorded: a stale report left lying around is a number a later run could pick up
// and publish as its own, which is how a receipt starts lying without anybody editing it.
if (existsSync(RESULT)) unlinkSync(RESULT);

console.log(
  `[receipt] ${receipt.ran} — ${unit ? `${unit.passed}/${unit.total} unit tests` : 'no counts'}, ` +
    `browser ${receipt.browser ? 'ran' : 'not run'}`
);
