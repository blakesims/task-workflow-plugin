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

## Approved plan and report pointers

Keep the entire approved Task, Intent Contract and phased `## Plan` in `main.md` as the historical what/how/where agreement. Do not amend it, tick its checkboxes or append execution/review material. Agents write separate reports first, then replace compact status/outcome/path entries outside the specification; this is not a cumulative line quota.

- Executor: `execution-phase-N.md` → current phase under `## Execution Log`.
- Reviewer: `code-review-phase-N.md` → gate/date/path under `## Code Review Log`. Phase reports identify phase, execution attempt and baseline. `final-review.md` identifies cumulative baseline, current working tree, and review attempt, linked by a compact final-review entry.
- Plan reviewer: preserve numbered attempts in `plan-review.md`, recording `Review attempt` and `Reviewed specification SHA-256` for the exact Task/Intent/entire Plan byte range defined in task-start. Before `READY`, the parent compares latest report/pointer/dispatched attempt and freshly computed current digest; missing/stale evidence blocks, including after retries/replans. Metadata stays outside the specification.
- On `REVISE`, pass the exact current full review path; the executor must read its numbered blockers before repair. Parent checks report existence and current attempt before routing gates.
- Parent: status/GTM and compact completion pointer; full completion evidence in `completion.md`.
- If evidence invalidates scope, record it separately and stop `BLOCKED` for explicit replanning authorization and renewed review/acceptance. Preserve the earlier agreement in Git/history.
- Do not automatically rewrite historical tasks or upgrade copied templates without consent. Agree on the authoritative plan revision before resuming; preserve old records and use separate reports for new work.

Before routing gates, compare the full approved specification against its accepted Git revision and original path; only declared metadata/pointers may change. These are prompt-level safeguards, not a filesystem sandbox. Tests cover instructions/artifact fixtures, not guaranteed model compliance.

## Ownership and gates

| Artifact | Owner |
|---|---|
| Intent Contract and Handoff Packet | Human + parent orchestrator |
| `## Plan` | `task-workflow:planner` |
| `## Plan Review` / `plan-review.md` | `task-workflow:plan-reviewer` |
| Source edits, `execution-phase-N.md`, and compact `## Execution Log` pointer | `task-workflow:executor` |
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

Maximum three `NEEDS_WORK` or `REVISE` cycles before blocking. If a reviewer returns a verdict without persisting its declared artifacts, the parent writes the exact output to the separate report and updates only its outcome/path pointer before routing the gate.

## Review scope and safe validation

- Block on concrete defects, unmet criteria or material evidence gaps. Tooling/editorial suggestions do not force revision unless they affect executable requirements, required evidence or safety decisions. Do not waive approved criteria.
- Re-review prior blockers, repair delta and affected regressions/dependencies. Keep the full contract, cumulative integration obligations and freshness checks; reference still-valid evidence and expand review when new evidence undermines it.
- Choose checks by risk, not quotas for findings, reruns or negative controls. Inspect test configuration before running. Source-mutating controls must run only in a disposable isolated copy of the exact candidate, including uncommitted and untracked candidate files, with no shared writable source or live-service side effects. Never run them in the authoring tree; report unavailable safe verification as a gap. Required completion checks remain required, safely isolated when necessary.
- Preserve reports/attempts. Record blocker dispositions, changed evidence and prior report/attempt pointers, not repeated history. Handoffs carry gate, decisions, current attempt/baseline and exact paths; write full evidence once.

## Git and substrate discipline

- Choose current branch, feature branch, or worktree from repository instructions, Git state, concurrency, and delivery expectations; record the strategy, rationale, and task baseline SHA in `main.md`.
- Preserve unrelated human changes: never stash, reset, delete, or commit them; prefer safe isolation when allowed.
- Require a clean workspace before phase preparation. The executor may then see only the declared parent status/pointer edits; on repair it resumes the expected reviewed diff under the original phase baseline. Unrelated changes still block or require isolation. It leaves its phase uncommitted for review.
- The code reviewer inspects the actual working-tree diff from the recorded phase baseline, runs checks, and persists its verdict; the plan reviewer does the same for plans.
- The parent commits only after `PASS`, using `git add -- <explicit-reviewed-paths>` and a task/phase-specific message. Never use `git add .`, `git add -A`, or stage a path the reviewer did not inspect; verify `git diff --cached --name-only` before every commit.
- Push, PR, merge, deployment, force-push, and branch deletion require explicit authorization or an already-authorized repository workflow.

## Blocked recovery

Record the exact blocker and attempted work in the current phase report (or `blocked.md` before execution), link it from a compact blocker/status entry in `main.md`, set `BLOCKED`, move the task to `tasks/paused/`, and update the GTM. When the human answers, restore the appropriate prior stage — an answer does not imply "resume coding"; return to planning if intent or scope changed.

## Completion

Run the repository's full tests/lint/build checks under the safe-validation rules above, compare the cumulative result with `DONE_WHEN`, write full evidence to `completion.md` and update only the outcome/date/path under `## Completion`, move the task to `tasks/completed/`, update the GTM, and commit the ledger update. Follow the recorded delivery strategy; do not push, merge, open a PR, or deploy unless authorized.
