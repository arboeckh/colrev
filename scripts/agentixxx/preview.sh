#!/usr/bin/env bash
# The preview of a branch (agentixxx.yml, preview.command): the Electron app's dev server
# (`electron-vite dev`, with hot reload) on a VNC display (TigerVNC's Xvnc), which the page
# preview/index.html shows through noVNC, on port 6080. The page asks the display to take the
# browser window's size, at twice its CSS pixels, and the app renders at that scale and fills
# the display (COLREV_FILL_SCREEN), so it lays out for the window and is sharp on a 2x screen. The renderer needs Electron's preload bridges and the Python backend, so
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

# Xvnc is the X server and the VNC server in one, and resizes when the page asks (SetDesktopSize).
# The size here is the display's until the page connects.
export DISPLAY=:99
Xvnc "$DISPLAY" -geometry 2400x1600 -depth 24 -SecurityTypes None -localhost -rfbport 5900 \
  -AlwaysShared -nolisten tcp -desktop ColRev &
for _ in $(seq 50); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done

# The page, with noVNC's modules beside it, as websockify serves them.
web="$state/web"
mkdir -p "$web"
ln -sfn "$PWD/scripts/agentixxx/preview/index.html" "$web/index.html"
ln -sfn /usr/share/novnc/core "$web/core"
ln -sfn /usr/share/novnc/vendor "$web/vendor"
websockify --web "$web" 0.0.0.0:6080 localhost:5900 &

# --watch rebuilds the main process and preload on a change and restarts Electron;
# renderer changes hot-reload.
# The VM has no GPU, and Chromium's emulated one loses its frames when the display resizes:
# --disable-gpu composites in software instead.
(cd electron-app && COLREV_FAKE_GITHUB_REGISTRY="$registry" COLREV_FILL_SCREEN=1 \
  pnpm exec electron-vite dev --watch --noSandbox -- --user-data-dir="$user_data" \
  --force-device-scale-factor=2 --disable-gpu) &

wait -n
