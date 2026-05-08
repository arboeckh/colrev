---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices. Use when user wants to convert a plan into issues, create implementation tickets, or break down work into issues.
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes an issue reference (issue number, URL, or path) as an argument, fetch it from the issue tracker and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Publish the issues to the issue tracker

For each approved slice, publish a new issue. Use the issue body template below. These issues are considered ready for AFK agents, so publish them with the correct triage label unless instructed otherwise.

Publish issues in dependency order (blockers first) so the blocker exists when you wire up the relationship.

**Use GitHub's native relationships, not prose mentions.** Do NOT write `## Parent` or `## Blocked by` sections in the body — those go stale and duplicate what GitHub now tracks first-class. Instead, after creating each issue, attach it via the GraphQL API:

- **Sub-issue (parent → child):** if the source was an existing parent issue, attach every published slice as a sub-issue of it.

  ```bash
  gh api graphql -f query='mutation { addSubIssue(input: {issueId: "<PARENT_NODE_ID>", subIssueId: "<CHILD_NODE_ID>"}) { subIssue { number } } }'
  ```

- **Blocked-by (dependency between slices):** for each slice with prerequisites, link each blocker.

  ```bash
  gh api graphql -f query='mutation { addBlockedBy(input: {issueId: "<BLOCKED_NODE_ID>", blockingIssueId: "<BLOCKER_NODE_ID>"}) { issue { number } } }'
  ```

Get node IDs with `gh api graphql -f query='query { repository(owner:"OWNER", name:"REPO") { issue(number: N) { id } } }'`. The CLI's `gh issue create` returns only a URL, not the node ID, so fetch IDs in a separate step after creation.

If the host is not GitHub or the host's GraphQL API does not support these mutations, fall back to prose `## Parent` / `## Blocked by` sections — but on GitHub, always prefer the native relationships.

<issue-template>
## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

Avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it here and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

</issue-template>

Do NOT close or modify any parent issue beyond attaching sub-issues to it.
