---
name: task-workflow
description: Shared task ledger, gate, artifact, and Git-safety contract for the canonical task-start workflow.
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/task-workflow/SKILL.md
disable-model-invocation: true
---

# Task Workflow

`tasks/` is the durable record of human intention, agent planning, execution, and review. The entry point is `/task-workflow:task-start`; this file is the shared contract it and every child agent operate under.

## Task creation

1. Read `CLAUDE.md`, this file, and `tasks/global-task-manager.md`.
2. Get `Next ID` from the GTM, create `tasks/planning/TXXX-task-slug/`, copy `tasks/main-template.md` to `main.md`, add the task to the GTM, and increment `Next ID`.
3. Draft the Intent Contract and `DONE_WHEN` from the human's request; set status `PLANNING`.
4. Offer `/task-workflow:intent-harden` for non-trivial work and record the outcome on the `Intent hardening:` line in `main.md`. If it runs, the hardened brief replaces the draft contract.
5. Build the Handoff Packet (defined in `task-start`). Every child prompt receives the same `DONE_WHEN` verbatim.
6. Route the task: `quickfix` (small, one plausible site, obvious validation, no product ambiguity — planning skipped, code review kept) or `planned`. Record the lane in `main.md`.

## Status machine

| Status | Meaning | Directory |
|---|---|---|
| `PLANNING` | Intent/plan being prepared | `tasks/planning/` |
| `PLAN_REVIEW` | Plan reviewer checking readiness | `tasks/planning/` |
| `READY` | Plan passed; task can execute | `tasks/active/` |
| `EXECUTING_PHASE_N` | Executor implementing phase N | `tasks/active/` |
| `CODE_REVIEW` | Code reviewer checking phase N | `tasks/active/` |
| `BLOCKED` | Human input or prerequisite required | `tasks/paused/` |
| `COMPLETE` | All phases implemented and reviewed | `tasks/completed/` |

A quickfix enters `tasks/active/` at routing and runs as a single phase. The parent moves folders with a normal filesystem move, keeps the `## Meta` status and GTM row in agreement, and stages the old/new paths at the next approved commit boundary. Tasks created before this workflow are historical evidence: reassess their intent against current repository direction before resuming; never execute stale plans automatically.

## Ownership and gates

| Artifact | Owner |
|---|---|
| Intent Contract and Handoff Packet | Human + parent orchestrator |
| `## Plan` | `task-workflow:planner` |
| `## Plan Review` / `plan-review.md` | `task-workflow:plan-reviewer` |
| Source edits and `## Execution Log` | `task-workflow:executor` |
| `## Code Review Log` / `code-review-phase-N.md` | `task-workflow:code-reviewer` |
| Git commits after `PASS`, GTM, transitions | Parent orchestrator |

| Gate | Outcome | Action |
|---|---|---|
| Plan review | `READY` | Promote to `tasks/active/` and execute |
| Plan review | `NEEDS_WORK` | Planner revises, re-review |
| Plan review | `NOT_READY` | Block for a real human decision/prerequisite |
| Code review | `PASS` | Parent commits the reviewed phase and continues |
| Code review | `REVISE` | Executor repairs numbered findings, re-review |
| Code review | `FAIL` | Block or re-plan |

Maximum three `NEEDS_WORK` or `REVISE` cycles before blocking. If a reviewer returns a verdict without persisting its declared artifacts, the parent writes the exact output before routing the gate.

## Git and substrate discipline

- Choose current branch, feature branch, or worktree from repository instructions, Git state, concurrency, and delivery expectations; record the strategy, rationale, and task baseline SHA in `main.md`.
- Preserve unrelated human changes: never stash, reset, delete, or commit them; prefer safe isolation when allowed.
- The executor starts only from a clean workspace and leaves its phase uncommitted for review.
- The code reviewer inspects the actual working-tree diff from the recorded phase baseline, runs checks, and persists its verdict; the plan reviewer does the same for plans.
- The parent commits only after `PASS`, using `git add -- <explicit-reviewed-paths>` and a task/phase-specific message. Never use `git add .`, `git add -A`, or stage a path the reviewer did not inspect; verify `git diff --cached --name-only` before every commit.
- Push, PR, merge, deployment, force-push, and branch deletion require explicit authorization or an already-authorized repository workflow.

## Blocked recovery

Record the exact blocker and attempted work in `main.md`, set `BLOCKED`, move the task to `tasks/paused/`, and update the GTM. When the human answers, restore the appropriate prior stage — an answer does not imply "resume coding"; return to planning if intent or scope changed.

## Completion

Run the repository's full tests/lint/build checks, compare the cumulative result with `DONE_WHEN`, complete `## Completion` with evidence, move the task to `tasks/completed/`, update the GTM, and commit the ledger update. Follow the recorded delivery strategy; do not push, merge, open a PR, or deploy unless authorized.
