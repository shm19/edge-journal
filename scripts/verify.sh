#!/bin/sh
# The full gate: lint, typecheck, unit tests with coverage thresholds, production build, then e2e (Playwright).
# On success for a CLEAN working tree it records the commit in .git/verified-<sha>, so the pre-push hook does not
# repeat the multi-minute run (and a push never sits on an idle GitHub connection while the tests run).
# Run it yourself before pushing:  npm run verify
HOOK_NAME=verify
. "$(dirname "$0")/../.githooks/lib.sh"

sha=$(git rev-parse HEAD)
marker="$(git rev-parse --git-dir)/verified-$sha"
if [ -f "$marker" ] && [ "${FORCE:-}" != 1 ]; then
  echo "verify: $(echo "$sha" | cut -c1-7) already passed the full gate, skipping (FORCE=1 to run again)"
  exit 0
fi

echo "verify: full check + e2e (a few minutes)"
step "check (lint, typecheck, coverage, build)" npm run check --silent
step "e2e (Playwright)" npm run e2e --silent
if [ -z "$(git status --porcelain)" ]; then
  touch "$marker"
  echo "verify: all green, $(echo "$sha" | cut -c1-7) recorded as verified"
else
  echo "verify: all green (working tree has uncommitted changes, so the commit is not recorded as verified)"
fi
