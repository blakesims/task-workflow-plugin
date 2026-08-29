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

Create the next task from `tasks/main-template.md`, update the Global Task Manager, and set status `PLANNING`. If continuing an existing task, resume from its current `main.md` and status.

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

Create this packet once intent is settled. It is the authoritative boundary for every child agent, and `DONE_WHEN` must appear verbatim in every child prompt. If the packet changes materially, regenerate it for all later agents.

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
## Task ledger paths     <!-- main.md, plan-review.md, code reviews -->
```

## Stage 2 — Route

Choose a lane and record it under `Lane:` in `main.md`:

- **quickfix** — a small bounded change with one plausible site, obvious validation, and no product ambiguity. Skip planning; go straight to Stage 3 as a single phase whose acceptance criteria and validation come from the packet. Code review still runs in full.
- **planned** — everything else. Continue to planning below.

**Planning (planned lane).** Spawn `task-workflow:planner` with the full packet; it creates the phased plan without implementing. Then spawn `task-workflow:plan-reviewer` with the packet, the plan, the exact `main.md` and `plan-review.md` paths, and instructions to judge against `DONE_WHEN` from repository evidence and persist its verdict to those files.

Route the gate:

- `READY` — move the task to `tasks/active/`, update the GTM, commit only the explicit task/GTM paths, verify a clean tree, continue.
- `NEEDS_WORK` — send numbered feedback to the planner and re-review; maximum three cycles.
- `NOT_READY` — set `BLOCKED`, move to `tasks/paused/`, surface the exact human decision or missing prerequisite.

If any reviewer returns a verdict without writing its declared artifacts, the parent persists the exact output before routing the gate. Never leave a dangling review link.

## Stage 3 — Execute/review loop

For each approved phase (a quickfix is one phase):

1. Require `git status --short` empty; record the phase baseline SHA in the phase's Execution Log. Set status `EXECUTING_PHASE_N`.
2. Spawn `task-workflow:executor` with the packet, only the current phase, and any revision feedback. The executor leaves its work uncommitted.
3. Set status `CODE_REVIEW`. Spawn `task-workflow:code-reviewer` with the packet, the phase, the executor output, the phase baseline SHA, and the exact `main.md` and `code-review-phase-N.md` paths; it inspects the actual working-tree diff, runs checks, and persists its verdict.
4. Route the gate:
   - `PASS` — stage only the reviewed paths plus the current task artifacts using `git add -- <path...>`; verify `git diff --cached --name-only`; commit on the working branch with a task/phase-specific message; verify a clean tree; continue.
   - `REVISE` — return numbered feedback to the executor and re-review; maximum three cycles.
   - `FAIL` — block or return to planning, depending on the cause.
5. After a `PASS`, check whether evidence from this phase changes later phases; update the remaining plan in `main.md` if it does.

Never use `git add .`, `git add -A`, or broad path globs. Never stage a path the reviewer did not inspect. Push only when explicitly authorized.

## Stage 4 — Completion

After every phase passes:

- run the repository's full tests/lint/build checks;
- if the task had more than one phase, review the cumulative diff from the task baseline SHA through `HEAD` against `DONE_WHEN`;
- update `## Completion` in `main.md`, set status `COMPLETE`, move the task to `tasks/completed/`, update the GTM, and commit the ledger updates;
- follow the recorded delivery strategy; do not push, merge, open a PR, or deploy unless authorized.

Return: executive summary; mapping to `DONE_WHEN`; files and commits; tests and review gates; limitations; exact commands or UI flow the human can use to see the result.

## Blocked recovery

Record the reason in `main.md`, set status `BLOCKED`, move the task to `tasks/paused/`, and update the GTM. Resume at the appropriate prior stage only after the human answers or the prerequisite is satisfied.

## Routing rule

Do not hand control back after planning or each phase. Continue autonomously until `COMPLETE`, `BLOCKED`, or a genuinely high-impact human decision is required.
