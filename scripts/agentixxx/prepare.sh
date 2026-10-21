#!/usr/bin/env bash
# What depends on the branch (agentixxx.yml, run.prepare): its Python and Node dependencies.
set -euo pipefail
cd "$(dirname "$0")/../.."
export VIRTUAL_ENV="$PWD/.venv" PATH="$PWD/.venv/bin:$PATH"
uv pip install --editable ".[dev]"
(cd electron-app && CI=1 pnpm install --frozen-lockfile)
