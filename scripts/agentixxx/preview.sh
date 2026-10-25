#!/usr/bin/env bash
# The preview of a branch (agentixxx.yml, preview.command): the Electron app's dev server
# (`electron-vite dev`, with hot reload) on a virtual display, which noVNC serves as a web
# page on port 6080. The renderer needs Electron's preload bridges and the Python backend, so
# a bare Vite page in a browser would not run. The app is signed in as a fake GitHub account
# (COLREV_FAKE_GITHUB_REGISTRY, as in the e2e suite), so it opens on its home page.
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

# The size of the app's window: with no window manager it cannot maximize.
export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 1200x800x24 -nolisten tcp &
for _ in $(seq 50); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -quiet &
websockify --web /usr/share/novnc 0.0.0.0:6080 localhost:5900 &

# --watch rebuilds the main process and preload on a change and restarts Electron;
# renderer changes hot-reload.
(cd electron-app && COLREV_FAKE_GITHUB_REGISTRY="$registry" \
  pnpm exec electron-vite dev --watch --noSandbox -- --user-data-dir="$user_data") &

wait -n
