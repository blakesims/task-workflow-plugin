---
name: task-start
description: Run the task-workflow development cycle — Intent Contract, routing, reviewed phased execution — whenever the user asks to use the task workflow or task system on a piece of work.
user-invocable: true
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/task-start/SKILL.md
---

# Task Start

You are the orchestrator, not the executor. Shape intent, maintain the task ledger, write every child-agent handoff, evaluate gates, and continue until `COMPLETE` or `BLOCKED`. Project instructions may specialize this workflow but must not weaken its intent handoff, review gates, Git safety, or durable evidence.

The shared contract (status machine, gates, Git discipline) lives in the `task-workflow` skill. This file is the procedure.

## Workflow

```text
Human request
  ↓
Context gate → Intent Contract + DONE_WHEN (optional /task-workflow:intent-harden)
  ↓
Handoff Packet → ROUTE
  ├─ quickfix: executor → code reviewer → done
  └─ planned:  planner → plan reviewer → per phase: executor → code reviewer
                                          ↓
                              final review (if >1 phase) → completion
```

Agents (via the `Agent` tool): `task-workflow:planner`, `task-workflow:plan-reviewer`, `task-workflow:executor`, `task-workflow:code-reviewer`. Source edits belong to the executor. The parent creates task documents and commits reviewed work.

## Stage 0 — Context and task ledger

If `tasks/` does not exist yet, bootstrap it first:

```bash
mkdir -p tasks/{planning,active,paused,completed}
cp ${CLAUDE_PLUGIN_ROOT}/templates/main.md tasks/main-template.md
cp ${CLAUDE_PLUGIN_ROOT}/templates/global-task-manager.md tasks/global-task-manager.md
cp ${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md tasks/CLAUDE.md
```

Then read the repository `CLAUDE.md`, `tasks/CLAUDE.md`, `tasks/global-task-manager.md`, and relevant specs. Then choose the Git substrate from evidence, not ritual:

- **current branch** — the repository explicitly allows direct serial work there;
- **feature branch** — isolated review or PR delivery is expected;
- **worktree** — a dirty/shared checkout or a concurrent lane must be preserved.

Run `git status --short` and inspect branch, remotes, and worktrees. Never stash, reset, delete, or commit unrelated human work; if unrelated changes exist, prefer a separate worktree when repository rules permit (switching branches in the same dirty checkout is not isolation), otherwise stop `BLOCKED` until the human clears them or explicitly includes the exact paths.

Record in `main.md`: the chosen strategy and rationale, and the task baseline SHA from `git rev-parse HEAD`.

Create the next task from `tasks/main-template.md`, update the Global Task Manager, and set status `PLANNING`. If continuing an existing task, resume from its current `main.md`, status and linked reports. Apply the shared contract’s legacy boundary: do not automatically rewrite historical task content. Check copied templates for `phase-report-pointers-v1`; offer a consented template upgrade if absent, without overwriting task folders or the populated GTM.

## Stage 1 — Intent Contract

Draft in `main.md` before any planning:

- **Executive intent** — problem, why it matters, user-visible success;
- **DONE_WHEN** — one or two lines defining the completed outcome;
- **Scope in** / **Scope out (unchanged behaviour)**;
- **Proposed approach** — high level only;
- **Risks, assumptions, validation expectations**;
- **Open decisions** — only high-impact choices that cannot be inferred safely.

Ask the minimum questions needed to make `DONE_WHEN` and scope reliable.

Then assess how much of the contract you had to invent. Count the material decisions the user's request left open: no verifiable `DONE_WHEN`, multiple plausible interpretations of the outcome, unstated scope boundaries, or an unspecified user-facing or data-sensitive surface. If two or more are open — or the work is non-trivial, ambiguous, user-facing, or data-sensitive — proactively offer intent hardening before planning, naming what is underspecified, e.g.: "Your request leaves N decisions open (list them). Want me to run `/task-workflow:intent-harden` first? ~5 minutes, and the planner inherits a much stronger contract." Use AskUserQuestion with run/skip options. Do not offer it for trivial work where the draft is already unambiguous.

Record the outcome on the `Intent hardening:` line in `main.md` (e.g. `run`, `declined`, `skipped — trivial task`). If it runs, the hardened brief replaces the draft contract.

## Handoff Packet

Create this packet once intent is settled. It is the authoritative boundary for every child agent, and `DONE_WHEN` must appear verbatim in every child prompt. Before acceptance, regenerate a materially changed packet for all later agents. After acceptance, follow the shared contract’s explicit replanning boundary; do not silently change approved scope.

```md
# Task Workflow Handoff Packet

## DONE_WHEN
<single tight assertion>

## Executive intent
## Scope in
## Scope out
## Source of intent / evidence
## Decisions made
## Open decisions        <!-- None, or unresolved human-level choices -->
## Assumptions and risks
## Relevant repo context
## Runtime strategy      <!-- substrate, branch/path, baseline SHA, delivery expectation -->
## Validation expectations
## Task ledger paths     <!-- main.md; exact separate execution/review paths; compact writable pointer entries -->
## Accepted plan reference <!-- Git commit and original main.md path; specification stays unchanged -->
```

Dispatch packet + exact plan/report paths + current attempt/baseline; agents open files, not pasted histories. Retries include prior blockers, repair delta and targeted results, retaining all approved criteria and affected regressions. Follow shared review/safe-validation rules; parent checks freshness and routes gates, not a duplicate review.

## Stage 2 — Route

Choose a lane and record it under `Lane:` in `main.md`:

