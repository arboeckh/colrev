#!/usr/bin/env bash
# Build the Python bundle (python-build-standalone), then build and package
# the Electron app.
#
# Usage:
#   scripts/build_and_package.sh                            # auto-detect, signed
#   scripts/build_and_package.sh mac
#   scripts/build_and_package.sh mac unsigned               # skip codesigning
#   scripts/build_and_package.sh mac signed --skip-bundle   # reuse existing bundle
#   scripts/build_and_package.sh "" unsigned --skip-bundle
#
# Positional args may be omitted with "" to fall through to defaults.
# Supported flags (any order after positionals): --skip-bundle

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PLATFORM=""
MODE="signed"
SKIP_BUNDLE=0

POSITIONALS=()
for arg in "$@"; do
    case "$arg" in
        --skip-bundle|--skip-jsonrpc) SKIP_BUNDLE=1 ;;
        --*)
            echo "Unknown flag '$arg'." >&2
            exit 1
            ;;
        *) POSITIONALS+=("$arg") ;;
    esac
done

PLATFORM="${POSITIONALS[0]:-}"
MODE="${POSITIONALS[1]:-signed}"

if [[ -z "$PLATFORM" ]]; then
    case "$(uname -s)" in
        Darwin) PLATFORM="mac" ;;
        Linux)  PLATFORM="linux" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
        *)
            echo "Could not detect platform. Pass 'mac', 'win', or 'linux' as an argument." >&2
            exit 1
            ;;
    esac
fi

case "$PLATFORM" in
    mac|win|linux) ;;
    *)
        echo "Unknown platform '$PLATFORM'. Use 'mac', 'win', or 'linux'." >&2
        exit 1
        ;;
esac

case "$MODE" in
    signed|unsigned) ;;
    *)
        echo "Unknown mode '$MODE'. Use 'signed' or 'unsigned'." >&2
        exit 1
        ;;
esac

if [[ "$MODE" == "unsigned" ]]; then
    PACKAGE_SCRIPT="package:${PLATFORM}:unsigned"
else
    PACKAGE_SCRIPT="package:${PLATFORM}"
fi

if ! command -v pnpm >/dev/null 2>&1; then
    echo "Error: pnpm is not installed. Install it from https://pnpm.io/installation" >&2
    exit 1
fi

# Map electron-builder platform → bundle target
case "$PLATFORM" in
    mac)   BUNDLE_PLATFORM="mac-arm64"; BUNDLE_DIR="$REPO_ROOT/electron-app/resources/python-mac-arm64" ;;
    win)   BUNDLE_PLATFORM="win-x64"; BUNDLE_DIR="$REPO_ROOT/electron-app/resources/python-win-x64" ;;
    linux) BUNDLE_PLATFORM=""; BUNDLE_DIR="" ;;
esac

echo "================================================"
if [[ "$PLATFORM" == "linux" ]]; then
    echo "Step 1/3: Linux bundling not implemented (deferred)" >&2
    exit 1
fi

if [[ "$SKIP_BUNDLE" == "1" ]]; then
    if [[ ! -d "$BUNDLE_DIR" ]]; then
        echo "Step 1/3: --skip-bundle passed but $BUNDLE_DIR not found" >&2
        echo "Run without --skip-bundle first to build it." >&2
        exit 1
    fi
    echo "Step 1/3: Skipping Python bundle build (reusing $BUNDLE_DIR)"
else
    echo "Step 1/3: Building Python bundle ($BUNDLE_PLATFORM)"
fi
echo "================================================"
if [[ "$SKIP_BUNDLE" != "1" ]]; then
    bash "$REPO_ROOT/scripts/build_python_bundle.sh" --platform "$BUNDLE_PLATFORM"
fi

echo ""
echo "================================================"
echo "Step 2/3: Building Electron app ($PLATFORM, $MODE)"
echo "================================================"
cd "$REPO_ROOT/electron-app"
pnpm install
pnpm run build

echo ""
echo "================================================"
echo "Step 3/3: Packaging Electron app ($PLATFORM, $MODE)"
echo "================================================"
if [[ "$MODE" == "unsigned" ]]; then
    export CSC_IDENTITY_AUTO_DISCOVERY=false
fi
pnpm run "$PACKAGE_SCRIPT"

echo ""
echo "================================================"
echo "Done. Artifacts:"
echo "  Python bundle:    $BUNDLE_DIR"
echo "  Electron package: $REPO_ROOT/electron-app/dist/"
echo "================================================"
