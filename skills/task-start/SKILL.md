---
name: task-start
description: Run the canonical task-workflow development cycle from human intent through planning, reviewed phased execution, and completion.
user-invocable: true
disable-model-invocation: true
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/task-start/SKILL.md
---

# Task Start

You are the orchestrator, not the executor. Shape intent, maintain the task ledger, write every child-agent handoff, evaluate gates, and continue until `COMPLETE` or `BLOCKED`.

This is the canonical workflow shipped by the task-workflow plugin. Project instructions may specialize it, but they must not weaken its intent handoff, review gates, Git safety, or durable evidence.

## Runtime strategy

Do not assume `main`, a feature branch, or a worktree. Before changing files, the parent chooses the safest substrate from repository evidence:

- **current branch** — appropriate when the repository explicitly allows direct serial work there;
- **feature branch** — appropriate when isolated review or PR delivery is expected;
- **worktree** — appropriate when preserving a dirty/shared checkout or running isolated lanes.

Inspect repository instructions, current branch/status, remotes, existing worktrees, concurrency, and delivery expectations. Record the selected strategy and rationale in `main.md`. Never create a worktree or branch merely from ritual, and never force direct-branch work when isolation is required.

Project instructions or explicit human direction decide whether mockups, decision records, sign-off, a final PR, or deployment gates are required. Intent hardening remains optional. Never push, merge, deploy, force-push, or delete branches without explicit authorization.

The parent may commit a phase only after its code review returns `PASS`.

## Project agents

Use the current Claude Code `Agent` tool with these plugin agents:

- `task-workflow:planner`
- `task-workflow:plan-reviewer`
- `task-workflow:executor`
- `task-workflow:code-reviewer`
- `task-workflow:phase-reviewer`

Source edits belong to the executor. The parent may create/update task documents and commit reviewed work.

## Workflow

```text
Human request
  ↓
Context gate
  ↓
Intent Contract + DONE_WHEN
  ↓
Optional /task-workflow:intent-harden
  ↓
Planner → Plan Reviewer
  ↓
Executor → Code Reviewer → optional Phase Reviewer
  ↓
Repeat phases
  ↓
Final review → completion summary
```

## Stage 0 — Context and task ledger

Read:

- repository `CLAUDE.md` or equivalent project instructions;
- `tasks/CLAUDE.md`;
- `tasks/global-task-manager.md`;
- relevant product/specification files.

Run `git status --short`, inspect the current branch/worktrees/remotes, and choose the runtime strategy before creating or resuming a task:

- never stash, reset, delete, or commit unrelated human work;
- if unrelated changes exist in the current checkout, prefer a separate worktree when repository rules permit; creating or switching branches in that same dirty checkout is not isolation;
- otherwise stop `BLOCKED` until the human clears them or explicitly includes the exact paths;
- record `git rev-parse HEAD` as the task baseline SHA in `main.md`;
- record the selected current-branch / feature-branch / worktree strategy and rationale in `main.md`;
- after task creation/planning artifacts are approved, commit only their explicit paths so execution begins from a clean tree.

Create the next task from `tasks/main-template.md`, update the Global Task Manager, and set status `PLANNING`. If continuing an existing task, use its current `main.md` and status.

## Stage 1 — Intent Contract

Before planning, draft:

- **Executive intent** — problem, why it matters, user-visible success;
- **DONE_WHEN** — one or two lines defining the completed outcome;
- **Scope in**;
- **Scope out / unchanged behaviour**;
- **Proposed approach** — high level only;
- **Risks and assumptions**;
- **Open decisions** — only high-impact choices that cannot be inferred safely;
- **Validation expectations**.

Ask the minimum questions needed to make `DONE_WHEN` and scope reliable. Record the contract in the task `main.md`.

## Stage 1.5 — Offer intent hardening

For non-trivial, ambiguous, user-facing, data-sensitive, or broad tasks, offer:

```text
I have a draft Intent Contract. Do you want to run intent-hardening before I send it to the planner?

- Harden intent first — slower, safer; stress-test scope and source alignment.
- Proceed — use the current contract.
- Edit contract manually — provide corrections first.
```

Write exactly one canonical token to `main.md` under `## Intent Contract → ### Intent hardening → Status`:

- `RUN` — the human accepted; invoke `/task-workflow:intent-harden` and replace the draft with the hardened brief;
- `DECLINED` — the offer was made and the human chose to proceed without it;
- `SKIPPED` — the parent explicitly skipped hardening because the task is small and obvious;
- `NOT_OFFERED` — the workflow has not reached the offer yet.

Do not write free-form or lowercase status values.

## Canonical Task Workflow Handoff Packet

Create this packet after intent hardening is accepted, declined, or skipped. It is the authoritative boundary for every child agent.

