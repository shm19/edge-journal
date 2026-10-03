#!/bin/sh
# One-time (per clone): point git at the versioned hooks in .githooks/.
set -eu
cd "$(dirname "$0")/.."
git rev-parse --git-dir >/dev/null
chmod +x .githooks/pre-commit .githooks/pre-push
git config core.hooksPath .githooks
echo "Git hooks installed (core.hooksPath=.githooks):"
echo "  pre-commit = lint + typecheck + unit tests     (about a minute)"
echo "  pre-push   = full check + build + e2e          (a few minutes)"
echo "Bypass once with: git commit --no-verify / git push --no-verify"
