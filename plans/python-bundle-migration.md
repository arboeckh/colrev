# PRD: Migrate Electron Backend Distribution from PyInstaller to python-build-standalone

## 1. Background

The Electron app spawns the CoLRev JSON-RPC server as a subprocess. Today that subprocess is a PyInstaller frozen bundle (`colrev_jsonrpc.spec` → `dist/colrev-jsonrpc/`). PyInstaller's static analysis loses against three patterns colrev relies on:

1. **`importlib.metadata.distributions()`** — used in `PackageManager.is_installed()` to discover installed colrev packages. PyInstaller copies module source but not `.dist-info/` directories, so this returns nothing in the frozen build.
2. **Module-level filesystem walks at import time** — e.g. `search_query/registry.py` calls `pathlib.iterdir()` on its subpackage directories during import. PyInstaller bundles `.py` files inside an archive by default, so the directories don't exist on disk.
3. **`subprocess.check_call(["pre-commit", ...])`** — pre-commit is bundled as a library but no `pre-commit` executable exists on PATH inside the frozen bundle.

These were worked around with an 87-line `_apply_pyinstaller_patches()` block in `colrev/ui_jsonrpc/server.py` that monkey-patches `subprocess.check_call`, `shutil.which`, `PackageManager.is_installed`, `PackageManager.install_project`, and `Package.__init__`. The patches encode hardcoded path conventions and CamelCase class-name guessing. Each colrev release has potential to break this silently.

CoLRev also distributes its own internal packages (~100+ folders under `colrev/packages/<name>/`, each with its own `pyproject.toml`). With `pip install colrev`, hatchling auto-discovery copies their source code but produces only a single `.dist-info` for `colrev` itself — the sub-packages are not registered as separate distributions. Without a patch, `is_installed("colrev.pubmed")` returns False and `install_project()` would attempt a runtime `pip install`, which would fail or hit PyPI for whatever was published there.

Net effect: every release ships a fragile bundle whose runtime behavior diverges from a normal Python install in five distinct places. New deps and colrev packages keep adding work.

## 2. Goal

Replace the PyInstaller bundle with a real Python interpreter (`python-build-standalone`) plus a real `pip install` into a real `site-packages/`. After this change the bundle is a normal Python install in every observable way: real `.dist-info` directories, real `bin/` console-script entry points, real source files at real paths, real stack traces. **All five monkey-patches go away.**

## 3. Non-goals

- Linux distribution. Deferred until needed.
- Real Apple Developer ID signing and notarization. Ad-hoc signing only for prototype.
- Reducing bundle size. Going from ~310 MB → ~525 MB per platform is acceptable.
- CI matrix builds. Cross-compile from the developer's Mac.
- Changing any dev-mode behavior beyond what's necessary. Conda env stays the dev environment.

## 4. Targets

- macOS arm64 (Apple Silicon)
- Windows x64

Both built from the developer's Mac via cross-platform pip resolution.

## 5. Core design decisions

### 5.1 Single Python version pinned to 3.12

`pyproject.toml` allows `>=3.10, <3.13`. The bundle pins to 3.12 exactly, matching the conda dev environment. Eliminates a whole class of "works in dev, breaks in package" bugs caused by minor-version differences.

### 5.2 Single universal lock file as source of truth

`requirements.txt` is regenerated with `uv pip compile --universal pyproject.toml -o requirements.txt`. Uses environment markers where versions diverge across platforms. Both the conda dev install and the bundle install resolve from this file — never from `pyproject.toml` ranges.

Upgrade workflow: bump versions in `pyproject.toml`, run the universal compile, reinstall both sides. No automatic drift.

### 5.3 Cross-compile both targets from the build host

Mac arm64 is native. Windows x64 uses pip's cross-platform resolution:

```
pip install -r requirements.txt \
    --target <bundle>/site-packages \
    --platform win_amd64 \
    --python-version 3.12 \
    --only-binary=:all:
```

Risk accepted: if any dep in `requirements.txt` ever lacks a Windows wheel at the locked version, the build fails. Mitigation is to pin to a wheel-publishing version. Acceptable for prototype velocity. If this becomes a pattern, add a Windows CI runner later.

### 5.4 Pre-install all colrev internal packages

Build script walks every `colrev/packages/*/pyproject.toml`, builds each as a wheel via `python -m build`, and pip-installs each into the bundle's `site-packages/`. After this step, real `.dist-info/` exists for `colrev.pubmed`, `colrev.crossref`, etc.

