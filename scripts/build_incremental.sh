#!/usr/bin/env bash
# Incremental build orchestrator for the CoLRev Electron + Python app.
#
# Three stages, each cached on a content hash of its inputs:
#   1. python   - python-build-standalone bundle for the JSON-RPC server
#   2. vite     - electron-vite build of main / preload / renderer
#   3. package  - electron-builder packaging into release/<platform>/<app>
#
# A stage runs if its inputs hash changed OR its output is missing. Stage 3
# additionally re-runs whenever stage 1 or 2 ran. The cache lives at
# .build-cache/manifest.json (gitignored).
#
# Usage:
#   scripts/build_incremental.sh                  # auto-detect, unsigned
#   scripts/build_incremental.sh --signed         # code-signed build
#   scripts/build_incremental.sh --no-package     # stages 1-2 only
#   scripts/build_incremental.sh --force          # rebuild everything
#   scripts/build_incremental.sh --force-vite     # force one stage + downstream
#   scripts/build_incremental.sh --platform mac   # override auto-detect

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ----- args -----
PLATFORM=""
MODE="unsigned"
NO_PACKAGE=0
FORCE_ALL=0
FORCE_PYTHON=0
FORCE_VITE=0
FORCE_PACKAGE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --signed) MODE="signed"; shift ;;
        --unsigned) MODE="unsigned"; shift ;;
        --no-package) NO_PACKAGE=1; shift ;;
        --force) FORCE_ALL=1; shift ;;
        --force-python) FORCE_PYTHON=1; shift ;;
        --force-vite) FORCE_VITE=1; shift ;;
        --force-package) FORCE_PACKAGE=1; shift ;;
        --platform)
            PLATFORM="${2:-}"
            if [[ -z "$PLATFORM" ]]; then echo "--platform requires a value" >&2; exit 1; fi
            shift 2
            ;;
        -h|--help)
            sed -n '1,30p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$PLATFORM" ]]; then
    case "$(uname -s)" in
        Darwin) PLATFORM="mac" ;;
        Linux)  PLATFORM="linux" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
        *) echo "Could not detect platform; pass --platform mac|win|linux" >&2; exit 1 ;;
    esac
fi
case "$PLATFORM" in mac|win|linux) ;; *) echo "Unknown platform: $PLATFORM" >&2; exit 1 ;; esac

# ----- prereqs -----
if ! command -v pnpm >/dev/null 2>&1; then
    echo "Error: pnpm not found. https://pnpm.io/installation" >&2
    exit 1
fi
if ! command -v shasum >/dev/null 2>&1; then
    echo "Error: shasum not found (expected on macOS / coreutils)." >&2
    exit 1
fi

# ----- cache -----
CACHE_DIR="$REPO_ROOT/.build-cache"
CACHE_FILE="$CACHE_DIR/manifest.json"
mkdir -p "$CACHE_DIR"

read_cache() {
    # $1 = stage name. Reads the stored hash for that stage, or empty string.
    local key="$1"
    [[ -f "$CACHE_FILE" ]] || { echo ""; return; }
    # naive grep-based parse so we don't depend on jq
    grep -E "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$CACHE_FILE" 2>/dev/null \
        | head -n 1 \
        | sed -E "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/" \
        || true
}

