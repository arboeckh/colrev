#!/usr/bin/env bash
# Fail unless the git bundled in a packaged app is built for the target
# platform (see scripts/stage_git.sh for why it might not be).
#
# Usage:
#   scripts/check_packaged_git.sh win electron-app/release/win-unpacked/resources/git
#   scripts/check_packaged_git.sh mac electron-app/release/mac-arm64/ColRev.app/Contents/Resources/git

set -euo pipefail

PLATFORM="${1:-}"
GIT_DIR="${2:-}"

case "$PLATFORM" in
    win) GIT_BIN="$GIT_DIR/cmd/git.exe" ;;
    mac) GIT_BIN="$GIT_DIR/bin/git" ;;
    *)
        echo "Usage: $0 win|mac <packaged git dir>" >&2
        exit 1
        ;;
esac

if [[ ! -f "$GIT_BIN" ]]; then
    echo "Error: the package has no $GIT_BIN, so its bundled git is not for $PLATFORM." >&2
    exit 1
fi

MAGIC="$(od -An -tx1 -N4 "$GIT_BIN" | tr -d ' \n')"
case "$PLATFORM:$MAGIC" in
    win:4d5a*) ;;                                   # MZ (PE)
    mac:cffaedfe|mac:cefaedfe|mac:cafebabe) ;;      # Mach-O 64/32, universal
    *)
        echo "Error: $GIT_BIN is not a $PLATFORM executable (magic $MAGIC)." >&2
        exit 1
        ;;
esac
echo "Bundled git is for $PLATFORM: $GIT_BIN"