These are pure-Python hatchling packages, so the same wheel installs on both platforms — built once on Mac, installed into both bundles.

This is the load-bearing decision for "zero runtime patches." Without it, `PackageManager.is_installed()` returns False for sub-packages and `install_project()` would attempt runtime `pip install` calls.

### 5.5 Build-time entry-point script generation

`pip install --target <site-packages>` does not create console-script shims (`bin/<entry-point>`). The build script does this manually, post-install: walk every `*.dist-info/entry_points.txt`, write a small wrapper script per `[console_scripts]` entry into `<bundle>/bin/` (Mac) or `<bundle>/Scripts/` (Windows). Each shim is a 3–4 line `from <module> import <func>; sys.exit(<func>())` call.

After this step the bundle has all the entry points a normal install would: `colrev-jsonrpc`, `colrev`, `pre-commit`, `colrev-hooks-check`, `colrev-hooks-format`, `colrev-hooks-report`, `colrev-hooks-share`, `colrev-hooks-update`, plus any third-party scripts (`virtualenv`, `nodeenv`, etc.) needed by pre-commit's hook environments.

### 5.6 Bundle layout (per platform)

```
electron-app/resources/python-<platform>/
├── bin/                              (Scripts/ on Windows)
│   ├── python3.12                    from python-build-standalone
│   ├── pip3.12                       from python-build-standalone
│   ├── colrev-jsonrpc                generated shim
│   ├── pre-commit                    generated shim
│   └── colrev-hooks-*                generated shims
└── lib/python3.12/site-packages/
    ├── colrev/                       main package source
    ├── colrev-0.15.0.dist-info/      main distribution metadata
    ├── colrev.pubmed-0.1.0.dist-info/   internal package metadata
    ├── colrev.crossref-0.1.0.dist-info/
    ├── ... (one dist-info per internal package)
    ├── pandas/, requests/, ...       third-party deps
    └── ...
```

Bundles are gitignored. Built fresh by the build script. Tarballs and wheels cached at `~/.cache/colrev-build/`.

### 5.7 Ad-hoc Mac codesigning

macOS arm64 refuses to load unsigned Mach-O binaries. The build script ends with `codesign --force --sign - --deep --options runtime` over the Mac bundle. No Apple Developer account required. Apps still won't pass Gatekeeper for distribution (right-click → open, or `xattr -cr` to clear quarantine), but everything *runs* on dev machines and on testers handed a `.dmg`.

Windows: unsigned. SmartScreen warns; users proceed.

### 5.8 Clean cut migration

Single PR. Old PyInstaller machinery deleted. No transitional flag, no side-by-side mode. Acceptable because the app is pre-production.

### 5.9 Dev mode unchanged

`npm run dev` still spawns conda's Python directly against `colrev/ui_jsonrpc/server.py`. The conda env now installs from `requirements.txt` (single source of truth) for parity.

## 6. Code changes

### 6.1 Files deleted

- `colrev_jsonrpc.spec` — PyInstaller spec.
- `scripts/build_jsonrpc.sh` — PyInstaller build script.
- `main.py` — Redundant once the `colrev-jsonrpc` console-script shim exists. Dev mode switches to `python -m colrev.ui_jsonrpc.server`.
- The `_apply_pyinstaller_patches()` function and its single call site in `colrev/ui_jsonrpc/server.py`. Roughly 90 lines of monkey-patching code, all of it gone.
- `pyinstaller` from `pyproject.toml` `[project.optional-dependencies].dev`.

### 6.2 Files added

- `scripts/build_python_bundle.sh` — New build script (see §7 for the contract).
- `plans/python-bundle-migration.md` — This document.

### 6.3 Files modified

- **`requirements.txt`** — Regenerated with `uv pip compile --universal`. Will gain environment markers for any dep that resolves differently across platforms.

- **`scripts/build_and_package.sh`** — Calls `build_python_bundle.sh` instead of `build_jsonrpc.sh`. Per-platform argument forwarded so it builds only the targets it needs.

- **`electron-app/package.json`** — `extraResources` block. Today maps `resources/colrev-jsonrpc` → `colrev-jsonrpc`. Replaced with two platform-conditional entries:
  - macOS build: `resources/python-mac-arm64` → `python-mac-arm64`
  - Windows build: `resources/python-win-x64` → `python-win-x64`