write_cache() {
    # $1=python_hash $2=vite_hash $3=package_hash
    cat > "$CACHE_FILE" <<EOF
{
  "python": "$1",
  "vite": "$2",
  "package": "$3",
  "platform": "$PLATFORM",
  "mode": "$MODE",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

# ----- input hashing -----
# Hash regular files matching common source extensions under the given paths.
# Robust to file ordering (LC_ALL=C sort) and uses content sha256.
hash_inputs() {
    local out
    out=$(find "$@" \
        \( -name node_modules -o -name dist -o -name build -o -name release -o -name .build-cache -o -name .git \) -prune -false \
        -o -type f \( \
            -name '*.py' -o -name '*.spec' -o -name '*.ts' -o -name '*.tsx' \
            -o -name '*.js' -o -name '*.cjs' -o -name '*.mjs' -o -name '*.vue' \
            -o -name '*.css' -o -name '*.json' -o -name '*.html' -o -name '*.toml' \
            -o -name '*.yml' -o -name '*.yaml' -o -name '*.lock' \
        \) -print 2>/dev/null \
        | LC_ALL=C sort \
        | xargs shasum -a 256 2>/dev/null \
        | shasum -a 256 \
        | cut -d' ' -f1)
    echo "$out"
}

# Hash a slice of a JSON file (specifically: package.json's "build" object).
# We include the whole package.json because slicing without jq is brittle —
# this is fine since electron-builder cares about the whole file anyway.
hash_files() {
    local out
    out=$(LC_ALL=C ls -1 "$@" 2>/dev/null | LC_ALL=C sort | xargs shasum -a 256 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
    echo "$out"
}

# ----- inputs per stage -----
PYTHON_INPUTS=(
    "$REPO_ROOT/colrev"
    "$REPO_ROOT/pyproject.toml"
    "$REPO_ROOT/requirements.txt"
    "$REPO_ROOT/scripts/build_python_bundle.sh"
)

VITE_INPUTS=(
    "$REPO_ROOT/electron-app/src"
    "$REPO_ROOT/electron-app/index.html"
    "$REPO_ROOT/electron-app/electron.vite.config.ts"
    "$REPO_ROOT/electron-app/package.json"
    "$REPO_ROOT/electron-app/components.json"
)
# tsconfig variants — globbed in case some are absent
for f in "$REPO_ROOT/electron-app"/tsconfig*.json; do
    [[ -e "$f" ]] && VITE_INPUTS+=("$f")
done

# Package stage: electron-builder config (in package.json), the resources dir,
# plus we always re-pack when stage 1 or 2 ran (handled below).
PACKAGE_INPUTS=(
    "$REPO_ROOT/electron-app/package.json"
)
# resources/ may not exist on a fresh checkout before stage 1 runs
if [[ -d "$REPO_ROOT/electron-app/resources" ]]; then
    PACKAGE_INPUTS+=("$REPO_ROOT/electron-app/resources")
fi

# ----- output paths used to detect missing artifacts -----
case "$PLATFORM" in
    mac)
        BUNDLE_PLATFORM="mac-arm64"
        PYTHON_OUT="$REPO_ROOT/electron-app/resources/python-mac-arm64/bin/colrev-jsonrpc"
        ARCH="$(uname -m)"
        case "$ARCH" in
            arm64) MAC_DIR="mac-arm64" ;;
            x86_64) MAC_DIR="mac" ;;
            *) MAC_DIR="mac-arm64" ;;
        esac
        PACKAGE_OUT="$REPO_ROOT/electron-app/release/$MAC_DIR/ColRev.app"
        ;;
    win)
        BUNDLE_PLATFORM="win-x64"
        PYTHON_OUT="$REPO_ROOT/electron-app/resources/python-win-x64/Scripts/colrev-jsonrpc.cmd"
        PACKAGE_OUT="$REPO_ROOT/electron-app/release/win-unpacked"
        ;;
    linux)
        echo "Linux bundling not implemented." >&2
        exit 1
        ;;
esac
PYTHON_OUT_SYNCED="$PYTHON_OUT"  # bundle is built directly into resources/
VITE_OUT="$REPO_ROOT/electron-app/dist/main/index.js"

# ----- stage decision -----
if [[ "$FORCE_ALL" == "1" ]]; then
    FORCE_PYTHON=1
    FORCE_VITE=1
    FORCE_PACKAGE=1
fi

echo "Hashing inputs..."
PYTHON_HASH=$(hash_inputs "${PYTHON_INPUTS[@]}")
VITE_HASH=$(hash_inputs "${VITE_INPUTS[@]}")

CACHED_PYTHON=$(read_cache python)
CACHED_VITE=$(read_cache vite)
CACHED_PACKAGE=$(read_cache package)

need_python=0
need_vite=0
need_package=0

if [[ "$FORCE_PYTHON" == "1" ]] || [[ "$PYTHON_HASH" != "$CACHED_PYTHON" ]] \
   || [[ ! -e "$PYTHON_OUT" ]]; then
    need_python=1
fi

