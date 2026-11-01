#!/usr/bin/env bash
# Clones the committed tree into an empty directory and runs `npm ci && npm run check`
# there, so nothing untracked (node_modules, dist, .data, local files) can make it pass.
# Then fails if the check changed or left untracked any file that git does not ignore.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
REF="${1:-HEAD}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --quiet --no-local "$PWD" "$WORK/repo"
cd "$WORK/repo"
git checkout --quiet --detach "$(git -C "$OLDPWD" rev-parse "$REF")"
echo "clean clone of $(git rev-parse --short HEAD) in $WORK/repo"
npm ci --no-audit --no-fund
npm run check
if [[ -n "$(git status --porcelain)" ]]; then
  echo "npm run check left the tree dirty (commit or ignore these):" >&2
  git status --porcelain >&2
  exit 1
fi
echo "clean clone check passed"
