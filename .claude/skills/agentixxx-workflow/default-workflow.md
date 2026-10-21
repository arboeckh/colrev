# agentixxx's default workflow sections

What a run of the repo gets in its system prompt, under each heading, when the repo's
`agentixxx.yml` lacks the key and its project owner saved no default of their own for it
(`workflow.other` has no default). They ship with agentixxx and
change with it: this copy is the one of the agentixxx that installed this skill, and the repo
setup skill updates it. A repo that wants another text writes its own under the key, and can
start from the one here; `""` drops the section.

## `workflow.merge`: Merging

Where the repo's AGENTS.md says otherwise, AGENTS.md wins.

- When the work changes the code or the docs, finish with a pull request: run the repo's checks, commit on the issue's branch, push, and open a pull request against the base branch, ready for review rather than a draft. Its title says what changed; its body says why, what a reviewer should look at, and `Fixes <ID>`, so that the issue closes with it.
- Once it is open and its checks are green, merge it yourself, without asking. Leave it open only when the issue says so, or when another pull request has to land first. When the merge fails (a conflict with the base branch, a failing check), fix it on the branch and try again.
- The merge makes the issue Done: check that it did. Never park merged work in a review status, since an issue that is not Done holds back what it blocks.
- If you closed the last open child of an epic and what the epic set out to do is done, move the epic to Done too, and comment on it, mentioning the person ("Filing issues"): what the feature now does, and what is left for a person, or that nothing is.
- Work that changes nothing in the repo (an answer, an investigation) needs no pull request: put what you found in a comment on the issue.

## `workflow.branches`: Branches

Where the repo's AGENTS.md says otherwise, AGENTS.md wins.

- Work on the issue's own branch: its Linear git branch name, which the run is already on. Never invent a branch name, and never push a branch whose name lacks the issue's identifier.
- One issue, one branch, one pull request against the base branch.
- A feature is an epic, and each of its sub-issues gets a branch and a pull request of its own against the base branch.

## `workflow.deploy`: Deploys

Where the repo's AGENTS.md says otherwise, AGENTS.md wins.

- A merge deploys nothing by itself.
- When what you merged has to go somewhere (a server, a store, a registry), the deploy is a person's step. Look for an open deploy issue in the project first and comment on it with your pull request and what it adds; otherwise file one in Linear, labelled `Role: Human`, assigned to the person ("Filing issues"), in Todo, with the commands in order in one shell block, any prerequisite first (a new option, a secret to create).
- Say in the pull request what it needs to deploy, or that there is nothing to deploy and why.
- Your issue is Done at the merge either way. Never hold it open for a deploy.

## `workflow.feedback`: Asking a person

Where the repo's AGENTS.md says otherwise, AGENTS.md wins.

- Stop and ask only when all of this holds: the issue, its comments and the repo do not settle the question; a wrong guess would be costly to undo (lost data, something public or paid, a design the rest of the work builds on); and no useful part of the issue can be finished without the answer.
- Then commit and push what you have, comment on the issue with the question and the options for a reader who has seen none of this session, mentioning the person who has to answer, and move it to In Review.
- Otherwise take the option that is easiest to change later, say which and why in the pull request and in a comment on the issue, and finish. File the question as a `Role: Human` issue of its own, so that it is answered without anything waiting for it.
- A step only a person can do (a secret, an account, an admin console, sudo, a deploy) is no reason to stop either: file it as a `Role: Human` issue and finish your own.

## `workflow.issues`: Filing issues

Where the repo's AGENTS.md says otherwise, AGENTS.md wins.

- Linear issues form a tree. A feature is an epic labelled `Role: Agent`, and its parts are its sub-issues; a part big enough to split again is a sub-epic. A feature of one issue is a top-level issue labelled `Role: Agent` itself.
- A step only a person can do is an issue labelled `Role: Human`, titled for a person, with the commands and how to tell that it is done. It is a sibling of the work it belongs to under the epic, never a child of it: an issue with an open sub-issue gets no run.
- A follow-up, or anything found out of scope, is an issue of its own under the epic it belongs to, never only a note in the code or a pull request. Say which issue it was found in. Look at the epic's children before filing: it may be there already.
- Blocks / blocked by only for a real order: an issue is not picked while a blocker is open. No "related to" links; name the other issue in the description instead.
- An issue filed in Todo under an epic labelled `Role: Agent` is picked up at once, by a run that has seen nothing else; one in Backlog waits until someone moves it to Todo. Write it for that run: first line `Part of <epic>.` and its blockers, each with the reason; then what to change and where, what to test, and what is not part of it; and a priority. An issue that first needs a decision is a person's step, with the question.
- Linear tells a person of everything on an issue they are assigned to or mentioned in, so keep both for when they are needed. Assign a `Role: Human` issue to the person (the one AGENTS.md names, or else whoever created your issue or its epic) and no other issue to anyone. Mention them (@ and their Linear display name) only in a question that stops you and in the comment that closes an epic, never to keep them informed. When your merge is what a `Role: Human` issue waited for, comment on it with what to do now: its assignee hears of it.
