# Bundle dependencies

The packaged app (mac + Windows) ships a self-contained Python env built by
`build_python_bundle.sh`. Its dependencies come **only** from the committed
`requirements.txt`, which the bundle installs with `--no-deps`.

`requirements.txt` is compiled from two sources:

- `pyproject.toml` — colrev core deps.
- `scripts/bundle-extra-requirements.in` — extra deps needed by internal
  packages under `colrev/packages/*/`. These are **not** in the root pyproject,
  so without this file they never reach the bundle (cause of past
  `ModuleNotFoundError: No module named 'pyalex' / 'bs4'`).

## Adding a dependency

When the packaged app raises `ModuleNotFoundError: No module named 'X'`:

1. Add X's PyPI distribution name (e.g. `bs4` → `beautifulsoup4`) to
   `scripts/bundle-extra-requirements.in`.
2. Recompile and commit `requirements.txt`:
   ```bash
   uv pip compile --universal pyproject.toml scripts/bundle-extra-requirements.in -o requirements.txt
   ```
   (uv resolves transitive deps automatically.)
3. Rebuild: `pnpm run release:mac:unsigned` (or the win build).

Keep the `.in` list minimal — only what the app uses — to avoid bloating the
bundle.

## CI / Windows

The `electron-win-build` workflow does **not** run `uv pip compile`; it consumes
the committed `requirements.txt` and cross-installs it with
`--platform win_amd64 --only-binary=:all:`. So:

- Always commit the regenerated `requirements.txt` (it's the source of truth for
  both platforms).
- Any dep you add must have a `win_amd64` (or pure-Python `py3-none-any`) wheel,
  or the Windows cross-install fails. Verify with:
  ```bash
  pip download --no-deps --only-binary=:all: --platform win_amd64 \
      --python-version 3.12 -d /tmp/check <distribution>
  ```
