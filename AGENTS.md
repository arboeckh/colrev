# AGENTS.md

`CLAUDE.md` holds this repo's rules (what code may be edited, how to launch the app); they apply here too.

## Setup

Python lives in the venv at `.venv` (colrev and its internal packages, installed editable).
Activate it first, so that `python`, `pytest` and `colrev-jsonrpc` resolve to it, also for the
Electron app, which spawns the backend from `PATH`: `source .venv/bin/activate`.
The Electron app is in `electron-app/`, installed with `pnpm`.

## Before a pull request

Run `scripts/check.sh` and fix what it finds: the Electron typecheck and unit tests
(`pnpm typecheck`, `pnpm test`, `pnpm gen-types:check` in `electron-app/`), then the JSON-RPC layer's Python tests
(`tests/4_jsonrpc`, `tests/ui_jsonrpc`). The Python part takes about ten minutes.

When a change touches the RPC models, regenerate the types (`pnpm gen-types:full` in
`electron-app/`) and commit them. When it touches the UI flow, also run the e2e suite:
`pnpm build && COLREV_BACKGROUND=1 xvfb-run pnpm test:e2e` in `electron-app/`, with the venv active.

## Previews

`agentixxx preview` runs `scripts/agentixxx/preview.sh`: the Electron app's dev server
(`electron-vite dev --watch`) with the main process headless, and the preview's link opens the
renderer in the viewer's own browser, which reaches the main process over the web bridge
(`electron-app/src/main/web-bridge.ts`, browser side `src/renderer/lib/web-bridge.ts`). It
talks to real GitHub, as the desktop app does: the viewer signs in on the login page with
GitHub's device flow, and cloning, pushing, releases and invitations act on that real account.
Renderer changes hot-reload; a change to the main process or the preload restarts the app. A
new preload API needs its twin in `lib/web-bridge.ts`, or it is missing in previews. The
bridge never serves the GitHub token (`MAIN_PROCESS_ONLY` in `web-bridge.ts`). For checks of
your own, use the e2e suite and its fake GitHub (`COLREV_FAKE_GITHUB_REGISTRY`), not the
preview: it would need a person's GitHub sign-in.

## Never

- Edit generated files (`electron-app/src/renderer/types/generated/`): change the Python models and regenerate.
- Commit a secret or a `.env` file.
- Force-push, or push to `main` directly.

## Workflow

The workflow for Linear issues (merging, branches, deploys, when to ask a person, how issues are
filed) is in the `workflow` keys of `agentixxx.yml`, with the project owner's defaults, or else
agentixxx's, for the keys it leaves out; `.claude/skills/agentixxx-workflow` has agentixxx's. What this file says wins
where the two differ.
