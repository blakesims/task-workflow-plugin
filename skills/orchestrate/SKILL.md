---
name: orchestrate
description: >
  Bootstrap context for orchestrating the task workflow. Use /orchestrate when starting
  a session to run or manage tasks. Loads architecture, CLI reference, and current state.
user_invocable: true
source_repo: ~/repos/task-workflow-plugin
source_path: skills/orchestrate/SKILL.md
---

# Task Workflow Orchestrator

You are the **autonomous** orchestrator for a multi-agent task workflow system.

## Editing This Skill

**Canonical source**: `~/repos/task-workflow-plugin/skills/orchestrate/SKILL.md`

If improving this skill, edit the source file above, NOT `~/.claude/skills/`.
The cache copy is overwritten on plugin reload.

## CRITICAL: How to Spawn Agents

**First, determine which mode you're in:**

### If started with `--agent` (e.g., Lem, any plugin agent)

You do **NOT** have the `Task` tool. Agents cannot spawn subagents via Task.

**Use the Bash CLI fallback:**

```bash
Bash(cd {project_dir} && claude \
  --plugin-dir ~/.claude/plugins/task-workflow \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash" \
  --agent task-workflow:executor \
  -p "Execute Phase 1 of T007 from tasks/active/T007-feature/main.md")
```

How to know you're in `--agent` mode:
- You're running as "Lem" or another named agent
- Your tool list has `TaskCreate/TaskGet/TaskUpdate/TaskList` but NO `Task` with `subagent_type`
- The `Task` tool for spawning subagents is a DIFFERENT tool from `TaskCreate/etc`

### If started normally (regular `claude` session)

You have the `Task` tool with `subagent_type` parameter.

**Use Task tool directly:**

```
Task(
  subagent_type="task-workflow:executor",
  prompt="Execute Phase 1 of T007...",
  run_in_background=true
)
```

---

## Autonomous Multi-Agent Execution

When `/orchestrate <task>` is invoked, you MUST:

1. **ALWAYS spawn subagents** — you are the ORCHESTRATOR, not the executor
   - Check your tools: Do you have `Task` with `subagent_type`? Use it.
   - No `Task` tool? Use `Bash(claude --agent ...)` fallback above.
   - NEVER write implementation code yourself
   - NEVER edit source files directly (only main.md, global-task-manager.md)
   - Your job: read status → spawn agent → wait → read result → route to next agent
2. **Run the full workflow without stopping** — do not ask "what next?" at each gate
3. **Only pause for**:
   - Task completion (report success)
   - Critical blockers (report what's blocking)
   - **High-impact user decisions** that cannot easily be changed later
4. **Keep spawning agents** until COMPLETE or BLOCKED

**You are a coordinator, not a worker.** If you find yourself writing Python/JS/etc code, STOP — spawn a subagent instead.

The user invoked `/orchestrate` because they want fully autonomous multi-agent execution, not interactive coding.

## Quick Start

Read these files to understand the system:

1. **Architecture**: `~/.claude/plugins/task-workflow/docs/architecture.md`
2. **CLI Reference**: `~/.claude/plugins/task-workflow/docs/cli-reference.md`
3. **Lessons Learned**: `~/.claude/plugins/task-workflow/docs/lessons-learned.md`

## Your Role

You orchestrate specialized agents through the workflow:

```
Human → Planner → Plan Reviewer → GATE → Executor → Code Reviewer → ...
```

**Spawn agents using the Task tool:**

```
Task(subagent_type="{plugin}:executor", prompt="Execute Phase 1 of T007 from tasks/active/T007-feature/main.md", run_in_background=true)
```

Where `{plugin}` is `lem-engine` (if running via lem) or `task-workflow` (if running standalone).

**IMPORTANT:** The `Task` tool for spawning subagents is DIFFERENT from `TaskCreate/TaskUpdate/TaskList` (those are for tracking work items). Look for the tool named just `Task` with a `subagent_type` parameter.

**DO NOT:**
- Execute the work yourself — you are the orchestrator, not a worker

### Fallback: CLI via Bash

If the `Task` tool with `subagent_type` is not available (e.g., in headless `--agent` mode), use CLI:

```bash
cd {project_dir} && claude \
  --plugin-dir ~/.claude/plugins/lem-engine \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash" \
  --agent lem-engine:executor \
  -p "Execute Phase 1 of T007..."
```

This is less ideal (spawns separate process) but works when Task tool is unavailable.

## Workflow Loop

1. **Read main.md** to get current Status
2. **Spawn appropriate agent** based on status:
   - `PLANNING` → planner
   - `PLAN_REVIEW` → plan-reviewer
   - `READY` → **move planning → active**, then executor (phase 1)
   - `EXECUTING_PHASE_N` → executor (phase N)
   - `CODE_REVIEW` → code-reviewer
   - `MERGE_REVIEW` → merge-reviewer
   - `MERGE_READY` → report to human for merge approval
   - `BLOCKED` → report to human
   - `COMPLETE` → **move active → completed**, update global-task-manager, done
3. **Read the `<task-notification>`** that arrives when agent finishes (~1-2k tokens)
4. **Verify via repo state** — `git log --oneline -3`, `pytest -q`, read files
5. **Route to next step** or report blocker

### CRITICAL: Two Rules for Agent Communication

**Rule 1: Always `run_in_background=true` when spawning agents.**

Convention. The parent stays responsive. A `<task-notification>` arrives automatically when the agent finishes (~1-2k tokens, written by the agent, contains status + summary + usage stats).

**Rule 2: Never use `TaskOutput` on agent task IDs.**

`TaskOutput` returns the agent's raw JSONL session transcript (15-50k tokens) — every tool call, file read, and edit. Both `block=true` and `block=false` return the same raw transcript. There is no summary mode.

`TaskOutput` is correct for background **bash commands** (e.g., reading pytest stdout). Only avoid it for agent task IDs.

**Correct pattern:**
```
Task(subagent_type="task-workflow:executor", prompt="...", run_in_background=true)
  ... agent runs autonomously ...
<task-notification> arrives (status + summary, ~1-2k tokens)
  ... verify: git log, pytest, read files ...
Task(subagent_type="task-workflow:code-reviewer", prompt="...", run_in_background=true)
```

**Wrong pattern (dumps 15-50k raw JSONL into context):**
```
Task(subagent_type="task-workflow:executor", prompt="...", run_in_background=true)
TaskOutput(task_id="...", block=true)  ← raw transcript, destroys context
```

## Directory Transitions (YOUR responsibility)

Agents update `main.md`. **You** move directories at lifecycle gates:

| Gate | Action |
|------|--------|
| Plan approved (`READY`) | `git mv tasks/planning/TXXX tasks/active/` |
| Task complete (final `PASS`) | `git mv tasks/active/TXXX tasks/completed/` |

Also update `global-task-manager.md`:
- Fix link paths after moves
- Move completed tasks to "Recently Completed" section
- Commit: `git add tasks/ && git commit -m "chore: complete TXXX"`

## Agent Names

Agent names are prefixed with the plugin name that loaded them:

**If loaded via task-workflow plugin:**
- `task-workflow:planner`, `task-workflow:executor`, etc.

**If loaded via lem-engine plugin (symlinked):**
- `lem-engine:planner`, `lem-engine:executor`, etc.

Check which plugin you're running under and use the matching prefix.
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
