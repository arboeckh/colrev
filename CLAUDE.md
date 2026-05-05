# CLAUDE.md

- Do not compliment me on my ideas. Don't say it is a sharp observation or "genuinely novel" and so on. Just say if it works or not and keep to the facts. I don't want compliments I want a system that works.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `arboeckh/colrev` (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Repo policy: `to-prd` and `to-issues` skip `needs-triage` and apply a state label directly. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
