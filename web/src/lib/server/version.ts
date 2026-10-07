/**
 * What this build is, and when it was made.
 *
 * There was no way to ask what was deployed. So "is it live yet" got answered by fetching a
 * page and looking for a string, over and over — which is inference rather than an answer,
 * and enough of it tripped the host's bot mitigation into serving a challenge page to
 * everybody. **The absence of this module caused that behaviour.**
 *
 * Computed once per build and shared, so the status page and `/version.json` cannot
 * disagree. Two places deriving the same fact separately is how a build stamp starts lying
 * about itself.
 *
 * `$lib/server` is server-only by SvelteKit's convention: none of this can reach a browser,
 * which matters because it shells out to git.
 */

import { execFileSync } from 'node:child_process';

export interface Version {
  /** Short commit SHA, or `unknown` where neither the host nor git could say. */
  commit: string;
  /** ISO 8601, UTC. Absolute rather than relative — it stays true however late it is read. */
  builtAt: string;
  /**
   * True when the working tree had uncommitted changes.
   *
   * A locally-built site should say so. A stamp that claims a clean commit while carrying
   * somebody's half-finished edit is worse than no stamp, because it invites trust.
   */
  dirty: boolean;
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // No git, no repository, or a shallow clone with no history. All mean "cannot say".
    return null;
  }
}

function read(): Version {
  // The host knows better than git does: a CI checkout may be detached or shallow, and
  // Vercel sets this from the deployment itself.
  const fromHost = process.env['VERCEL_GIT_COMMIT_SHA'];
  /*
   * Seven characters, from either source. `git rev-parse --short` lengthens the prefix once seven
   * become ambiguous in the repository — which this one did, the day 1,911 data files changed in
   * one commit — and a stamp that is seven characters on the host and eight on a laptop is two
   * formats for one fact.
   */
  const commit = (fromHost ?? git(['rev-parse', 'HEAD']))?.slice(0, 7) ?? 'unknown';

  return {
    commit,
    builtAt: new Date().toISOString(),
    // A host build is from a clean checkout by construction, so only ask git locally.
    dirty: fromHost ? false : (git(['status', '--porcelain']) ?? '') !== ''
  };
}

/**
 * Computed on first import and never again.
 *
 * A build is one moment. Recomputing per page would stamp each one a few milliseconds apart
 * and make the whole thing meaningless as an identity.
 */
export const VERSION: Version = read();
