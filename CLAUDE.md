# CLAUDE.md

- Do not compliment me on my ideas. Don't say it is a sharp observation or "genuinely novel" and so on. Just say if it works or not and keep to the facts. I don't want compliments I want a system that works.

Don't edit colrev package code, only the jsoon rpc layer or electron code. colrev core code should be treated like a package.

Use the playwright cli tool skill for ad hoc exploration if you need to get visibility

## Launching the app

Never launch the Electron app in a way that steals focus — the human is working
on this machine while you run. Always launch it in background mode:

- dev: `npm run dev:bg` (in `electron-app/`), or `COLREV_BACKGROUND=1 npm run dev`
- e2e/Playwright: prefix the command, e.g. `COLREV_BACKGROUND=1 npm run test:e2e`
- packaged `.app`: `open -g -a <path/to/ColRev.app>` (`-g` = do not bring to front)

`COLREV_BACKGROUND=1` shows the window without activating it and, on macOS, runs
the app as an accessory (no dock icon, not in Cmd-Tab). Screenshots and
Playwright driving work fine without focus.

When work on a branch is complete, always auto-open a PR from that branch targeting the branch it was branched from (its base branch) — commit, push, and `gh pr create` without asking.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `arboeckh/colrev` (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Issue workflow labels

This repo uses the global issue workflow defaults from `~/.agents/skills/issue-workflow-conventions/labels.md`: PRDs use `PRD` and may later get `ready-for-review`; implementation issues use exactly one of `autonomous` or `HIL`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
