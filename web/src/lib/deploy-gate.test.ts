/**
 * The deploy gate: which workspaces' suites a deploy runs [scripts/deploy-gate.mjs].
 *
 * A suite whose code did not change since the live build is not run again; anything it cannot be
 * sure of runs everything. The rule it must never break is the second one: a skipped suite that
 * should have run is a deploy that ships untested code and says it was tested.
 */

import { describe, expect, it } from 'vitest';
import { EVERYTHING, WORKSPACES, mustRun } from '../../scripts/deploy-gate.mjs';

const ALL = WORKSPACES.map((w) => w.name);

describe('which suites a deploy runs', () => {
  it('runs every one when it cannot say what changed', () => {
    expect(mustRun(null)).toEqual(ALL);
  });

  it('runs none of the workspaces for a change to the site alone, whose own checks always run', () => {
    expect(mustRun(['web/src/routes/+page.svelte', 'docs/design/map.md', 'web/static/grid/world.json'])).toEqual([]);
  });

  it('runs every workspace that reads core when core changes', () => {
    expect(mustRun(['packages/core/src/relays.ts'])).toEqual(ALL);
  });

  it('runs the box’s suite for the box alone, and the seeder’s for the seeder alone', () => {
    expect(mustRun(['packages/watchtower/src/escalation.ts'])).toEqual(['@navcom/watchtower']);
    expect(mustRun(['packages/seeder/src/seed.ts'])).toEqual(['@navcom/seeder']);
  });

  it('runs everything for a dependency, the lockfile, the build command or the gate itself', () => {
    for (const path of EVERYTHING) expect(mustRun([path]), path).toEqual(ALL);
    expect(mustRun(['web/src/app.html', 'package-lock.json'])).toEqual(ALL);
  });

  it('does not take a path that only starts like a package for that package', () => {
    expect(mustRun(['packages/core-notes.md', 'packages/watchtowers/x.ts'])).toEqual([]);
  });
});