- **`electron-app/src/main/index.ts`** — Backend path resolution. Today (line ~182–193) branches on `app.isPackaged`: dev runs `python main.py`, packaged runs `process.resourcesPath/colrev-jsonrpc/colrev-jsonrpc`. New:
  - Dev unchanged in spirit but invokes `python -m colrev.ui_jsonrpc.server` (no `main.py`).
  - Packaged points at `process.resourcesPath/python-<platform>/bin/colrev-jsonrpc` (or `Scripts\colrev-jsonrpc.exe` on Windows). The console-script shim is the spawn target — Electron does not need to know about Python.

- **`electron-app/src/main/colrev-backend.ts`** — Spawn `env` augmented to put `<bundle>/bin` (or `Scripts`) first on `PATH`. This is what makes `subprocess.check_call(["pre-commit", ...])` from inside colrev resolve to the bundle's pre-commit shim instead of a system one. Also keeps `GIT_*` env from `git-env.ts`.

- **`electron-app/src/main/git-env.ts`** — No functional change, but verify the env it returns layers cleanly with the new `PATH` prepending. The current dugite-derived `PATH` should remain after the bundle's `bin` directory.

- **`.gitignore`** — Add `electron-app/resources/python-mac-arm64/` and `electron-app/resources/python-win-x64/`.

- **`pyproject.toml`** — Remove `pyinstaller` from dev deps. Optionally tighten `requires-python = "==3.12.*"` for the bundle target (or leave as is and rely on the build script enforcing 3.12).

- **`CLAUDE.md`** — Update the "Building the Server" section. Remove PyInstaller references. Document `npm run release:mac` / `release:win` as the build entrypoints. Mention `~/.cache/colrev-build/` as the tarball/wheel cache.

### 6.4 Files NOT modified

The core CoLRev library remains read-only per the project's existing convention. Specifically, **none of the following change**:

- `colrev/package_manager/package_manager.py` — `is_installed()` and `install_project()` work correctly because §5.4 ensures every internal package has real `.dist-info`.
- `colrev/package_manager/colrev_internal_packages.py` — `get_internal_packages_dict()` works because the colrev source tree is on disk inside the bundle.
- `colrev/hooks/*` — Pre-commit hook entry points work because shims exist on `<bundle>/bin`.
- `search_query/registry.py` and similar import-time filesystem walks — work because all source is on disk as real files.

This is the test of whether the migration succeeds: if any of the above need touching, we've taken a wrong turn.

## 7. Build script contract (`scripts/build_python_bundle.sh`)

Idempotent, cache-aware. Inputs: target platform(s) — `mac-arm64`, `win-x64`, or both. Outputs: populated `electron-app/resources/python-<platform>/` directories ready for `electron-builder` to pick up.

Per platform, the script does, in order:

1. **Ensure tarball cached.** If `~/.cache/colrev-build/cpython-3.12.<x>-<platform>.tar.gz` is missing, download from the python-build-standalone GitHub releases. Verify checksum.

2. **Extract.** If the resources directory is missing or its contents predate the cached tarball, blow it away and re-extract.

3. **Bootstrap pip into the bundle.** python-build-standalone ships with `pip` already, but the binary needs to be invoked correctly per platform: native (`<bundle>/bin/python3.12 -m pip`) for Mac, host-pip (`<host-python> -m pip`) with `--target` and `--platform` flags for Windows cross-install.

4. **Build the colrev wheel.** From repo root: `python -m build --wheel --outdir ~/.cache/colrev-build/wheels/`.

5. **Build all internal-package wheels.** For each `colrev/packages/*/pyproject.toml`: `python -m build --wheel --outdir ~/.cache/colrev-build/wheels/`. Skip if a wheel for the same source hash already exists.

6. **Install everything into the bundle's `site-packages/`.** One pip command per platform:
   - Mac: `<bundle>/bin/python3.12 -m pip install --no-deps --target <bundle>/lib/python3.12/site-packages -r requirements.txt && ... colrev wheel ... internal-package wheels`
   - Win: same but with `--platform win_amd64 --python-version 3.12 --only-binary=:all:` and using the host pip.

   Why `--no-deps` for the bundle install: deps are already pinned in `requirements.txt`; we don't want pip's resolver second-guessing the lock.

7. **Generate console-script shims.** Walk `<bundle>/lib/python3.12/site-packages/*.dist-info/entry_points.txt`. For each `[console_scripts]` entry, write a wrapper script to `<bundle>/bin/<name>` (Mac) or `<bundle>/Scripts/<name>.exe` (Windows). Mac shims are `#!<bundle>/bin/python3.12` shebang scripts; Windows shims are tiny launcher exes (or `.cmd` shims pointing at the bundled python — simpler, sufficient for our case).

