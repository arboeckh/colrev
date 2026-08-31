#!/usr/bin/env bash
# Package the app (unsigned) and run the Playwright smoke suite against the
# ACTUAL packaged binary — bundled python, bundled git, asar'd app code.
#
# Usage:
#   scripts/smoketest.sh                     # auto-detect platform, full build
#   scripts/smoketest.sh mac                 # explicit platform
#   scripts/smoketest.sh mac --skip-bundle   # reuse existing python bundle
#   scripts/smoketest.sh mac --skip-package  # reuse existing release/ build
#   scripts/smoketest.sh mac --suite e2e     # run the FULL e2e suite packaged
#
# Environment:
#   HOST_PYTHON   3.12 interpreter used to build wheels for the python bundle
#                 (defaults to python3.12; use the conda colrev env if the
#                 system python is PEP-668 managed).
#   COLREV_PACKAGED_APP  override the binary the tests launch.
#
# Exit code is the Playwright exit code, so this is CI-safe.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PLATFORM=""
SKIP_PACKAGE=0
SKIP_BUNDLE_FLAG=""
SUITE="smoke"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-package) SKIP_PACKAGE=1; shift ;;
        --skip-bundle)  SKIP_BUNDLE_FLAG="--skip-bundle"; shift ;;
        --suite)        SUITE="$2"; shift 2 ;;
        --suite=*)      SUITE="${1#--suite=}"; shift ;;
        --*)
            echo "Unknown flag '$1'." >&2
            exit 1
            ;;
        *)
            if [[ -n "$PLATFORM" ]]; then
                echo "Unexpected argument '$1'." >&2
                exit 1
            fi
            PLATFORM="$1"; shift
            ;;
    esac
done

if [[ -z "$PLATFORM" ]]; then
    case "$(uname -s)" in
        Darwin) PLATFORM="mac" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
        Linux)  PLATFORM="linux" ;;
        *)
            echo "Could not detect platform. Pass 'mac' or 'win'." >&2
            exit 1
            ;;
    esac
fi

case "$SUITE" in
    smoke|e2e) ;;
    *)
        echo "Unknown suite '$SUITE'. Use 'smoke' or 'e2e'." >&2
        exit 1
        ;;
esac

if [[ "$SKIP_PACKAGE" == "1" ]]; then
    echo "================================================"
    echo "Smoketest: reusing existing packaged build"
    echo "================================================"
else
    echo "================================================"
    echo "Smoketest step 1/2: package unsigned ($PLATFORM)"
    echo "================================================"
    bash "$REPO_ROOT/scripts/build_and_package.sh" "$PLATFORM" unsigned $SKIP_BUNDLE_FLAG
fi

echo ""
echo "================================================"
echo "Smoketest step 2/2: run '$SUITE' suite (packaged)"
echo "================================================"
cd "$REPO_ROOT/electron-app"
COLREV_TEST_MODE=packaged npx playwright test --project="$SUITE"
