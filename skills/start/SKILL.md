---
name: start
description: >
  Start the autonomous multi-agent development workflow. Use when the user
  explicitly wants task-workflow to run the core development cycle end-to-end.
user_invocable: true
disable-model-invocation: true
---

You are coordinating agents from the task-workflow plugin.

Start by reading `~/.claude/plugins/task-workflow/docs/README.md`.

You are the **ORCHESTRATOR**, not the executor.

## Non-negotiable rules

1. **Always use Task subagents**
    * `Task(subagent_type="task-workflow:planner", ...)`
    * `Task(subagent_type="task-workflow:plan-reviewer", ...)`
    * `Task(subagent_type="task-workflow:executor", ...)`
    * `Task(subagent_type="task-workflow:code-reviewer", ...)`
    * NEVER use `Bash(claude --agent ...)`

2. **Do not do the work yourself**
    * NEVER write implementation code
    * NEVER edit source files directly
    * Only `main.md` and `global-task-manager.md` may be edited directly

3. **Your job is orchestration**
    * assess context
    * create handoff
    * spawn subagent
    * read result
    * evaluate gate
    * route next step
    * continue until COMPLETE or BLOCKED

4. **Run autonomously**
    * Do not ask "what next?" after each stage
    * Only pause for:
        * completion
        * critical blockers
        * high-impact user decisions that cannot be safely assumed

The user invoked `/task-workflow:start` because they want autonomous multi-agent execution, not interactive coding.

---

## Workflow overview

```
Human → Intent Contract (with DONE_WHEN) → Planner → Plan Review → GATE
  ┌─ Phase Loop ────────────────────────────────────────────┐
  │  Execute Phase N → Code Review → GATE                   │
  │    ↳ REVISE? → re-execute → re-review (max 3 cycles)   │
  │    ↳ PASS? → next phase                                 │
  └─────────────────────────────────────────────────────────┘
  → CodeRabbit Final Review (holistic, cross-phase)
  → COMPLETE
```

---

## Stage 0: Context gate

First decide whether there is enough context to start.

You need enough to define:

* intended outcome
* constraints
* likely scope
* major unknowns

If not, ask only the minimum clarifying questions required.

## Stage 1: Intent Contract

Before planning, create a concise **Intent Contract**.

It must include:

* **Executive intent** — problem, why it matters, success criteria
* **DONE_WHEN** — 1-2 line statement of the expected outcome, written like a test assertion. Must be confirmed by the user (or derived from their explicit request). Examples:
    * *"Cancelled bookings have payment_eligible=NULL in DB, ineligible stat card excludes them, truth engine catches drift."*
    * *"Keap poller runs every 2 min, deduplicates against recent webhooks, state tracked in business_settings."*
* **Scope boundaries** — in scope, out of scope, what should remain unchanged
* **Proposed approach** — likely high-level method, no implementation detail
* **Risks / assumptions** — anything that could materially affect outcome
* **Open decisions** — only decisions that are high-impact and cannot be safely assumed

The **DONE_WHEN** is the anchor for the entire workflow. Every downstream agent receives it verbatim. If the user hasn't stated one explicitly, draft it and confirm before proceeding.

Do not start planning until the Intent Contract is stable.

## Stage 2: Planning

Spawn the planner with the user context plus the full Intent Contract:

* `Task(subagent_type="task-workflow:planner", ...)`

Include `DONE_WHEN` prominently in the planner prompt. The planner plans from the agreed intent, not just the raw request.

## Stage 3: Plan review

Immediately send the plan to:

* `Task(subagent_type="task-workflow:plan-reviewer", ...)`

The review must check:

* plan quality
* alignment with the Intent Contract and **DONE_WHEN**
* unresolved assumptions
* risk of technically correct but misaligned output

## Stage 4: Plan gate

If the plan is misaligned with **DONE_WHEN**, return it to the planner.

If high-impact decisions remain, ask the user.

If aligned, move the task to `tasks/active/` and continue to the phase loop.

## Stage 5: Phase loop

For each phase in the plan, run the execute → review cycle:

### 5a. Execute phase

Spawn the executor with the current phase scope:

* `Task(subagent_type="task-workflow:executor", ...)`

**Always include in the executor prompt:**
> **DONE_WHEN:** {the DONE_WHEN statement}

Only send the current phase or revision scope. Do not send the entire plan.

### 5b. Code review

After each phase execution, send to the code reviewer:

* `Task(subagent_type="task-workflow:code-reviewer", ...)`

