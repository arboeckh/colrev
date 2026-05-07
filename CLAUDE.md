# CLAUDE.md

- Do not compliment me on my ideas. Don't say it is a sharp observation or "genuinely novel" and so on. Just say if it works or not and keep to the facts. I don't want compliments I want a system that works.

Don't edit colrev package code, only the jsoon rpc layer or electron code. colrev core code should be treated like a package.

Use the playwright cli tool skill for ad hoc exploration if you need to get visibility

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `arboeckh/colrev` (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Issue workflow labels

This repo uses the global issue workflow defaults from `~/.agents/skills/issue-workflow-conventions/labels.md`: PRDs use `PRD` and may later get `ready-for-review`; implementation issues use exactly one of `autonomous` or `HIL`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