if [[ "$FORCE_VITE" == "1" ]] || [[ "$VITE_HASH" != "$CACHED_VITE" ]] \
   || [[ ! -f "$VITE_OUT" ]]; then
    need_vite=1
fi

# Compute package hash AFTER potentially syncing python output, so we
# defer that calc until later. For now, just check the input-side trigger.
PACKAGE_HASH_PRE=$(hash_inputs "${PACKAGE_INPUTS[@]}")

if [[ "$NO_PACKAGE" == "1" ]]; then
    : # never package
elif [[ "$FORCE_PACKAGE" == "1" ]] || [[ "$need_python" == "1" ]] || [[ "$need_vite" == "1" ]] \
     || [[ "$PACKAGE_HASH_PRE" != "$CACHED_PACKAGE" ]] \
     || [[ ! -e "$PACKAGE_OUT" ]]; then
    need_package=1
fi

# ----- run stages -----
START_TS=$(date +%s)
RAN=()

run_stage_python() {
    echo ""
    echo "================================================"
    echo "[1/3] python: BUILD ($BUNDLE_PLATFORM)"
    echo "================================================"
    bash "$REPO_ROOT/scripts/build_python_bundle.sh" --platform "$BUNDLE_PLATFORM"
    RAN+=("python")
}

run_stage_vite() {
    echo ""
    echo "================================================"
    echo "[2/3] vite: BUILD"
    echo "================================================"
    cd "$REPO_ROOT/electron-app"
    pnpm install
    pnpm run build
    cd "$REPO_ROOT"
    RAN+=("vite")
}

run_stage_package() {
    echo ""
    echo "================================================"
    echo "[3/3] package: BUILD ($PLATFORM, $MODE)"
    echo "================================================"
    cd "$REPO_ROOT/electron-app"
    if [[ "$MODE" == "unsigned" ]]; then
        export CSC_IDENTITY_AUTO_DISCOVERY=false
        pnpm run "package:${PLATFORM}:unsigned"
    else
        pnpm run "package:${PLATFORM}"
    fi
    cd "$REPO_ROOT"
    RAN+=("package")
}

if [[ "$need_python" == "1" ]]; then
    run_stage_python
else
    echo "[1/3] python: SKIP (cached)"
fi

if [[ "$need_vite" == "1" ]]; then
    run_stage_vite
else
    echo "[2/3] vite: SKIP (cached)"
fi

# Recompute package hash AFTER python sync, so resources/colrev-jsonrpc
# changes are folded into the cached fingerprint.
PACKAGE_HASH=$(hash_inputs "${PACKAGE_INPUTS[@]}")

if [[ "$NO_PACKAGE" == "1" ]]; then
    echo "[3/3] package: SKIP (--no-package)"
elif [[ "$need_package" == "1" ]]; then
    run_stage_package
else
    echo "[3/3] package: SKIP (cached)"
fi

# ----- update cache -----
# Use freshly-computed values; if a stage was skipped, retain the previous hash.
FINAL_PYTHON_HASH="$PYTHON_HASH"
FINAL_VITE_HASH="$VITE_HASH"
FINAL_PACKAGE_HASH="$PACKAGE_HASH"

# If --no-package and no prior package hash, keep empty so next run packages.
if [[ "$NO_PACKAGE" == "1" ]] && [[ "$need_package" != "1" ]]; then
    FINAL_PACKAGE_HASH="$CACHED_PACKAGE"
fi
# If --no-package, do not advance the package hash — packaging didn't run.
if [[ "$NO_PACKAGE" == "1" ]]; then
    FINAL_PACKAGE_HASH="$CACHED_PACKAGE"
fi

write_cache "$FINAL_PYTHON_HASH" "$FINAL_VITE_HASH" "$FINAL_PACKAGE_HASH"

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

echo ""
echo "================================================"
if [[ ${#RAN[@]} -eq 0 ]]; then
    echo "Done in ${ELAPSED}s. All stages cached."
else
    echo "Done in ${ELAPSED}s. Ran: ${RAN[*]}"
fi
if [[ "$NO_PACKAGE" != "1" ]]; then
    echo "App: $PACKAGE_OUT"
fi
echo "================================================"
