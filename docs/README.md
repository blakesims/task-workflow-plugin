# Task Workflow Plugin

A Claude Code plugin for multi-agent task workflows with planning, review, execution, and code review.

## Overview

This plugin provides a structured development workflow where specialized agents handle different phases of task completion:

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

### From Marketplace (coming soon)
```
/plugin install task-workflow
```

## Agents

| Agent | Purpose | Gate Decisions |
|-------|---------|----------------|
| `planner` | Creates implementation plans | → PLAN_REVIEW |
| `plan-reviewer` | Reviews plans, validates questions | READY / NEEDS_WORK / NOT_READY |
| `executor` | Implements phases | COMPLETE / BLOCKED |
| `code-reviewer` | Reviews implementations | PASS / REVISE / FAIL |
| `phase-reviewer` | Bridges phases, applies learnings | GO / UPDATE / BLOCK |

## Task Structure

Tasks live in a `tasks/` directory:

```
tasks/
├── global-task-manager.md   # INDEX of all tasks (Lem maintains)
├── active/
│   └── T008-feature/
│       ├── main.md              # Living task document
│       ├── plan-review.md       # Detailed plan review
│       └── code-review-phase-1.md
├── planning/
├── completed/
└── archived/
```

### Templates

The `templates/` directory contains:
- `global-task-manager.md` — Initialize your task index
- `main.md` — Template for new task documents

Copy these to your project's `tasks/` directory to get started.

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

## Structured Output

Agents produce structured JSON output conforming to schemas in `schemas/`. This enables:
- **Enforcement** — Agents must confirm checklist completion
- **Gate clarity** — Orchestrator parses gate decisions directly
- **Audit trail** — JSON outputs can be logged

Example usage:
```bash
claude --agent planner \
  --output-format json \
  --json-schema "$(cat schemas/planner-output.json)" \
  -p "Create plan for: {task}"
```

## Skills

Skills are loaded automatically via agent frontmatter:
- `plan` — Planning workflow and templates
- `execute` — Execution workflow
- `review-plan` — Plan review checklist
- `review-code` — Code review checklist
- `review-phase` — Phase transition workflow
- `task-workflow` — Shared knowledge about task structure

## Self-Improvement

The `logs/observations.jsonl` file tracks workflow observations:

```jsonl
{"timestamp": "...", "agent": "executor", "observation": "...", "severity": "major"}
```

Review observations periodically to refine agents and schemas.

## License

MIT
