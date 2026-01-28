# Task Workflow Architecture

> A multi-agent development workflow where Lem (Clawdbot) orchestrates Claude Code subprocesses.

## Executive Summary

**The Problem:** Complex development tasks need planning, review, execution, and validation. Doing this in a single conversation loses context and lacks checkpoints.

**The Solution:** A structured workflow with specialized agents, file-based handoffs, and clear gates.

**Key Insights:**
- Claude Code workers are stateless — state lives in files
- Lem is the orchestrator and memory
- Agents use `skills` field for deterministic skill loading (not description matching)
- Subagents cannot spawn subagents — workflow must be flat

---

## The Two Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          LEM (ORCHESTRATOR)                             │
│                                                                         │
│  • Receives task from human                                            │
│  • Spawns CC subprocesses for each step                                │
│  • Reads outputs, makes gate decisions                                 │
│  • Reports back on blockers/completion                                 │
│                                                                         │
│  Context: ~/clawd/memory/*, conversation history                       │
│  Tools: exec (pty), process, sessions_spawn, web_search, etc.          │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             │ exec pty:true workdir:PROJECT
                             │ command:"claude --agent X -p 'task'"
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     CLAUDE CODE (STATELESS WORKERS)                     │
│                                                                         │
│  Each invocation is independent. No memory between calls.              │
│                                                                         │
│  Context per invocation:                                               │
│  • PROJECT/CLAUDE.md (auto-loaded from workdir)                        │
│  • ~/.claude/skills/* (auto-loaded by description matching)            │
│  • ~/.claude/agents/X.md (via --agent X flag)                          │
│  • Files explicitly read during execution                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
project/
├── CLAUDE.md                    # Project conventions (CC reads this)
└── tasks/
    ├── CLAUDE.md                # Task-specific conventions/templates
    ├── global-task-manager.md   # INDEX of all tasks (Lem maintains this)
    ├── active/
    │   └── T008-feature/
    │       ├── main.md              # THE living task document
    │       ├── plan-review.md       # Detailed plan review
    │       └── code-review-phase-1.md
    ├── planning/                # Tasks being planned
    ├── paused/                  # On hold
    ├── completed/               # Done
    └── archived/                # Old/cancelled
```

## Global Task Manager

The `global-task-manager.md` file is the **index of all tasks**. It provides:
- Quick overview of all task statuses
- Links to task directories
- Blocked tasks highlighted for human attention
- Next available task ID

**Who updates it:** Lem (orchestrator), NOT the CC agents.

After each CC agent run, Lem:
1. Reads the structured JSON output
2. Updates the relevant row in global-task-manager.md
3. Moves rows between sections if status changed (e.g., active → completed)

This keeps CC agents simple and avoids conflicts.

---

## The main.md Document

The `main.md` file is the **single source of truth** for a task. All agents update it.

```markdown
# T008: Feature Name

## Meta
- **Status:** PLANNING | PLAN_REVIEW | READY | EXECUTING_PHASE_1 | CODE_REVIEW | COMPLETE | BLOCKED
- **Created:** 2026-01-28
- **Last Updated:** 2026-01-28
- **Blocked Reason:** {if BLOCKED}

## Task
{Original description from human}

---

## Plan
{Planner fills this}

### Objective
### Scope
### Phases
### Decision Matrix

---

## Plan Review
{Plan Reviewer fills this}
- **Gate:** READY | NEEDS_WORK | NOT_READY
- **Open Questions Finalized:** {list}
→ Details: plan-review.md

---

## Execution Log
{Executor fills this per phase}

### Phase 1: {title}
- **Status:** COMPLETE | BLOCKED
- **Commits:** ...
- **Files Modified:** ...

---

## Code Review Log
{Code Reviewer fills this per phase}

### Phase 1
- **Gate:** PASS | REVISE | FAIL
→ Details: code-review-phase-1.md

---

## Completion
{Final summary when done}
```

---

## The Workflow

```
Human: "Implement feature X"
              │
              ▼
┌─────────────────────────────────────┐
│ 1. PLAN                             │
│    Agent: planner                   │
│    Updates: main.md Plan section    │
│    Sets: Status → PLAN_REVIEW       │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ 2. REVIEW PLAN                      │
│    Agent: plan-reviewer             │
│    Updates: main.md Plan Review     │
│    Creates: plan-review.md          │
│    Gate: READY / NEEDS_WORK / NOT_READY
└─────────────────────────────────────┘
              │
      ┌───────┴───────┐
      │               │
   READY         NEEDS_WORK/NOT_READY
      │               │
      │          Back to planner
      │          or BLOCKED with questions
      ▼
┌─────────────────────────────────────┐
│ 3. EXECUTE PHASE N                  │
│    Agent: executor                  │
│    Updates: main.md Execution Log   │
│    Sets: Status → CODE_REVIEW       │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ 4. CODE REVIEW                      │
│    Agent: code-reviewer             │
│    Updates: main.md Code Review Log │
│    Creates: code-review-phase-N.md  │
│    Gate: PASS / REVISE / FAIL       │
└─────────────────────────────────────┘
              │
      ┌───────┼───────┐
      │       │       │
    PASS   REVISE   FAIL
      │       │       │
      │       │       └──→ BLOCKED (needs re-planning)
      │       │
      │       └──→ Back to executor with feedback
      ▼
┌─────────────────────────────────────┐
│ 5. PHASE REVIEW (optional)          │
│    Agent: phase-reviewer            │
│    Updates: Plan if learnings apply │
│    Gate: GO / BLOCK                 │
└─────────────────────────────────────┘
              │
              ▼
      More phases? ──→ Back to EXECUTE PHASE N+1
              │
              └──→ Last phase? → COMPLETE
```

---

## Agent Responsibilities

| Agent | Skills Loaded | Tools | Model | Permission |
|-------|---------------|-------|-------|------------|
| **planner** | plan, task-workflow | Read, Glob, Grep, Bash | sonnet | default |
| **plan-reviewer** | review-plan, task-workflow | Read, Glob, Grep, Bash | sonnet | plan (read-only) |
| **executor** | execute, task-workflow | All | sonnet | acceptEdits |
| **code-reviewer** | review-code, task-workflow | Read, Glob, Grep, Bash | sonnet | plan (read-only) |
| **phase-reviewer** | review-phase, task-workflow | All | haiku | default |

### What Each Agent Outputs

| Agent | Updates main.md | Creates |
|-------|-----------------|---------|
| **planner** | Plan section, Status→PLAN_REVIEW | — |
| **plan-reviewer** | Plan Review section, Status | plan-review.md |
| **executor** | Execution Log, Status | — |
| **code-reviewer** | Code Review Log, Status | code-review-phase-N.md |
| **phase-reviewer** | Plan (if learnings) | — |

---

## Status State Machine

```
PLANNING ─────────────────────────────────────────────┐
    │                                                  │
    ▼                                                  │
PLAN_REVIEW                                            │
    │                                                  │
    ├──[NEEDS_WORK]───────────────────────────────────┘
    │
    ├──[NOT_READY + questions]──→ BLOCKED
    │
    └──[READY]──→ READY
                    │
                    ▼
              EXECUTING_PHASE_1
                    │
                    ▼
                CODE_REVIEW
                    │
    ┌───────────────┼───────────────┐
    │               │               │
  [PASS]        [REVISE]        [FAIL]
    │               │               │
    │               └──→ EXECUTING_PHASE_N (retry)
    │                               │
    │                               └──→ BLOCKED
    ▼
More phases? ──→ EXECUTING_PHASE_N+1 ──→ CODE_REVIEW ──→ ...
    │
    └──→ COMPLETE
```

---

## Lem's Orchestration Logic

To decide what to do, Lem reads the **Status** field in main.md:

| Status | Lem's Action |
|--------|--------------|
| `PLANNING` | Spawn planner agent |
| `PLAN_REVIEW` | Spawn plan-reviewer agent |
| `READY` | Spawn executor for Phase 1 |
| `EXECUTING_PHASE_N` | Check if executor running; if not, spawn |
| `CODE_REVIEW` | Spawn code-reviewer agent |
| `BLOCKED` | Report to human with open questions/blocker |
| `COMPLETE` | Report success to human |

---

## Invocation Patterns

Since agents have `skills` field in frontmatter, skills are loaded automatically. No need for `--append-system-prompt`.

### Spawn Planner
```bash
exec pty:true workdir:PROJECT background:true \
  command:"claude --agent planner -p 'Create plan for: {task}. Output to tasks/active/T008-feature/main.md'"
```

### Spawn Plan Reviewer
```bash
exec pty:true workdir:PROJECT background:true \
  command:"claude --agent plan-reviewer -p 'Review tasks/active/T008-feature/main.md'"
```

### Spawn Executor
```bash
exec pty:true workdir:PROJECT background:true \
  command:"claude --agent executor -p 'Execute Phase 2 from tasks/active/T008-feature/main.md'"
```

### Spawn Code Reviewer
```bash
exec pty:true workdir:PROJECT background:true \
  command:"claude --agent code-reviewer -p 'Review Phase 2 execution in tasks/active/T008-feature/main.md'"
```

### With Structured Output (optional)
For machine-parseable gate decisions:
```bash
claude --agent plan-reviewer \
  --output-format json \
  --json-schema '{"type":"object","properties":{"gate":{"enum":["READY","NEEDS_WORK","NOT_READY"]},"issues":{"type":"array"}},"required":["gate"]}' \
  -p 'Review tasks/active/T008-feature/main.md'
```

---

## Context Flow

### What Each Agent Sees

**Planner:**
- Task description (from prompt)
- PROJECT/CLAUDE.md, tasks/CLAUDE.md
- Codebase (via Read/Bash)
- ~/.claude/skills/plan/SKILL.md (auto-triggered)
- ~/.claude/agents/planner.md (via --agent)

**Plan Reviewer:**
- main.md (the plan)
- ~/.claude/skills/review-plan/SKILL.md
- ~/.claude/agents/plan-reviewer.md

**Executor:**
- main.md (current phase)
- Codebase (Read/Write/Bash)
- ~/.claude/skills/execute/SKILL.md
- ~/.claude/agents/executor.md

**Code Reviewer:**
- main.md (execution log)
- Git state (diff, log)
- ~/.claude/skills/review-code/SKILL.md
- ~/.claude/agents/code-reviewer.md

### What Persists Between Invocations

**Files (the handoff mechanism):**
- main.md — the living document
- plan-review.md — detailed review
- code-review-phase-N.md — detailed reviews
- Git commits — the actual code

**Lem's memory:**
- Conversation with human
- Which task is active
- What step we're on

**NOT persisted:**
- CC session memory (each invocation is stateless)
- CC's "thinking" from previous steps

---

## When to Return to Human

**Blockers (BLOCKED status):**
- Plan has open questions needing input
- Code review FAIL (needs re-planning)
- Executor hit unexpected blocker

**Completion:**
- All phases executed and passed
- Summary of what was delivered

**NOT blockers (continue autonomously):**
- Plan review NEEDS_WORK (planner can fix)
- Code review REVISE (executor can fix)

---

## File Locations

```
~/.claude/
├── agents/
│   ├── planner.md
│   ├── plan-reviewer.md
│   ├── executor.md
│   ├── code-reviewer.md
│   └── phase-reviewer.md
├── skills/
│   ├── task-workflow/SKILL.md   # Overview of task structure
│   ├── plan/SKILL.md
│   ├── review-plan/SKILL.md
│   ├── execute/SKILL.md
│   ├── review-code/SKILL.md
│   └── review-phase/SKILL.md
```

## Agent File Format

Agents require YAML frontmatter with `name` and `description`. Optional fields provide more control:

```yaml
---
name: planner
description: Creates implementation plans for tasks
skills:                    # Skills injected at startup (deterministic!)
  - plan
  - task-workflow
tools: Read, Glob, Grep, Bash    # Allowed tools (inherits all if omitted)
disallowedTools: Write, Edit     # Tools to deny
model: sonnet                     # sonnet, opus, haiku, or inherit
permissionMode: plan              # default, acceptEdits, dontAsk, bypassPermissions, plan
---

# Agent prompt content here...
```

### Key Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (lowercase, hyphens) |
| `description` | Yes | When to use this agent |
| `skills` | No | Skills to inject at startup |
| `tools` | No | Allowed tools (inherits all if omitted) |
| `disallowedTools` | No | Tools to deny |
| `model` | No | Model to use (default: inherit) |
| `permissionMode` | No | Permission handling mode |

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Standard permission prompts |
| `acceptEdits` | Auto-accept file edits |
| `dontAsk` | Auto-deny prompts (allowed tools still work) |
| `bypassPermissions` | Skip all checks (use with caution) |
| `plan` | Read-only exploration mode |

---

## Quick Reference

### Start a Task
1. Create `tasks/active/T00N-name/main.md` with Task section
2. Set Status: `PLANNING`
3. Tell Lem: "Start T00N"

### Check Progress
1. Read `tasks/active/T00N-name/main.md`
2. Check Status field
3. Check relevant logs

### Resume After Blocker
1. Answer open questions in main.md
2. Update Status to appropriate step
3. Tell Lem: "Continue T00N"

---

## Design Principles

1. **Single source of truth:** main.md is authoritative
2. **Stateless workers:** CC invocations are independent
3. **File-based handoffs:** State lives in files, not memory
4. **Clear gates:** Each step has pass/fail criteria
5. **Human in the loop:** Blockers surface to human
6. **Audit trail:** Supporting docs preserve details
