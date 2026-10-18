#!/usr/bin/env node
/**
 * Checks the running Node against `.nvmrc` before anything else runs.
 *
 * A shell that picked up an older Node fails web vitest with
 * `crypto.getRandomValues must be defined`, across about thirty tests in a dozen files. That
 * reads as a regression in the crypto code, and it is not one. This laptop's non-interactive
 * shell defaults to 18, so it happens. A preflight turns it into one line naming the fix,
 * before a build has been spent finding out.
 *
 * - A different major: refused, exit 1.
 * - The same major at another minor or patch: one line, and carry on. Nothing known breaks
 *   inside a major, and refusing would only teach people to skip this.
 * - On Vercel (`VERCEL=1`) a different major is a warning, not a refusal. The deploy's Node is a
 *   project setting this repository cannot see or change, so refusing would block a release for
 *   a reason that is not in the release. The suite still runs there and still fails on its own
 *   if the version really breaks it.
 *
 *   node web/scripts/preflight.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const NVMRC = fileURLToPath(new URL('../../.nvmrc', import.meta.url));

/**
 * @param {string} wanted contents of `.nvmrc`, such as `22.23.2` or `v22`
 * @param {string} running `process.version`, such as `v18.16.0`
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean, say: string | null }}
 */
export function compare(wanted, running, env = process.env) {
  const want = wanted.trim().replace(/^v/, '');
  const have = running.trim().replace(/^v/, '');
  if (!/^\d+(\.\d+){0,2}$/.test(want)) {
    return { ok: false, say: `.nvmrc says ${JSON.stringify(wanted.trim())}, which is not a Node version this check can read.` };
  }
  if (have === want || have.startsWith(want + '.')) return { ok: true, say: null };
  const major = (/** @type {string} */ v) => v.split('.')[0];
  if (major(have) === major(want)) {
    return { ok: true, say: `[preflight] Node ${have} is running; .nvmrc pins ${want}. Same major, carrying on.` };
  }
  const fix =
    `Node ${have} is running, and .nvmrc pins ${want}. ` +
    `On another major the web suite fails with errors that look like regressions ` +
    `(on 18: "crypto.getRandomValues must be defined"). From the repository root: nvm use`;
  if (env['VERCEL'] === '1') return { ok: true, say: `[preflight] warning: ${fix}` };
  return { ok: false, say: `[preflight] ${fix}` };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { ok, say } = compare(readFileSync(NVMRC, 'utf8'), process.version);
  if (say) (ok ? console.log : console.error)(say);
  if (!ok) process.exit(1);
}
