#!/usr/bin/env bash
# Build a self-contained Python bundle for the CoLRev JSON-RPC server using
# python-build-standalone, replacing the previous PyInstaller machinery.
#
# Usage:
#   scripts/build_python_bundle.sh                          # build both platforms
#   scripts/build_python_bundle.sh --platform mac-arm64
#   scripts/build_python_bundle.sh --platform win-x64
#   scripts/build_python_bundle.sh --platform both
#
# Output:
#   electron-app/resources/python-mac-arm64/   (mac arm64 bundle)
#   electron-app/resources/python-win-x64/     (windows x64 bundle)
#
# Cache:
#   ~/.cache/colrev-build/tarballs/   python-build-standalone tarballs
#   ~/.cache/colrev-build/wheels/     built colrev / internal-package wheels
#
# Requirements (host):
#   - Python 3.12 with `build` and `pip` available (e.g. conda env `colrev`).
#   - `curl` for downloads.
#   - macOS: `codesign` (built-in).

set -euo pipefail

# ---- Configuration ---------------------------------------------------------

PYTHON_VERSION="3.12.7"
PBS_RELEASE="20241016"  # python-build-standalone release tag (date)

# Tarball asset filenames for the install_only flavour
PBS_MAC_ARM64_FILE="cpython-${PYTHON_VERSION}+${PBS_RELEASE}-aarch64-apple-darwin-install_only.tar.gz"
PBS_WIN_X64_FILE="cpython-${PYTHON_VERSION}+${PBS_RELEASE}-x86_64-pc-windows-msvc-install_only.tar.gz"

PBS_BASE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}"

# Resolve repo root from script location
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="${REPO_ROOT}/electron-app/resources"
CACHE_DIR="${COLREV_BUILD_CACHE:-$HOME/.cache/colrev-build}"
TARBALL_CACHE="${CACHE_DIR}/tarballs"
WHEEL_CACHE="${CACHE_DIR}/wheels"

# Host Python — used for `python -m build` and (for cross-install to Windows)
# for `pip install --platform win_amd64`.
HOST_PYTHON="${HOST_PYTHON:-python3.12}"

# ---- Args ------------------------------------------------------------------

PLATFORM="both"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --platform=*)
            PLATFORM="${1#--platform=}"
            shift
            ;;
        *)
            echo "Unknown argument: $1" >&2
            echo "Usage: $0 [--platform mac-arm64|win-x64|both]" >&2
            exit 1
            ;;
    esac
done

case "$PLATFORM" in
    mac-arm64|win-x64|both) ;;
    *)
        echo "Invalid --platform: $PLATFORM (use mac-arm64, win-x64, or both)" >&2
        exit 1
        ;;
esac

# ---- Helpers ---------------------------------------------------------------

log() {
    printf '\033[1;34m[bundle]\033[0m %s\n' "$*"
}

err() {
    printf '\033[1;31m[bundle:error]\033[0m %s\n' "$*" >&2
}

ensure_host_python() {
    if ! command -v "$HOST_PYTHON" >/dev/null 2>&1; then
        err "Host Python '$HOST_PYTHON' not found on PATH."
        err "Either activate the conda colrev env, or set HOST_PYTHON=/path/to/python3.12."
        exit 1
    fi
    local actual_version
    actual_version=$("$HOST_PYTHON" -c 'import sys; print("%d.%d" % sys.version_info[:2])')
    if [[ "$actual_version" != "3.12" ]]; then
        err "Host Python is $actual_version; need 3.12. Set HOST_PYTHON to a 3.12 interpreter."
        exit 1
    fi
}

ensure_host_build() {
    # Check from /tmp so a stray ./build/ directory in the repo root doesn't
    # shadow the real `build` package (left over from old PyInstaller runs).
    if ! ( cd /tmp && "$HOST_PYTHON" -m build --version >/dev/null 2>&1 ); then
        log "Installing 'build' package into host python..."
        "$HOST_PYTHON" -m pip install --quiet --upgrade build
    fi
}

download_tarball() {
    local filename="$1"
    local dest="${TARBALL_CACHE}/${filename}"
    mkdir -p "$TARBALL_CACHE"
    if [[ -f "$dest" ]]; then
        log "Tarball cached: $filename"
        return
    fi
    local url="${PBS_BASE_URL}/${filename}"
    log "Downloading $filename ..."
    curl --fail --location --progress-bar -o "${dest}.tmp" "$url"
    mv "${dest}.tmp" "$dest"
}

