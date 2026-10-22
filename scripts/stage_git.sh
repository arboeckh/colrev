#!/usr/bin/env bash
# Stage dugite's embedded git for the *target* platform into
# electron-app/resources/git-<target>/, which electron-builder copies to
# resources/git (see build.<platform>.extraResources in package.json).
#
# dugite's postinstall downloads git for the build host, so packaging
# node_modules/dugite/git would ship macOS or Linux git in a Windows package
# built on those hosts. This reads the target's entry from dugite's
# embedded-git.json instead, so the bundled git matches the target and the
# dugite version in node_modules.
#
# Usage:
#   scripts/stage_git.sh win     # win32-x64
#   scripts/stage_git.sh mac     # darwin-arm64
#
# Requires electron-app/node_modules (run `pnpm install` first).
# Downloads are cached under ${COLREV_BUILD_CACHE:-~/.cache/colrev-build}/git.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/electron-app"

case "${1:-}" in
    win) TARGET="win32-x64" ;;
    mac) TARGET="darwin-arm64" ;;
    *)
        echo "Usage: $0 win|mac" >&2
        exit 1
        ;;
esac

EMBEDDED_JSON="$APP_DIR/node_modules/dugite/script/embedded-git.json"
if [[ ! -f "$EMBEDDED_JSON" ]]; then
    echo "Error: $EMBEDDED_JSON not found. Run 'pnpm install' in electron-app/ first." >&2
    exit 1
fi

# Relative path so that node on Windows does not have to resolve an MSYS path.
read_entry() {
    (cd "$APP_DIR" && node -p "require('./node_modules/dugite/script/embedded-git.json')['$TARGET'].$1")
}
URL="$(read_entry url)"
CHECKSUM="$(read_entry checksum)"
ARCHIVE_NAME="${URL##*/}"

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

DEST="$APP_DIR/resources/git-$TARGET"
MARKER="$APP_DIR/resources/git-$TARGET.sha256"

if [[ -d "$DEST" && -f "$MARKER" && "$(cat "$MARKER")" == "$CHECKSUM" ]]; then
    echo "git for $TARGET already staged at $DEST ($ARCHIVE_NAME)"
    exit 0
fi

CACHE_DIR="${COLREV_BUILD_CACHE:-$HOME/.cache/colrev-build}/git"
mkdir -p "$CACHE_DIR"
ARCHIVE="$CACHE_DIR/$ARCHIVE_NAME"

if [[ -f "$ARCHIVE" && "$(sha256_of "$ARCHIVE")" != "$CHECKSUM" ]]; then
    echo "Cached $ARCHIVE_NAME fails its checksum; downloading it again."
    rm -f "$ARCHIVE"
fi

if [[ ! -f "$ARCHIVE" ]]; then
    echo "Downloading $URL"
    curl -fsSL --retry 3 -o "$ARCHIVE.part" "$URL"
    ACTUAL="$(sha256_of "$ARCHIVE.part")"
    if [[ "$ACTUAL" != "$CHECKSUM" ]]; then
        rm -f "$ARCHIVE.part"
        echo "Error: checksum mismatch for $ARCHIVE_NAME: expected $CHECKSUM, got $ACTUAL" >&2
        exit 1
    fi
    mv "$ARCHIVE.part" "$ARCHIVE"
fi

echo "Extracting $ARCHIVE_NAME to $DEST"
rm -f "$MARKER"
rm -rf "$DEST"
mkdir -p "$DEST"
# From stdin: GNU tar takes "D:\..." (a Windows COLREV_BUILD_CACHE) for a remote host.
tar -xzf - -C "$DEST" < "$ARCHIVE"
echo "$CHECKSUM" > "$MARKER"
