#!/usr/bin/env bash
# The check to run before a pull request: Electron typecheck, unit tests and RPC type drift,
# then the Python JSON-RPC layer's tests. Uses the venv at .venv when there is one.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -x .venv/bin/python ]; then
  export VIRTUAL_ENV="$PWD/.venv" PATH="$PWD/.venv/bin:$PATH"
fi

(cd electron-app && pnpm typecheck && pnpm test && pnpm gen-types:check)
pytest -p no:cacheprovider tests/4_jsonrpc tests/ui_jsonrpc "$@"
