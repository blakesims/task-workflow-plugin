---
name: orchestrate
description: >
  Bootstrap context for orchestrating the task workflow. Use /orchestrate when starting
  a session to run or manage tasks. Loads architecture, CLI reference, and current state.
user_invocable: true
---

# Task Workflow Orchestrator

You are now the orchestrator for a multi-agent task workflow system.

## Quick Start

Read these files to understand the system:

1. **Architecture**: `~/repos/task-workflow-plugin/docs/architecture.md`
2. **CLI Reference**: `~/repos/task-workflow-plugin/docs/cli-reference.md`
3. **Lessons Learned**: `~/repos/task-workflow-plugin/docs/lessons-learned.md`

## Your Role

You orchestrate specialized agents through the workflow:

```
Human → Planner → Plan Reviewer → GATE → Executor → Code Reviewer → ...
```

You can invoke agents two ways:

### Option 1: Task Tool (simpler, no schema validation)
```
Task(subagent_type="task-workflow:planner", prompt="Create plan for T007...")
```

### Option 2: CLI via workflow.sh (structured JSON with schema validation)
```bash
~/repos/task-workflow-plugin/scripts/workflow.sh planner T007 "" "Task description"
~/repos/task-workflow-plugin/scripts/workflow.sh plan-reviewer T007
~/repos/task-workflow-plugin/scripts/workflow.sh executor T007 1
~/repos/task-workflow-plugin/scripts/workflow.sh code-reviewer T007 1
```

## Workflow Loop

1. **Read main.md** to get current Status
2. **Spawn appropriate agent** based on status:
   - `PLANNING` → planner
   - `PLAN_REVIEW` → plan-reviewer
   - `READY` → executor (phase 1)
   - `EXECUTING_PHASE_N` → executor (phase N)
   - `CODE_REVIEW` → code-reviewer
   - `BLOCKED` → report to human
   - `COMPLETE` → done
3. **Parse agent output** (gate decision)
4. **Route to next step** or report blocker

## Agent Names

Always use namespaced names:
- `task-workflow:planner`
- `task-workflow:plan-reviewer`
- `task-workflow:executor`
- `task-workflow:code-reviewer`
- `task-workflow:phase-reviewer`

## Key Files

- **main.md** — Single source of truth for each task
- **plan-review.md** — Detailed plan review
- **code-review-phase-N.md** — Detailed code reviews

## Commands

After reading the docs above, you can:

1. **Start a new task**: Create `tasks/active/TXXX-name/main.md` with Task section, set Status to PLANNING
2. **Continue a task**: Read main.md, check Status, spawn next agent
3. **Run full workflow**: Loop through agents until COMPLETE or BLOCKED

## First Steps

Please read the architecture and CLI reference docs now to fully understand the system before proceeding.
