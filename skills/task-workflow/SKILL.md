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

Keep the entire approved Intent Contract and phased `## Plan` in `main.md`, with its existing what/how/where structure. Once accepted and execution starts, that specification is a historical snapshot: do not expand it with findings, amendments, command output or execution history. Do not tick specification checkboxes; progress belongs in compact status/outcome/path entries outside `## Plan`. Typically only a handful of pointer/status lines change per agent run, not a cumulative ten-line quota across the task.

- Executor: write `execution-phase-N.md`, then update the current phase’s status/path under `## Execution Log`.
- Reviewer: write `code-review-phase-N.md`, then update gate/date/path under `## Code Review Log`. Plan review uses `plan-review.md` and its corresponding compact entry. Each numbered attempt records `Review attempt` and `Reviewed specification SHA-256` for the exact Task/Intent/entire Plan byte range defined in task-start. The parent compares the latest report and pointer with the dispatched attempt and freshly computed current specification digest before routing `READY`; missing or stale plan-review evidence blocks continuation, including after retries or authorized replans. Keep this metadata outside the specification.
- Keep attempt history and detailed evidence in the reports; replace the same compact pointer entry after retries rather than appending another narrative. Phase reports identify phase, execution attempt and baseline. Cumulative `final-review.md` identifies the cumulative baseline, current working tree, and review attempt instead of a single phase.
- On `REVISE`, the executor must read the exact linked full review and address its numbered findings. The parent passes that path in the repair handoff and checks reports exist and match the current attempt before routing a gate.
- Parent: maintain overall status/GTM and compact completion outcome/path; full completion evidence goes in `completion.md`. Cumulative review goes in `final-review.md`, linked from a compact final-review entry.
- If discoveries invalidate approved scope, record them in a separate report and stop `BLOCKED` for explicit replanning authorization. Preserve the old agreement in Git/history and obtain renewed plan review/acceptance before executing changed scope. Do not silently append amendments during execution.
- Existing tasks are not automatically rewritten. Preserve their historical inline records; before resuming, agree on which plan revision is authoritative and use separate reports with compact pointers for new work. Upgrade copied templates only with consent.

The parent compares the approved specification against its accepted Git revision (including its original path if the task moved) before routing gates. Reject unauthorized specification changes; permit the declared executor/reviewer pointer updates. This is a prompt-driven workflow, not a filesystem write sandbox. The regression checks validate shipped instructions and artifact examples; they do not guarantee a model obeys them.

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

Run the repository's full tests/lint/build checks, compare the cumulative result with `DONE_WHEN`, write full evidence to `completion.md` and update only the outcome/date/path under `## Completion`, move the task to `tasks/completed/`, update the GTM, and commit the ledger update. Follow the recorded delivery strategy; do not push, merge, open a PR, or deploy unless authorized.
