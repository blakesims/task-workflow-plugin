# Task Workflow Plugin

A Claude Code plugin for intent-led, reviewed multi-agent development workflows.

## Overview

The canonical entry point is:

```text
/task-workflow:task-start
```

`/task-workflow:start` remains as a compatibility alias.

The orchestrator forms an Intent Contract and `DONE_WHEN`, optionally hardens intent, chooses current branch / feature branch / worktree from repository context, and routes the task into a lane: **quickfix** (small bounded change — planning skipped, code review kept) or **planned** (phased plan with review gates). Specialist agents then run through durable review gates:

```
Human → Planner → Plan Reviewer → GATE → Executor → Code Reviewer → ...
                        ↓                               ↓
                    BLOCKED                         REVISE/FAIL
                  (questions)                      (back to executor/planner)
```

## Installation

### Local Development
```bash
claude --plugin-dir /path/to/task-workflow-plugin
```

### From Marketplace
```bash
claude plugin marketplace add blakesims/task-workflow-plugin
claude plugin install task-workflow@task-workflow-marketplace
```

## Agents

| Agent | Purpose | Gate Decisions |
|-------|---------|----------------|
| `planner` | Creates implementation plans | → PLAN_REVIEW |
| `plan-reviewer` | Reviews plans, validates questions | READY / NEEDS_WORK / NOT_READY |
| `executor` | Implements phases | COMPLETE / BLOCKED |
| `code-reviewer` | Reviews implementations | PASS / REVISE / FAIL |

## Task Structure

Tasks live in a `tasks/` directory:

```
tasks/
├── global-task-manager.md   # INDEX of all tasks (orchestrator maintains)
├── active/
│   └── T008-feature/
│       ├── main.md              # Living task document
│       ├── plan-review.md       # Detailed plan review
│       └── code-review-phase-1.md
├── planning/
├── paused/
└── completed/
```

### Templates

The `templates/` directory contains:
- `global-task-manager.md` — Initialize your task index
- `main.md` — Template for new task documents

Initialize a project's task files with:

```bash
mkdir -p tasks/{planning,active,paused,completed}
cp templates/main.md tasks/main-template.md
cp templates/global-task-manager.md tasks/global-task-manager.md
cp templates/CLAUDE.md tasks/CLAUDE.md
```

### main.md Format

```markdown
# T008: Feature Name

## Meta
- **Status:** PLANNING | PLAN_REVIEW | READY | EXECUTING_PHASE_1 | CODE_REVIEW | COMPLETE | BLOCKED
- **Created:** 2026-01-28
- **Last Updated:** 2026-01-28

## Task
{Original task description}

## Plan
{Planner fills this}

## Plan Review
{Plan Reviewer fills this}

## Execution Log
{Executor fills this per phase}

## Code Review Log
{Code Reviewer fills this per phase}

## Completion
{Final summary}
```

## Git strategy

The workflow is branch-agnostic. It does not impose `main`, feature branches, or worktrees globally. The parent records a runtime strategy from repository instructions, Git state, concurrency, and delivery expectations while preserving clean baselines and explicit reviewed-path staging.

Push, PR, merge, deployment, force-push, and branch deletion require explicit authorization or an already-authorized repository workflow.

## Structured Output

External CLI orchestration can request structured JSON conforming to schemas in `schemas/`; the canonical interactive task-start flow uses durable Markdown task artifacts. JSON mode enables:
- **Enforcement** — Agents must confirm checklist completion
- **Gate clarity** — Orchestrator parses gate decisions directly
- **Audit trail** — JSON outputs can be logged

Example usage:
```bash
claude --agent task-workflow:planner \
  --output-format json \
  --json-schema "$(cat schemas/planner-output.json)" \
  -p "Create plan for: {task}"
```

## Skills

Canonical orchestration skills:

- `task-start` — Intent Contract, optional hardening, handoff packet, runtime strategy, agent gates, and completion
- `intent-harden` — optional expansion/compression/stress-test pass before planning
- `start` — compatibility alias for `task-start`
- `task-workflow` — shared task ledger and Git-safety contract

The agent role instructions live in the agent definitions themselves (`agents/*.md`); there are no separate per-role skills.

## Self-Improvement

The `logs/observations.jsonl` file tracks workflow observations:

```jsonl
{"timestamp": "...", "agent": "executor", "observation": "...", "severity": "major"}
```

Review observations periodically to refine agents and schemas.

## Documentation

- [Architecture](./architecture.md) — Full system design and invocation patterns
- [Lessons Learned](./lessons-learned.md) — First live test results and gotchas

## Validation

Before release or PR review:

```bash
python3 scripts/validate-plugin.py
claude plugin validate .
```

## License

MIT