8. **Mac only: ad-hoc codesign the bundle.** `codesign --force --sign - --deep --options runtime <bundle>`.

9. **Sanity check.** Run `<bundle>/bin/colrev-jsonrpc --help` (Mac) and verify it exits 0 with expected output. Skip on Windows since we can't execute the win-x64 binary on a Mac host.

The script must support `--platform mac-arm64`, `--platform win-x64`, or `--platform both`. Default: both.

## 8. Migration risks and what to watch for

- **Cross-compiled Windows wheels.** First build will reveal any dep without a Windows wheel at its pinned version. Mitigation: pin to wheel-publishing release, document in `requirements.txt` rationale.

- **Pre-commit hook environments.** Pre-commit creates per-hook venvs in `~/.cache/pre-commit/` and inherits from `sys.executable`. With a real bundled Python that has working `pip` and `virtualenv`, this should work — but the first time the bundled colrev runs a git operation that triggers pre-commit, it will create those hook environments under the user's `~/.cache/`. Verify on a clean machine before considering the migration done.

- **Hardcoded path assumptions in colrev.** Some code may assume the colrev source is editable-installed or available at a specific path. With the bundle, source lives at `<bundle>/lib/python3.12/site-packages/colrev/`. `_get_colrev_path()` in `colrev_internal_packages.py:80–105` walks up looking for a `packages/` sibling — should still work because `colrev/packages/` is a subdirectory of the installed `colrev/`. Verify.

- **Bundled binary not executable.** After `tar -xzf` extraction, the executable bit may need to be re-applied to `<bundle>/bin/python3.12`. Build script does `chmod +x` on the relevant files defensively.

- **Codesigning gotchas.** Some embedded `.so` files in dependencies (`pymupdf`, `numpy`) ship with publisher signatures that fail re-validation when bundled. The `--force --deep` flags handle this in most cases. If a specific library refuses, the workaround is `codesign --remove-signature` first, then re-sign.

- **First cold start time.** Today the PyInstaller bundle takes 30–45s to start the first time macOS loads it (per the comment in `colrev-backend.ts:78`). The python-build-standalone bundle should be faster (no PyInstaller bootloader, no archive extraction), but actual cold-start time should be measured. If it's still slow, investigate whether `.pyc` precompilation at build time helps.

- **Entry-point shim correctness on Windows.** `.cmd` shims work for most cases but fail for any tool that introspects its own argv[0] expecting a `.exe`. If pre-commit or any colrev subprocess is one of those, fall back to generating real `.exe` launchers via `pip`'s wheel-installer code (which we'd vendor) or `setuptools.command.easy_install.get_script_args`-equivalent.

## 9. Acceptance criteria

- [ ] `npm run release:mac:unsigned` produces a working `.dmg`. Backend starts within 10s on a clean macOS arm64 machine. All happy-path JSON-RPC calls succeed.
- [ ] `npm run release:win:unsigned` produces a working portable `.exe`. Backend starts and serves JSON-RPC on a Windows 11 x64 test machine.
- [ ] `_apply_pyinstaller_patches()` does not exist anywhere in the codebase.
- [ ] Repo grep for `sys.frozen` and `_MEIPASS` returns zero hits.
- [ ] Adding a new package under `colrev/packages/foo/` and rebuilding produces a working bundle with `colrev.foo` available, with no edits to any spec/build/manifest file.
- [ ] Adding a new dep to `pyproject.toml`, regenerating `requirements.txt`, and rebuilding produces a working bundle, with no edits to any spec/build/manifest file.
- [ ] `requirements.txt` was generated with `--universal` and contains environment markers (verifiable: file contains `; sys_platform ==` or `; platform_system ==` for at least one entry, or all deps happen to be cross-platform-identical).
- [ ] Pre-commit runs successfully when invoked from inside the bundled backend (verify by triggering an operation that calls `subprocess.check_call(["pre-commit", "run"])` from within colrev).
- [ ] No file under `colrev/` (excluding `colrev/ui_jsonrpc/`) was modified by this PR.

## 10. Rollback

Single-PR migration. Rollback is a `git revert` of the merge. Because `requirements.txt` was regenerated as part of the change, the rollback also restores the old non-universal lock — verify the conda env still installs cleanly afterward, or rebuild it from `pyproject.toml` ranges.
