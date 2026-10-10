/**
 * Bundle budget check: `npm run budget`.
 *
 * "The device floor is a real target, not an aspiration. Check bundle size." — CLAUDE.md
 * Budgets in docs/delivery.md. This fails the build rather than warning, because a budget
 * nobody enforces is a wish.
 *
 * The budgets and the measurement live in `lib/budget.mjs`, which the tests import. This file only
 * runs it, and it runs it unconditionally. It used to hold everything and run itself only when
 * `import.meta.url` matched `file://${process.argv[1]}`, so that a test could import it without
 * measuring the real build. That comparison is false for a checkout whose path has a space in it
 * (the URL spells it `%20`) or is reached through a symlink, and then `npm run budget` measured
 * nothing, wrote nothing and exited 0, verify passed, and the health file published `budget: null`.
 * **Nothing imports this file**, so it needs no condition, and has none left to fail.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from './lib/budget.mjs';

/*
 * Both resolved from this file, not from the working directory. Run from the repo root, a
 * cwd-relative path finds no manifest and the deferred check reports nothing — silently, which is
 * the one way that check must never fail.
 */
const BUILD = fileURLToPath(new URL('../build/', import.meta.url));
const MANIFEST = fileURLToPath(new URL('../.svelte-kit/output/client/.vite/manifest.json', import.meta.url));

let result;
try {
  result = measure({ build: BUILD, manifestPath: MANIFEST });
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
writeFileSync(join(BUILD, '.budget.json'), JSON.stringify(result.report, null, 2) + '\n');
process.exit(result.failed ? 1 : 0);
