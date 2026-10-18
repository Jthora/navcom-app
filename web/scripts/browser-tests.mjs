#!/usr/bin/env node
/**
 * Runs the browser tests, and says what to do when it cannot.
 *
 * These run inside `npm run verify`, not beside it. A check that only runs in CI is one
 * nobody sees fail until after they have pushed — and the whole reason this layer exists is
 * that nine shipped things did not do what they said.
 *
 * **It refuses to skip.** A skipped test is an unmoored claim by another route: the suite
 * goes green, the summary says everything passed, and the thing was never checked. So a
 * missing browser is a failure with the one command that fixes it, not a shrug.
 */

import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['playwright', 'test'], { stdio: 'inherit', shell: false });

if (/** @type {NodeJS.ErrnoException | undefined} */ (result.error)?.code === 'ENOENT') {
  console.error('\n  Playwright is not installed. From web/:  npm i -D @playwright/test\n');
  process.exit(1);
}

if (result.status !== 0) {
  // Playwright already printed the failures. The only thing worth adding is the case it
  // cannot distinguish for itself: a browser that was never downloaded.
  console.error(
    '\n  If that failed because no browser was found:  npx playwright install chromium\n'
  );
  process.exit(result.status ?? 1);
}
