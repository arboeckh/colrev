#!/usr/bin/env bash
# Fail if regenerating left the committed RPC schema/types dirty — including
# NEW untracked files, which `git diff` alone cannot see.
set -euo pipefail
cd "$(dirname "$0")/.."

GENERATED_DIR="electron-app/src/renderer/types/generated"
status="$(git -C .. status --porcelain -- "$GENERATED_DIR")"
if [ -n "$status" ]; then
  echo "::error::$GENERATED_DIR is stale relative to the Python models."
  echo "Run 'npm run gen-types:full' in electron-app/ and commit the result."
  echo "$status"
  git -C .. --no-pager diff -- "$GENERATED_DIR" | head -100
  exit 1
fi
echo "Generated RPC schema and types are up to date."