- **quickfix** — a small bounded change with one plausible site, obvious validation, and no product ambiguity. Skip planner/plan-reviewer; record the accepted packet as a compact Phase 1 in the existing plan structure, commit the task setup, and record that Git revision/path as the accepted specification before Stage 3. Code review still runs in full.
- **planned** — everything else. Continue to planning below.

**Planning (planned lane).** Spawn `task-workflow:planner` with the packet to write the plan. Dispatch `task-workflow:plan-reviewer` with packet, `main.md` and `plan-review.md` paths; it persists the review and compact metadata under the shared artifact contract. Before each dispatch (including retries and authorized replans), increment the review attempt monotonically, clear the prior gate to pending, and compute the SHA-256 of the exact UTF-8 bytes from `## Task\n` up to (excluding) `## Plan Review\n` in `main.md`, including separators with no normalization. Pass that digest and attempt to the reviewer; keep metadata outside the specification.

Before routing the plan-review gate, open `plan-review.md` and require its latest numbered attempt, `Review attempt`, `Reviewed specification SHA-256`, and gate to agree with the dispatched attempt and compact pointer. Recompute the current specification digest using the same byte range and require equality with the reviewed digest. Reject missing or stale plan-review evidence: block continuation and obtain a fresh review; never reuse an earlier `READY` after a retry, plan edit, or replan. Do not invent missing metadata when persisting a reviewer output. Recheck immediately before accepting/committing the specification.

Route the gate:

- `READY` — move the task to `tasks/active/`, update the GTM, satisfy any project-required human acceptance, commit only the explicit task/GTM paths, and record the resulting Git revision and original `main.md` path in the handoff as the accepted specification. Keep the entire approved plan in `main.md`; verify a clean tree and continue.
- `NEEDS_WORK` — send numbered feedback to the planner and re-review; maximum three cycles.
- `NOT_READY` — set `BLOCKED`, move to `tasks/paused/`, surface the exact human decision or missing prerequisite.

If any reviewer returns a verdict without writing its declared artifacts, the parent persists the exact output in the separate report and updates only its gate/date/path pointer before routing the gate. Never paste that full output into `main.md`. Never leave a dangling review link.

## Stage 3 — Execute/review loop

For each approved phase (a quickfix is one phase):

1. Require `git status --short` empty before phase preparation; capture the phase baseline SHA in the handoff. Set status `EXECUTING_PHASE_N`; declare this metadata-only change to the executor so it is not mistaken for unrelated dirty work. The executor records the baseline in `execution-phase-N.md`, not in the plan. Repairs retain the original phase baseline and expected task changes.
2. Dispatch `task-workflow:executor`: packet, entire approved plan reference, current phase, `main.md` / `execution-phase-N.md` paths and any repair report. It follows the shared artifact contract and leaves source uncommitted. Require its report before review.
3. Set `CODE_REVIEW`. Dispatch `task-workflow:code-reviewer`: packet, current phase, execution report, baseline SHA and `main.md` / `code-review-phase-N.md` paths. Require inspection of the actual diff including enumerated untracked candidate files and risk-proportionate checks. Before routing, verify report existence/current phase/attempt and compare the full approved specification to its accepted Git revision; only declared metadata/pointers may change.
4. Route the gate:
   - `PASS` — stage only the reviewed paths plus the current task artifacts using `git add -- <path...>`; verify `git diff --cached --name-only`; commit on the working branch with a task/phase-specific message; verify a clean tree; continue.
   - `REVISE` — pass the exact current full review path to the executor, which must read it and repair the numbered findings before re-review; maximum three cycles. Preserve attempt history in the separate reports, replacing only the compact pointers in `main.md`. Missing/stale report evidence blocks continuation.
   - `FAIL` — block or return to planning, depending on the cause.
5. After a `PASS`, continue the unchanged approved plan. If evidence invalidates later phases, record it in the separate report and stop for explicit replanning authorization and renewed review/acceptance. Preserve the original agreement in Git/history; do not append amendments or rewrite later phases during execution.

Never use `git add .`, `git add -A`, or broad path globs. Never stage a path the reviewer did not inspect. Push only when explicitly authorized.

## Stage 4 — Completion

After every phase passes:

- run the repository's full tests/lint/build checks under the shared safe-validation rules; isolate source-mutating suites rather than running them in the authoring tree;
- if the task had more than one phase, dispatch the code reviewer on the cumulative diff from the task baseline SHA through the **current working tree** (including any uncommitted repairs and explicitly enumerated untracked files) against `DONE_WHEN`, writing `final-review.md` and a compact final-review gate/path entry under `## Code Review Log`; require `PASS`. On `REVISE`, the executor reads that exact report and repairs within approved scope, then the cumulative review runs again against the working tree (maximum three cycles). After `PASS`, the parent verifies/stages only reviewed source and report paths and commits any repairs before completion; on `FAIL` or exhausted cycles, block rather than complete;
- write full completion evidence to `completion.md`; update only date/outcome/report path under `## Completion` in `main.md`, set status `COMPLETE`, move the task to `tasks/completed/`, update the GTM, and commit the ledger updates;
- follow the recorded delivery strategy; do not push, merge, open a PR, or deploy unless authorized.

Return: executive summary; mapping to `DONE_WHEN`; files and commits; tests and review gates; limitations; exact commands or UI flow the human can use to see the result.

## Blocked recovery

Record details in the current phase report or `blocked.md`; put only a concise reason/report path in `main.md`, set status `BLOCKED`, move the task to `tasks/paused/`, and update the GTM. Resume at the appropriate prior stage only after the human answers or the prerequisite is satisfied.

## Routing rule

Do not hand control back after planning or each phase. Continue autonomously until `COMPLETE`, `BLOCKED`, or a genuinely high-impact human decision is required.