extract_bundle() {
    local tarball="$1"
    local dest_dir="$2"
    log "Extracting $(basename "$tarball") into $dest_dir"
    rm -rf "$dest_dir"
    mkdir -p "$dest_dir"
    # python-build-standalone tarballs root at `python/` — strip it so the
    # bundle contents land directly in dest_dir.
    tar -xzf "$tarball" -C "$dest_dir" --strip-components=1
}

build_wheels() {
    log "Building colrev wheel..."
    mkdir -p "$WHEEL_CACHE"
    ( cd "$REPO_ROOT" && "$HOST_PYTHON" -m build --wheel --outdir "$WHEEL_CACHE" >/dev/null )

    log "Building internal-package wheels..."
    local pkg_dir
    for pkg_dir in "$REPO_ROOT"/colrev/packages/*/; do
        [[ -f "${pkg_dir}pyproject.toml" ]] || continue
        local pkg_name
        pkg_name=$("$HOST_PYTHON" - "$pkg_dir" <<'PY'
import sys, tomllib
with open(sys.argv[1] + "pyproject.toml", "rb") as f:
    print(tomllib.load(f)["project"]["name"])
PY
)
        # Skip rebuild if a wheel for this version is already cached.
        if compgen -G "${WHEEL_CACHE}/${pkg_name//./_}-*.whl" >/dev/null; then
            continue
        fi
        ( cd "$pkg_dir" && "$HOST_PYTHON" -m build --wheel --outdir "$WHEEL_CACHE" >/dev/null )
    done
}

install_into_mac_bundle() {
    local bundle="$1"
    local site_packages="${bundle}/lib/python${PYTHON_VERSION%.*}/site-packages"
    local bundle_python="${bundle}/bin/python${PYTHON_VERSION%.*}"

    chmod +x "$bundle_python" || true

    log "Installing requirements.txt into mac bundle..."
    "$bundle_python" -m pip install \
        --no-deps \
        --target "$site_packages" \
        --upgrade \
        -r "$REPO_ROOT/requirements.txt"

    log "Installing colrev + internal wheels into mac bundle..."
    # shellcheck disable=SC2046
    "$bundle_python" -m pip install \
        --no-deps \
        --target "$site_packages" \
        --upgrade \
        $(ls "$WHEEL_CACHE"/*.whl)
}

install_into_win_bundle() {
    local bundle="$1"
    # Windows python-build-standalone layout: <bundle>/Lib/site-packages
    local site_packages="${bundle}/Lib/site-packages"

    log "Cross-installing requirements.txt into windows bundle..."
    "$HOST_PYTHON" -m pip install \
        --no-deps \
        --target "$site_packages" \
        --upgrade \
        --platform win_amd64 \
        --python-version "${PYTHON_VERSION%.*}" \
        --only-binary=:all: \
        -r "$REPO_ROOT/requirements.txt"

    log "Cross-installing colrev + internal wheels into windows bundle..."
    # shellcheck disable=SC2046
    "$HOST_PYTHON" -m pip install \
        --no-deps \
        --target "$site_packages" \
        --upgrade \
        --platform win_amd64 \
        --python-version "${PYTHON_VERSION%.*}" \
        --only-binary=:all: \
        $(ls "$WHEEL_CACHE"/*.whl)
}

# Generate a Mac/Linux shim from a console_scripts entry.
# Args: bundle_dir, script_name, module:func
#
# The body is guarded with `if __name__ == "__main__":` so that when
# multiprocessing.Pool() spawns a worker, the worker (which re-imports the
# parent's main script under `__mp_main__`, not `__main__`) does NOT re-run
# `main()`. Without this guard, every `multiprocessing.Pool()` call inside
# colrev (e.g. bib_dedupe.block) deadlocks: each worker re-runs the
# colrev-jsonrpc server, blocking on stdin instead of executing the pickled
# task.
write_mac_shim() {
    local bundle="$1"
    local name="$2"
    local target="$3"
    local module="${target%%:*}"
    local func="${target##*:}"
    local out="${bundle}/bin/${name}"
    cat >"$out" <<EOF
#!${bundle}/bin/python${PYTHON_VERSION%.*}
import sys
from ${module} import ${func}
if __name__ == "__main__":
    sys.exit(${func}())
EOF
    chmod +x "$out"
}

# Generate a Windows .cmd shim from a console_scripts entry.
#
# The Windows shim invokes `python.exe -c "..."`, which means the parent
# process has no `__main__.__file__` for multiprocessing.spawn to point a
# worker at — the spawn child runs `python.exe -c "spawn_main(...)"` and
# never re-executes this -c snippet. So unlike the mac shim, no
# __name__-guard is needed here.
write_win_shim() {
    local bundle="$1"
    local name="$2"
    local target="$3"
    local module="${target%%:*}"
    local func="${target##*:}"
    local scripts_dir="${bundle}/Scripts"
    mkdir -p "$scripts_dir"
    local out="${scripts_dir}/${name}.cmd"
    cat >"$out" <<EOF
@echo off
"%~dp0..\\python.exe" -c "import sys; from ${module} import ${func}; sys.exit(${func}())" %*
EOF
}

# Walk every dist-info/entry_points.txt and emit shims for [console_scripts].
generate_shims() {
    local bundle="$1"
    local platform="$2"
    local site_packages
    if [[ "$platform" == "mac-arm64" ]]; then
        site_packages="${bundle}/lib/python${PYTHON_VERSION%.*}/site-packages"
    else
        site_packages="${bundle}/Lib/site-packages"
    fi

    log "Generating console-script shims (${platform})..."

    "$HOST_PYTHON" - "$site_packages" >"${CACHE_DIR}/entry_points.txt" <<'PY'
import sys
from pathlib import Path
import configparser

site = Path(sys.argv[1])
for ep_file in site.glob("*.dist-info/entry_points.txt"):
    cp = configparser.ConfigParser()
    try:
        cp.read(ep_file, encoding="utf-8")
    except Exception:
        continue
    if not cp.has_section("console_scripts"):
        continue
    for name, target in cp.items("console_scripts"):
        target = target.replace(" ", "")
        # Skip entries that don't follow module:func (e.g. attrs)
        if ":" not in target:
            continue
        print(f"{name}\t{target}")
PY

    while IFS=$'\t' read -r name target; do
        [[ -n "$name" ]] || continue
        if [[ "$platform" == "mac-arm64" ]]; then
            write_mac_shim "$bundle" "$name" "$target"
        else
            write_win_shim "$bundle" "$name" "$target"
        fi
    done <"${CACHE_DIR}/entry_points.txt"
}

codesign_mac_bundle() {
    local bundle="$1"
    if ! command -v codesign >/dev/null 2>&1; then
        log "codesign not available; skipping (mac bundle will not load on Apple Silicon)."
        return
    fi
    log "Ad-hoc codesigning Mach-O binaries in mac bundle..."
    # python-build-standalone and pip-installed wheels ship linker-signed
    # ad-hoc signatures, so this is mostly a no-op; we re-sign defensively
    # in case any third-party wheel ships a publisher signature that fails
    # to re-validate after relocation.
    find "$bundle" \( -name "*.dylib" -o -name "*.so" -o -name "python3.12" -o -name "python3" \) -type f -print0 \
        | xargs -0 -I{} codesign --force --sign - {} >/dev/null 2>&1 || true
}

smoke_test_mac() {
    local bundle="$1"
    log "Smoke test: ${bundle}/bin/colrev-jsonrpc --help"
    if "${bundle}/bin/colrev-jsonrpc" --help >/dev/null 2>&1; then
        log "Smoke test passed."
    else
        err "Smoke test failed: colrev-jsonrpc --help did not exit 0."
        "${bundle}/bin/colrev-jsonrpc" --help || true
        exit 1
    fi
}

# ---- Per-platform builds ---------------------------------------------------

build_mac_arm64() {
    log "==== Building mac-arm64 bundle ===="
    download_tarball "$PBS_MAC_ARM64_FILE"
    local bundle="${RESOURCES_DIR}/python-mac-arm64"
    extract_bundle "${TARBALL_CACHE}/${PBS_MAC_ARM64_FILE}" "$bundle"
    install_into_mac_bundle "$bundle"
    generate_shims "$bundle" "mac-arm64"
    codesign_mac_bundle "$bundle"
    smoke_test_mac "$bundle"
    log "mac-arm64 bundle ready: $bundle"
}

build_win_x64() {
    log "==== Building win-x64 bundle ===="
    download_tarball "$PBS_WIN_X64_FILE"
    local bundle="${RESOURCES_DIR}/python-win-x64"
    extract_bundle "${TARBALL_CACHE}/${PBS_WIN_X64_FILE}" "$bundle"
    install_into_win_bundle "$bundle"
    generate_shims "$bundle" "win-x64"
    log "win-x64 bundle ready: $bundle (smoke test skipped on non-windows host)"
}

# ---- Main ------------------------------------------------------------------

ensure_host_python
ensure_host_build
mkdir -p "$RESOURCES_DIR" "$CACHE_DIR"

build_wheels

case "$PLATFORM" in
    mac-arm64) build_mac_arm64 ;;
    win-x64)   build_win_x64 ;;
    both)
        build_mac_arm64
        build_win_x64
        ;;
esac

log "Done."