```md
# Task Workflow Handoff Packet

## DONE_WHEN
<single tight assertion>

## Executive intent
<problem, why it matters, user-visible success criteria>

## Scope in
- ...

## Scope out
- ...

## Source of intent / evidence
- user request, PRD section, task file, or repository evidence

## Decisions made
- <decision>: <choice> — <rationale>

## Open decisions
- None, or only unresolved human-level choices

## Assumptions and risks
- ...

## Relevant repo context
- inspected files and relevant conventions

## Runtime strategy
- substrate: current branch | feature branch | worktree
- working branch/path: ...
- task baseline SHA: ...
- rationale and delivery expectation: ...

## Validation expectations
- commands and manual checks

## Task ledger / artifact paths
- Task main.md: ...
- Plan review: ...
- Code reviews: ...
```

`DONE_WHEN` must appear verbatim in every child prompt. If the packet changes materially, regenerate it for all later agents.

## Stage 2 — Planner and plan reviewer

Spawn `task-workflow:planner` through `Agent` with the full packet and instruct it to create the phased plan without implementing.

Then spawn `task-workflow:plan-reviewer` through `Agent` with:

- the same full packet;
- the planner output;
- instructions to inspect the repository and judge against `DONE_WHEN`;
- the exact `main.md` and `plan-review.md` paths;
- instructions to write the full verdict to `plan-review.md` and update the `## Plan Review` summary in `main.md`.

If a reviewer returns a verdict but fails to write the declared artifacts, the parent must persist its exact output before routing the gate. Never leave a dangling review link.

Route the gate:

- `READY` — move task to `tasks/active/`, update GTM, stage only the explicit task/GTM paths, commit the approved planning artifacts, verify a clean tree, then continue.
- `NEEDS_WORK` — send numbered feedback to planner, then review again; maximum three cycles.
- `NOT_READY` — set `BLOCKED`, move to `tasks/paused/`, and surface the exact human decision or missing prerequisite.

## Stage 3 — Execute/review loop

For each approved phase:

1. Require `git status --short` to be empty and record the phase baseline SHA from `git rev-parse HEAD` in the current phase's Execution Log.
2. Set status `EXECUTING_PHASE_N`.
3. Spawn `task-workflow:executor` through `Agent` with:
   - the full packet;
   - only the current approved phase;
   - revision feedback, if any.
4. Set status `CODE_REVIEW`.
5. Spawn `task-workflow:code-reviewer` through `Agent` with:
   - the full packet;
   - current phase;
   - executor output;
   - the phase baseline SHA;
   - exact `main.md` and `code-review-phase-N.md` paths;
   - instruction to inspect the actual working-tree diff, run checks, write the full verdict to `code-review-phase-N.md`, and update `## Code Review Log` in `main.md`.
6. If the reviewer does not persist its output, the parent writes its exact verdict to those artifacts before routing the gate.
7. Route the gate:
   - `PASS` — compare changed paths with the reviewed path list; stage only those explicit paths plus the current task/review artifacts using `git add -- <path...>`; verify `git diff --cached --name-only`; commit on the selected working branch; verify a clean tree; continue.
   - `REVISE` — return numbered feedback to executor and re-review; maximum three cycles.
   - `FAIL` — block or return to planning, depending on the cause.
8. Use `task-workflow:phase-reviewer` only when evidence from the passed phase may alter later phases.

Never use `git add .`, `git add -A`, or broad path globs. Never include a path the reviewer did not inspect. Commit messages should identify the task and phase. Push only when explicitly authorized by the human or repository workflow.

## Stage 4 — Final review and completion

After every phase passes:

- run the repository's appropriate full tests/lint/build checks;
- inspect the cumulative Git log/diff from the recorded task baseline SHA through `HEAD` against `DONE_WHEN`;
- use an available independent review tool for non-trivial work when useful, but do not make unavailable tooling a ritual blocker unless the task contract requires it;
- update `## Completion` in `main.md`;
- set status `COMPLETE`, move the task to `tasks/completed/`, and update GTM;
- commit final task-ledger/documentation updates on the selected working branch;
- follow the recorded delivery strategy; do not push, merge, open a PR, or deploy unless authorized.

Return:

1. executive summary;
2. mapping to `DONE_WHEN`;
3. files and commits;
4. tests and review gates;
5. limitations or follow-ups;
6. exact commands or UI flow the human can use to understand the result.

## Blocked recovery

Record the reason in `main.md`, set status `BLOCKED`, move the task to `tasks/paused/`, and update GTM. Resume only after the human answers or the prerequisite is satisfied; restore the appropriate prior workflow stage.

## Routing rule

Do not hand control back after planning or each phase. Continue autonomously until `COMPLETE`, `BLOCKED`, or a genuinely high-impact human decision is required.
