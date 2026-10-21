---
name: agentixxx-workflow
description: How this repo's work is planned, filed and done through Linear and agentixxx, the dispatcher that starts an unattended Claude Code run for each ready issue. Use before planning or filing Linear issues for this repo (a feature as an epic with sub-issues, a follow-up, a person's step, a question) and before working one of its issues, so that what you file is picked up and done the way the repo's agentixxx.yml says.
---

# Work this repo's Linear issues the agentixxx way

agentixxx watches this repo's Linear project. For each issue that is ready, it starts a Claude
Code run on the issue's own branch, with `Work <ID>. Follow AGENTS.md.` Nobody watches that run
and nobody can answer in it: the issue, its comments and the repo are all it knows. So an issue
you file is a brief for a reader who has seen nothing of your session.

## 1. Read the repo's workflow

The workflow is in the `workflow` keys of `agentixxx.yml`, at the repo's root, as committed:
runs read it from git, never from a working tree. For issues you file, read it as it is on the
base branch, which their branches start from (`git show origin/main:agentixxx.yml`, with the
repo's base branch); for an issue you work, as it is on its branch.

| Key | Says |
|---|---|
| `workflow.issues` | How issues are filed: read it before you file any |
| `workflow.merge` | Whether and when the run merges its own pull request |
| `workflow.branches` | How branches are named and cut |
| `workflow.deploy` | What happens when a change has to go somewhere |
| `workflow.feedback` | When a run stops to ask a person, and the status it moves the issue to |
| `workflow.other` | Anything else |

`workflow.issues` says how to file. The others say how the work is done, so that an issue can
say what is expected of its run, and so that you do the same when you work one.

One more key, beside `workflow`, changes what a branch is cut from: with `branches.from: parent`
(read on the base branch), agentixxx cuts a sub-issue's branch from its parent issue's git
branch, making that one from the base branch when it is not there yet, and tells the run that
this is its base, the branch its pull request goes into. When you work such an issue yourself,
do the same: branch from the parent issue's branch, and open the pull request against it.
Without the key, or with `from: base`, every branch is cut from the base branch.

- **A key the file lacks** (or a repo without the file) means the project owner's default for
  it, where they saved one in agentixxx, or else agentixxx's:
  [`default-workflow.md`](default-workflow.md), next to this file. `workflow.other` has none.
  A run is told whichever applies; in a session of your own, follow agentixxx's unless the
  person says theirs differs.
- **A key set to `""`** means the repo says nothing on that part, whatever the owner saved.
- **`AGENTS.md` wins** where it says otherwise, as it does for the runs.
- `workflow.instructions` is advice for the runs themselves; you can leave it.

## 2. Know how agentixxx picks issues up

agentixxx reads two labels, set per project in its UI; the defaults' `Role: Agent` and
`Role: Human` are the usual ones, and `workflow.issues` names them if the repo differs.

- **The opt-in label switches work on.** A feature is a top-level epic that carries it; its
  sub-issues need no label of their own. Each issue is picked from its own status (Todo, or the
  project's pickable statuses), never the epic's: a child in Backlog waits until someone moves it
  to Todo. A feature of one issue is top-level, carries the label itself, and is picked from Todo.
- **The opt-out label keeps runs off** an issue and everything under it, even inside an opted-in
  epic: that is a person's step.
- **Only leaves run.** An issue with an open sub-issue gets no run, so a person's step is a
  sibling of the work it belongs to, never a child of it.
- **An open blocker holds an issue back.** Blocks / blocked by is the order runs follow, so add it
  only where the order is real.
- Runs start by priority, then age.

So **an issue filed in Todo under an opted-in epic starts at once**, before you file the next.
File them in the order they can start, set the blockers as you go, and write each one complete
before you file it. To plan without starting anything, file the children in Backlog and move
them to Todo when the tree is done, all at once or a few at a time.

## 3. File, or work

Before filing, look at the epic's children: what you mean to file may be there already. Then
follow `workflow.issues` (or its default) for the shape of each issue, and put in it what the
other sections leave to the issue: that a pull request should wait for review, that a deploy is
expected, whom to ask.

When you work an issue yourself, the same sections are what a run of it would follow: keep its
status true in Linear, and finish it as `workflow.merge` and `workflow.deploy` say.

This skill was installed by agentixxx's repo setup skill, which also updates it and its copy of
the defaults. The repo's workflow belongs in `agentixxx.yml` (or `AGENTS.md`), not here.
