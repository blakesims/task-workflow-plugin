---
name: task-workflow
description: Shared task ledger, gate, artifact, and Git-safety contract for the canonical task-start workflow.
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/task-workflow/SKILL.md
disable-model-invocation: true
---

# Task Workflow

`tasks/` is the durable record of human intention, agent planning, execution, and review. The canonical entry point is `/task-workflow:task-start`.

The orchestrator chooses current branch, feature branch, or worktree from repository context. The workflow itself remains substrate-agnostic while preserving the same intent packet, gates, evidence, and Git safety.

## Core task creation

1. Read `CLAUDE.md`, this file, and `tasks/global-task-manager.md`.
2. Get `Next ID` from the GTM.
3. Create `tasks/planning/TXXX-task-slug/`.
4. Copy `tasks/main-template.md` to `main.md`.
5. Add the task to the GTM and increment `Next ID`.
6. Draft the Intent Contract and `DONE_WHEN` from the human's request.
7. Set status `PLANNING`.
8. Offer `/task-workflow:intent-harden` before sending non-trivial work to the planner.

## Canonical human-to-agent boundary

Before launching a planner, the parent orchestrator records:

- executive intent;
- `DONE_WHEN`;
- scope in;
- scope out / unchanged behaviour;
- source of intent and repository evidence;
- decisions already made;
- only material open questions;
- assumptions, risks, and validation expectations.

The parent then creates the canonical Task Workflow Handoff Packet from those fields. Every child prompt receives the same `DONE_WHEN` verbatim.

Intent hardening is optional. Record exactly one of `NOT_OFFERED`, `RUN`, `DECLINED`, or `SKIPPED` in `main.md`. If it runs, its hardened brief replaces the draft contract as planner input. Visualization is used only when it reduces ambiguity or project instructions require it.

## Status machine

| Status | Meaning | Directory |
|---|---|---|
| `PLANNING` | Intent/plan being prepared | `tasks/planning/` |
| `PLAN_REVIEW` | Plan reviewer checking readiness | `tasks/planning/` |
| `READY` | Plan passed and task can execute | `tasks/active/` |
| `EXECUTING_PHASE_N` | Executor implementing phase N | `tasks/active/` |
| `CODE_REVIEW` | Code reviewer checking phase N | `tasks/active/` |
| `BLOCKED` | Human input or prerequisite required | `tasks/paused/` |
| `COMPLETE` | All phases implemented and reviewed | `tasks/completed/` |

## Directory transitions

The parent orchestrator moves folders and updates the GTM:

| Gate | Action |
|---|---|
| Plan review `READY` | Move `tasks/planning/TXXX-*` to `tasks/active/` |
| Genuine blocker | Move the task from `planning/` or `active/` to `tasks/paused/` |
| Final completion | Move `tasks/active/TXXX-*` to `tasks/completed/` |

Use a normal filesystem move so transitions work before or after the task is tracked. The parent stages the exact old/new paths only at the next approved commit boundary.

The `## Meta` status and GTM row must agree after each transition.

Existing tasks created before this workflow remain historical evidence. Reassess their intent and plan against current repository direction before resuming them; do not execute stale plans automatically.

## Agent ownership

| Artifact | Owner |
|---|---|
| Intent Contract and Handoff Packet | Human + parent orchestrator |
| `## Plan` | `task-workflow:planner` |
| `## Plan Review` / `plan-review.md` | `task-workflow:plan-reviewer` |
| Source edits and `## Execution Log` | `task-workflow:executor` |
| `## Code Review Log` / `code-review-phase-N.md` | `task-workflow:code-reviewer` |
| Cross-phase updates | `task-workflow:phase-reviewer` |
| Git commits after `PASS`, GTM, completion | Parent orchestrator |

The parent coordinates but does not implement source changes during a task workflow.

## Gates and iteration limits

| Gate | Outcome | Action |
|---|---|---|
| Plan review | `READY` | Promote and execute |
| Plan review | `NEEDS_WORK` | Planner revision, then re-review |
| Plan review | `NOT_READY` | Block for a real human decision/prerequisite |
| Code review | `PASS` | Commit reviewed phase on the selected working branch and continue |
| Code review | `REVISE` | Executor repairs numbered findings, then re-review |
| Code review | `FAIL` | Block or re-plan |

Maximum three `NEEDS_WORK` or `REVISE` cycles before blocking/escalating.

## Git and substrate discipline

- Inspect repository instructions, Git status, branch, remotes, worktrees, concurrency, and delivery expectations before selecting current branch, feature branch, or worktree.
- Record the strategy and rationale in `main.md`.
- Preserve unrelated human changes. Prefer safe isolation when allowed; never stash/reset/delete/commit unrelated work.
- The executor may start only from a clean selected workspace.
- Record the task baseline SHA in `main.md`. Commit approved planning artifacts by explicit path before Phase 1 so the phase begins clean.
- Executor leaves its phase uncommitted for review.
- Code reviewer inspects the actual working-tree diff from the recorded phase baseline, runs checks, writes `code-review-phase-N.md`, and updates the review summary in `main.md`.
- Plan reviewer writes `plan-review.md` and updates the plan-review summary in `main.md`. If a reviewer fails to persist its verdict, the parent writes the exact returned output before continuing.
- Parent commits only after `PASS`, using `git add -- <explicit-reviewed-paths>` and a task/phase-specific message.
- Never use `git add .`, `git add -A`, or stage a path the reviewer did not inspect. Verify `git diff --cached --name-only` before every commit.
- Do not create branches/worktrees merely from ritual, and do not force direct-branch work when isolation is required.
- Push, PR, merge, deployment, force-push, and branch deletion require explicit authorization or an already-authorized repository workflow.

## Blocked recovery

1. Record the exact blocker and attempted work in `main.md`.
2. Set `BLOCKED`, move the task to `tasks/paused/`, and update the GTM.
3. Human supplies the missing decision or prerequisite.
4. Parent restores the prior appropriate stage and continues `/task-workflow:task-start`.

An answer does not imply “resume coding”; return to planning if the intent or scope changed.

## Completion

After all phases pass:

1. Run the appropriate full tests/lint/build checks.
2. Compare the cumulative result with `DONE_WHEN`.
3. Complete `## Completion` with commits, tests, review gates, limitations, and verification instructions.
4. Move the task to `tasks/completed/` and update the GTM.
5. Commit the task-ledger update on the selected working branch.
6. Follow the recorded delivery strategy; do not push, merge, open a PR, or deploy unless authorized.
