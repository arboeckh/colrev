# Issue tracker: Linear

Issues for this repo live in Linear, team `boeckh`, project `ColRev`. GitHub Issues on
`arboeckh/colrev` are no longer used for planning: do not file or read work there.

agentixxx starts an unattended Claude Code run for each ready Linear issue. How issues are filed
and worked (epics and sub-issues, labels, statuses, merging, when to ask a person) is in
`AGENTS.md` and the `agentixxx-workflow` skill (`.claude/skills/agentixxx-workflow/`). Read that
skill before filing anything; this file only maps the generic engineering skills onto it.

Use the Linear MCP tools (`get_issue`, `list_issues`, `save_issue`, `save_comment`, …).

## When a skill says "publish to the issue tracker"

File a Linear issue in the `ColRev` project, shaped as the `agentixxx-workflow` skill says:

- A PRD (`to-prd`) is the description of an epic: a top-level issue labelled `Role: Agent`.
- Slices (`to-issues`) are sub-issues of that epic (`parentId`), not separate top-level issues.
  Set their order with Linear's blocked-by relation, and only where the order is real.
- Filing in Todo starts a run at once; file in Backlog to plan without starting anything.

## Labels

The skills' triage labels map onto Linear's `Role` label group:

| Skill's label | Linear |
|---|---|
| `ready-for-agent` | `Role: Agent` on the top-level issue or epic; its sub-issues need none |
| `ready-for-human` | `Role: Human`: a step only a person can do, a sibling of the work it belongs to |
| `needs-triage`, `needs-info`, `wontfix` | No label: leave the issue in Backlog, or cancel it |

The old GitHub labels (`PRD`, `ready-for-review`, `autonomous`, `HIL`) are not used.

## When a skill says "fetch the relevant ticket"

`get_issue` with its identifier (e.g. `BOE-123`), then `list_comments` for its comments.

## Skills that point to `/setup-matt-pocock-skills`

That skill wrote the GitHub version of this file and has been removed. This file and
`docs/agents/domain.md` are the configuration those skills ask for: edit them directly.
