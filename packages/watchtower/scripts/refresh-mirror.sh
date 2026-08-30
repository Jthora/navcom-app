#!/bin/bash
# Refreshes the read-only Jthora/navcom-watchtower mirror from this monorepo.
#
# Vendors a fresh build of @navcom/core into the mirror and rewrites the mirror's own
# package.json to point at it -- found necessary the hard way: the workspace's own
# "@navcom/core": "file:../core" dependency only resolves inside this monorepo, so a bare
# subtree split produced a mirror that looked right (correct files, correct history) and
# failed immediately on `npm run verify` in a fresh clone. See packages/watchtower/README.md.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  exit 1
fi

echo "==> Building @navcom/core fresh, so the vendored copy matches current source"
npm run build --workspace @navcom/core

echo "==> Splitting packages/watchtower's history into a local branch"
git branch -D watchtower-mirror >/dev/null 2>&1 || true
git subtree split --prefix=packages/watchtower -b watchtower-mirror >/dev/null

WORKTREE=$(mktemp -d)
trap 'git worktree remove "$WORKTREE" --force >/dev/null 2>&1 || true' EXIT

echo "==> Vendoring @navcom/core's build into the mirror"
git worktree add "$WORKTREE" watchtower-mirror >/dev/null
mkdir -p "$WORKTREE/vendor/navcom-core"
cp -r packages/core/dist "$WORKTREE/vendor/navcom-core/dist"
cp packages/core/package.json "$WORKTREE/vendor/navcom-core/package.json"

node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';

const wtPath = '$WORKTREE/package.json';
const wt = JSON.parse(readFileSync(wtPath, 'utf8'));
wt.dependencies['@navcom/core'] = 'file:./vendor/navcom-core';
delete wt.scripts.core;
delete wt.scripts.prebuild;
delete wt.scripts.pretest;
writeFileSync(wtPath, JSON.stringify(wt, null, 2) + '\n');

// The vendored copy is prebuilt output, not a buildable package in its own right here --
// found the hard way: npm runs a nested dependency's own \"prepare\" script during install
// regardless of whether the parent needs it, and core's tries to run tsc against source
// and devDependencies this vendoring deliberately does not carry. Scripts and
// devDependencies stripped so npm never attempts it.
const corePath = '$WORKTREE/vendor/navcom-core/package.json';
const core = JSON.parse(readFileSync(corePath, 'utf8'));
delete core.scripts;
delete core.devDependencies;
writeFileSync(corePath, JSON.stringify(core, null, 2) + '\n');
"

(
  cd "$WORKTREE"
  # -f: the monorepo's own .gitignore has a blanket "dist/" rule, which otherwise silently
  # drops the one thing this vendoring exists to commit -- found by cloning the result and
  # checking, not assumed. See git history on this file for the run that shipped without it.
  git add -f vendor package.json
  git commit -q -m "Vendor @navcom/core so this clone builds standalone

Not published or file:-linked, because this repo has no CI to keep a
published version current and every other consumer of @navcom/core in
the source monorepo tracks it directly rather than by semver. Rebuilt
fresh from source and re-vendored on every refresh instead."
)

echo "==> Pushing to the mirror (force -- history is unrelated by design, see README)"
git push git@github.com:Jthora/navcom-watchtower.git watchtower-mirror:main --force

git worktree remove "$WORKTREE" --force
git branch -D watchtower-mirror >/dev/null

echo "==> Done. Verify with: git clone https://github.com/Jthora/navcom-watchtower.git /tmp/mirror-check && cd /tmp/mirror-check && npm install && npm run verify"
