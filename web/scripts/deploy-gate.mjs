#!/usr/bin/env node
/**
 * The deploy gate: every workspace's `verify` whose code changed since the build that is live, and
 * the site's own checks every time. Vercel's build command [vercel.json].
 *
 * ## Why it skips anything
 *
 * There is no CI, by decision [build-order.md 9.9], so the deploy is the only gate, and it ran every
 * workspace's suite on every push: 20 minutes on Vercel's two-core builder, of which the site's own
 * build was a minute and a half (measured 2026-10-30). The box's suite alone was 5 minutes, and the box
 * is never deployed here. A suite whose code, and whose code's dependencies, did not change since the
 * last deploy that passed it, gives the same answer it gave then; running it again proves nothing new.
 *
 * ## When it runs everything
 *
 * Whenever it cannot say what changed: no live commit to compare with, a live commit this clone does
 * not have, a git that will not answer. A dependency, the lockfile, this script or `vercel.json`
 * changing runs everything too. **Unknown runs the suite; it never skips it.**
 *
 * ## What it says
 *
 * `web/.deploy-gate.json`, which `receipt.mjs` copies into the receipt the health file publishes, so a
 * reader sees which suites ran on this deploy and which stood on the commit they last passed at. A
 * deploy that skipped the box's suite never reads as one that ran it.
 *
 *   node web/scripts/deploy-gate.mjs --plan    what a deploy of this checkout would run, running nothing
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(ROOT, 'web/.deploy-gate.json');

/** Each workspace's verify, in the order the gate always ran them, and what it reads. */
export const WORKSPACES = [
  { name: '@navcom/core', script: 'verify', reads: ['packages/core/'] },
  { name: '@navcom/watchtower', script: 'verify', reads: ['packages/watchtower/', 'packages/core/'] },
  { name: '@navcom/seeder', script: 'verify', reads: ['packages/seeder/', 'packages/core/'] }
];
/** The site's checks, build and unit suite: always, since they are what ships. */
const SITE = { name: 'navcom-web', script: 'verify:deploy' };
/** A change to any of these can change what every suite does. */
export const EVERYTHING = ['package.json', 'package-lock.json', 'vercel.json', 'web/scripts/deploy-gate.mjs'];

/**
 * Which workspaces must run, given the paths changed since the live build, or null for "unknown",
 * which runs them all. Pure, for the test.
 * @param {string[] | null} changed
 * @returns {string[]}
 */
export function mustRun(changed) {
  if (changed === null) return WORKSPACES.map((w) => w.name);
  if (changed.some((p) => EVERYTHING.some((e) => p === e || p.startsWith(e)))) return WORKSPACES.map((w) => w.name);
  return WORKSPACES.filter((w) => changed.some((p) => w.reads.some((r) => p.startsWith(r)))).map((w) => w.name);
}

const git = (/** @type {string[]} */ ...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

/**
 * The commit that is live: what Vercel says it last deployed, or what navcom.app's health file names.
 * One request a deploy, never more.
 * @returns {Promise<{ commit: string; from: string } | null>}
 */
async function liveCommit() {
  const fromHost = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (fromHost && /^[0-9a-f]{40}$/.test(fromHost)) return { commit: fromHost, from: 'VERCEL_GIT_PREVIOUS_SHA' };
  try {
    const r = await fetch('https://navcom.app/.well-known/navcom-health.json', { signal: AbortSignal.timeout(10_000) });
    const j = r.ok ? await r.json() : null;
    if (j && typeof j.commit === 'string' && /^[0-9a-f]{40}$/.test(j.commit)) return { commit: j.commit, from: 'navcom.app health file' };
  } catch {
    /* unknown */
  }
  return null;
}

async function main() {
  const live = await liveCommit();
  const known = live && git('cat-file', '-e', `${live.commit}^{commit}`) !== null ? live : null;
  const diff = known ? git('diff', '--name-only', known.commit, 'HEAD') : null;
  const changed = diff === null ? null : diff.split('\n').filter(Boolean);
  const run = new Set(mustRun(changed));
  const why = !live
    ? 'running everything: no live commit could be read'
    : !known
      ? `running everything: the live commit ${live.commit.slice(0, 7)} is not in this clone`
      : changed === null
        ? 'running everything: git could not say what changed'
        : null;

  const gate = {
    base: known ? known.commit : null,
    base_from: known ? known.from : null,
    unknown: why,
    workspaces: Object.fromEntries(
      WORKSPACES.map((w) => [w.name, run.has(w.name) ? 'ran' : `unchanged since ${known?.commit.slice(0, 7)}, which passed it`])
    )
  };
  // `--plan` says what a deploy of this checkout would run, and runs nothing.
  const plan = process.argv.includes('--plan');
  if (!plan) writeFileSync(OUT, JSON.stringify(gate, null, 2) + '\n');
  console.log(`[gate] ${why ?? (changed === null ? 'git could not say what changed: running everything' : `comparing with ${known?.commit.slice(0, 7)} (${known?.from}), ${changed.length} paths changed`)}`);
  for (const [name, said] of Object.entries(gate.workspaces)) console.log(`[gate] ${name}: ${said}`);
  if (plan) return;

  for (const w of [...WORKSPACES.filter((x) => run.has(x.name)), SITE]) {
    console.log(`\n[gate] npm run ${w.script} --workspace ${w.name}`);
    const r = spawnSync('npm', ['run', w.script, '--workspace', w.name], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
