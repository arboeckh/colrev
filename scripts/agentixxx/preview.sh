#!/usr/bin/env bash
# The preview of a branch (agentixxx.yml, preview.command): the app in the viewer's own browser,
# on port 5173. The renderer's Vite dev server (`electron-vite dev`, with hot reload) serves the
# page to any host, and the page reaches the Electron main process, and through it the Python
# backend, over the web bridge (electron-app/src/main/web-bridge.ts) that Vite proxies at
# /__bridge. The browser draws the UI itself: no screen is streamed. Electron runs headless
# (COLREV_HEADLESS, no window) on a virtual display, which it needs on Linux even without one.
# The app is signed in as a fake GitHub account (COLREV_FAKE_GITHUB_REGISTRY, as in the e2e
# suite), so it opens on its home page.
set -euo pipefail
cd "$(dirname "$0")/../.."
export VIRTUAL_ENV="$PWD/.venv" PATH="$PWD/.venv/bin:$PATH"

state=/tmp/colrev-preview
user_data="$state/userData"
registry="$state/registry.json"
mkdir -p "$user_data"
# The seed of e2e/lib/seeders.ts (seedAccounts): with the fake registry the token is plain base64.
cat >"$registry" <<'EOF'
{"accounts": [{"login": "preview", "name": "Preview", "avatarUrl": "", "token": "preview-token"}],
 "repos": [], "collaborators": [], "invitations": [], "releases": []}
EOF
[ -f "$user_data/auth.json" ] || cat >"$user_data/auth.json" <<EOF
{"version": 2, "activeLogin": "preview",
 "accounts": [{"encryptedToken": "$(printf preview-token | base64)",
   "user": {"login": "preview", "name": "Preview", "avatarUrl": "", "email": "preview@test.local"},
   "authenticatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}]}
EOF

# Everything below goes down with this script, and this script with any of it.
trap 'trap - EXIT; kill 0' EXIT INT TERM

export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp &
for _ in $(seq 50); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done

# --watch rebuilds the main process and preload on a change and restarts Electron;
# renderer changes hot-reload in the browser. COLREV_WEB_BRIDGE_PORT also tells the Vite
# config (electron.vite.config.ts) to listen on all interfaces and proxy /__bridge there.
(cd electron-app && COLREV_FAKE_GITHUB_REGISTRY="$registry" COLREV_HEADLESS=1 \
  COLREV_WEB_BRIDGE_PORT=5180 \
  pnpm exec electron-vite dev --watch --noSandbox -- --user-data-dir="$user_data" --disable-gpu) &

wait -n
