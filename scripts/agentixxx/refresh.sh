#!/usr/bin/env bash
# Builds the machine every agentixxx run starts from (agentixxx.yml, refresh.command).
# Runs as `agent` on the base branch, on the disk the refresh before it left: safe to rerun.
set -euo pipefail
cd "$(dirname "$0")/../.."

# The Python tests commit to throwaway git repos and need an identity.
git config --global user.name >/dev/null || git config --global user.name "agentixxx"
git config --global user.email >/dev/null || git config --global user.email "agentixxx@users.noreply.github.com"

# The preview (scripts/agentixxx/preview.sh) and the e2e suite: a virtual display, and noVNC
# to serve it as a web page.
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb x11vnc novnc websockify

# Python: colrev in a venv at .venv (requires-python <3.13; the image has 3.12),
# with its internal packages editable, so a branch's changes to them are live.
[ -x .venv/bin/python ] || uv venv --python 3.12 .venv
export VIRTUAL_ENV="$PWD/.venv" PATH="$PWD/.venv/bin:$PATH"
uv pip install --editable ".[dev]"
colrev install --uv --editable all_internal_packages

# Electron app (pnpm-lock.yaml is the lockfile the build scripts use).
(cd electron-app && CI=1 pnpm install --frozen-lockfile)