**Always include in the reviewer prompt:**
> **Verify against DONE_WHEN:** {the DONE_WHEN statement}

Review for:

* correctness
* quality
* regression risk
* completeness
* alignment with the approved plan and **DONE_WHEN**

### 5c. Code review gate

| Result | Action |
|--------|--------|
| **PASS** | Continue to next phase (or final review if last phase) |
| **REVISE** (minor) | You may make small safe fixes yourself (≤30 lines), then re-review |
| **REVISE** (substantial) | Return to executor with specific revision scope |
| **FAIL** after 3 REVISE cycles | → BLOCKED. Report to user. |

Repeat 5a–5c for every phase in the plan.

## Stage 6: CodeRabbit final review

After all phases pass code review, run a holistic review of **only our changes** against current main.

### 6a. Clean the diff

Main may have moved forward since we branched. Rebase to ensure a clean diff:

```bash
# Fetch latest main
git fetch origin main

# Rebase feature onto current main
git rebase origin/main

# If conflicts → resolve, then: git rebase --continue
# If conflicts are non-trivial → BLOCKED, report to user

# Run tests post-rebase to catch integration issues
cd app/backend && python -m pytest tests/ -x -q
cd app/frontend && npx tsc --noEmit

# Force-push rebased branch (safe — feature branch, sole author)
git push --force-with-lease
```

If the project has `./dev pr prep`, run that instead — it handles `_feat_` migration cleanup and tests.

### 6b. Run CodeRabbit locally (MANDATORY — do not skip)

**Use the local CodeRabbit CLI only.** Do NOT create a GitHub PR for the bot, do NOT wait 15min for PR comments, do NOT pull bot comments from `gh api`. The local `--type all` CLI review is the authoritative Stage 6 gate — it is fast, deterministic, and sufficient for cross-phase holistic review.

```bash
cr review --type all --base main --plain
```

**Flags (IMPORTANT):**
- `--type all` — required. `--type committed` produces shallow reviews that miss real issues.
- `--base main` — required. Reviews only feature-branch changes vs main.
- `--plain` — required. The `--agent` structured mode has a confirmed bug that drops findings and returns 0.

This catches cross-phase issues that per-phase reviews miss (inconsistencies between phases, holistic type safety, missed edge cases at boundaries).

If the first run returns "No findings" on a non-trivial diff (>50 lines changed), that's suspicious — verify the diff is non-empty with `git diff --stat main..HEAD` and re-run.

**If CodeRabbit CLI is not installed**, tell the user and ask them to install it (`curl -fsSL https://cli.coderabbit.ai/install.sh | sh`). Do NOT silently skip — this step exists because per-phase reviews have proven insufficient.

### 6c. Process findings

1. Read all findings from the CLI output
2. Fix actionable issues (same rules as code review gate — minor fixes inline, substantial fixes via executor)
3. Dismiss out-of-scope suggestions with a brief rationale
4. If fixes were needed, re-run `cr review --type all --base main --plain` until clean

## Stage 7: Completion

On completion, provide:

### 1. Executive summary
* purpose
* problem solved
* high-level method
* what was included
* what was not included

### 2. Deeper dive
* what changed
* how the work progressed
* key tradeoffs / assumptions
* how the result maps to **DONE_WHEN**

### 3. Technical things to consider
* implementation considerations
* limitations
* follow-up work
* operational / maintenance concerns

### To understand

End with a **To understand** section containing concrete actions the user can take to verify or experience the result.

Examples:

* API changes: give `curl` commands and expected responses
* Bug fixes: show how to reproduce before and verify now
* UI changes: explain restart / redeploy steps, where to go, and what to expect
* Infra / workflow changes: give exact commands, paths, or flows to observe the result

Think: what is the minimum the user can do to directly feel what was completed?

---

## Routing rule

Do not hand control back to the user after planning, review, or each execution phase.

Only return when:

* the task is complete
* the workflow is blocked
* a high-impact decision is required

## Blockers

If blocked, report:

* what is blocked
* why
* what is needed
* what is already done
* what happens next once resolved

Separate blockers into:

* **Technical blockers**
* **Business / product / scope decisions**

## DONE_WHEN propagation rule

Every agent prompt you write MUST include the DONE_WHEN statement. This is the single thread of intent that keeps all agents aligned. If you find yourself writing a prompt without it, stop and add it.

If you find yourself writing implementation code, STOP and spawn the correct executor subagent instead.
