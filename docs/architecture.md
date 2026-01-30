# Task Workflow Architecture

> A multi-agent development workflow where an orchestrator spawns Claude Code subprocesses.

## Executive Summary

**The Problem:** Complex development tasks need planning, review, execution, and validation. Doing this in a single conversation loses context and lacks checkpoints.

**The Solution:** A structured workflow with specialized agents, file-based handoffs, and clear gates.

**Key Insights:**
- Claude Code workers are stateless — state lives in files
- The orchestrator maintains memory and coordinates agents
- Agents use `skills` field in frontmatter for deterministic skill loading
- Agents run sequentially (no parallel writes to main.md)

---

## The Two Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR                                  │
│                                                                         │
│  • Receives task from human                                            │
│  • Spawns CC subprocesses for each step                                │
│  • Reads structured outputs, makes gate decisions                      │
│  • Updates global-task-manager.md                                      │
│  • Reports back on blockers/completion                                 │
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
│  • Skills from agent's `skills` field (deterministic injection)        │
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
    ├── global-task-manager.md   # INDEX of all tasks (orchestrator maintains)
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

**Who updates it:** The orchestrator, NOT the CC agents.

After each CC agent run, the orchestrator:
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
│    (Max 3 REVISE cycles → FAIL)     │
└─────────────────────────────────────┘
              │
      ┌───────┼───────┐
      │       │       │
    PASS   REVISE   FAIL
      │       │       │
      │       │       └──→ BLOCKED (needs re-planning)
      │       │
      │       └──→ Back to executor (max 3 times)
      ▼
┌─────────────────────────────────────┐
│ 5. PHASE REVIEW (conditional)       │
│    Agent: phase-reviewer            │
│    Skip if: 0 critical/major issues │
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

| Agent | Skills Loaded | Purpose |
|-------|---------------|---------|
| **planner** | plan, task-workflow | Creates implementation plans |
| **plan-reviewer** | review-plan, task-workflow | Validates plans, finds gaps |
| **executor** | execute, task-workflow | Implements phases |
| **code-reviewer** | review-code, task-workflow | Reviews implementations |
| **phase-reviewer** | review-phase, task-workflow | Bridges phases, applies learnings |

### What Each Agent Outputs

| Agent | Updates main.md | Creates | Sets Status |
|-------|-----------------|---------|-------------|
| **planner** | Plan section | — | PLAN_REVIEW |
| **plan-reviewer** | Plan Review section | plan-review.md | READY / PLANNING / BLOCKED |
| **executor** | Execution Log | — | CODE_REVIEW / BLOCKED |
| **code-reviewer** | Code Review Log | code-review-phase-N.md | EXECUTING_PHASE_N+1 / COMPLETE / BLOCKED |
| **phase-reviewer** | Plan (if learnings) | — | (unchanged) / BLOCKED |

---

## Iteration Limits

To prevent infinite loops:

| Situation | Limit | Action |
|-----------|-------|--------|
| REVISE cycles (code review) | 3 | After 3 REVISE → FAIL → BLOCKED |
| NEEDS_WORK cycles (plan review) | 3 | After 3 NEEDS_WORK → escalate to human |

The orchestrator tracks iteration counts and enforces limits.

---

## BLOCKED Recovery Procedure

When a task is BLOCKED:

1. **Human reviews** the blocker (open questions, failed gate, etc.)
2. **Human answers** questions or provides guidance in main.md
3. **Human updates Status** to the appropriate previous state:
   - If blocked during PLAN_REVIEW → set to `PLANNING` or `PLAN_REVIEW`
   - If blocked during CODE_REVIEW → set to `EXECUTING_PHASE_N`
   - If blocked during execution → set to `EXECUTING_PHASE_N`
4. **Human tells orchestrator** to continue: "Continue T008"
5. **Orchestrator resumes** from the new status

---

## Phase Reviewer Skip Conditions

The phase-reviewer step is **conditional**. Skip it when:
- Previous phase had **0 critical issues** AND **0 major issues**
- No significant learnings to propagate

Run it when:
- Previous phase had issues that might affect future phases
- Patterns were discovered that should update the plan
- The executor made deviations that need documentation

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
    │           (max 3)             │
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

## Orchestrator Logic

To decide what to do, read the **Status** field in main.md:

| Status | Action |
|--------|--------|
| `PLANNING` | Spawn planner agent |
| `PLAN_REVIEW` | Spawn plan-reviewer agent |
| `READY` | Spawn executor for Phase 1 |
| `EXECUTING_PHASE_N` | Check if executor running; if not, spawn for Phase N |
| `CODE_REVIEW` | Spawn code-reviewer agent |
| `BLOCKED` | Report to human with open questions/blocker |
| `COMPLETE` | Move to completed, update global-task-manager, report success |

---

## Directory Transitions

The **orchestrator** (not agents) moves task directories at lifecycle gates:

| Transition | Trigger | Action |
|------------|---------|--------|
| planning → active | Plan review gate: `READY` | `git mv tasks/planning/TXXX-name tasks/active/` |
| active → completed | Final phase code review: `PASS` | `git mv tasks/active/TXXX-name tasks/completed/` |

**Why the orchestrator?** Agents are stateless and focused on their specific job (planning, reviewing, executing). Directory moves are lifecycle operations that span the whole workflow — the orchestrator owns this.

**When to move**:
1. **planning → active**: Immediately after plan-reviewer returns `READY` gate, before spawning executor
2. **active → completed**: After final code-reviewer returns `PASS`, as part of completion wrap-up

**Global task manager updates**:
- Update `global-task-manager.md` link paths after directory moves
- Move row to "Recently Completed" section when task completes
- Commit these changes: `git add tasks/ && git commit -m "chore: complete TXXX"`

---

## Invocation Patterns

Skills are loaded via agent frontmatter `skills` field — no need for `--append-system-prompt`.

### Required Flags

| Flag | Why |
|------|-----|
| `--plugin-dir PATH` | Load plugin agents/skills (not auto-discovered from `~/.claude/plugins/`) |
| `--allowedTools "Edit Read Write"` | `-p` mode skips workspace trust dialog; file ops need explicit permission |
| `--agent task-workflow:NAME` | Plugin agents are namespaced `task-workflow:*` |

### Base Command Template
```bash
claude \
  --plugin-dir ~/.claude/plugins/task-workflow \
  --allowedTools "Edit Read Write" \
  --agent task-workflow:{AGENT} \
  -p '{PROMPT}'
```

### Spawn Planner
```bash
exec pty:true workdir:PROJECT background:true \
  command:"claude --plugin-dir ~/.claude/plugins/task-workflow --allowedTools 'Edit Read Write' --agent task-workflow:planner -p 'Create plan for: {task}. Output to tasks/active/T008-feature/main.md'"
```

### Spawn Plan Reviewer
```bash
exec pty:true workdir:PROJECT background:true \
  command:"claude --plugin-dir ~/.claude/plugins/task-workflow --allowedTools 'Edit Read Write' --agent task-workflow:plan-reviewer -p 'Review tasks/active/T008-feature/main.md'"
```

### Spawn Executor
```bash
exec pty:true workdir:PROJECT background:true \
  command:"claude --plugin-dir ~/.claude/plugins/task-workflow --allowedTools 'Edit Read Write' --agent task-workflow:executor -p 'Execute Phase 2 from tasks/active/T008-feature/main.md'"
```

### Spawn Code Reviewer
```bash
exec pty:true workdir:PROJECT background:true \
  command:"claude --plugin-dir ~/.claude/plugins/task-workflow --allowedTools 'Edit Read Write' --agent task-workflow:code-reviewer -p 'Review Phase 2 execution in tasks/active/T008-feature/main.md'"
```

### With Structured Output
For machine-parseable gate decisions:
```bash
claude \
  --plugin-dir ~/.claude/plugins/task-workflow \
  --allowedTools "Edit Read Write" \
  --agent task-workflow:plan-reviewer \
  --output-format json \
  --json-schema "$(cat schemas/plan-reviewer-output.json)" \
  -p 'Review tasks/active/T008-feature/main.md'
```

### Permission Notes

- **`-p` mode** skips the interactive workspace trust dialog
- Without `--allowedTools`, agents can read/analyze but **cannot write files**
- Add Bash commands to allowlist if agents need them: `--allowedTools "Edit Read Write Bash(git:*) Bash(cargo:*)"`
- For fully trusted environments: `--dangerously-skip-permissions` (sandboxed only)

---

## Agent File Format

Agents require YAML frontmatter with `name` and `description`:

```yaml
---
name: planner
description: Creates implementation plans for tasks
skills:
  - plan
  - task-workflow
---

# Agent prompt content here...
```

### Required Fields

| Field | Description |
|-------|-------------|
| `name` | Unique identifier (lowercase, hyphens) |
| `description` | When to use this agent |

### Optional Fields

| Field | Description |
|-------|-------------|
| `skills` | Skills to inject at startup (deterministic loading) |

See [Claude Code subagents documentation](https://code.claude.com/docs/sub-agents) for additional optional fields like `tools`, `model`, and `permissionMode`.

---

## Quick Reference

### Start a Task
1. Create `tasks/active/T00N-name/main.md` with Task section
2. Set Status: `PLANNING`
3. Tell orchestrator: "Start T00N"

### Check Progress
1. Read `tasks/active/T00N-name/main.md`
2. Check Status field
3. Check relevant logs

### Resume After Blocker
1. Answer open questions in main.md
2. Update Status to appropriate step (see BLOCKED Recovery)
3. Tell orchestrator: "Continue T00N"

---

## Design Principles

1. **Single source of truth:** main.md is authoritative
2. **Stateless workers:** CC invocations are independent
3. **File-based handoffs:** State lives in files, not memory
4. **Clear gates:** Each step has pass/fail criteria
5. **Iteration limits:** Prevent infinite loops (3 REVISE max)
6. **Human in the loop:** Blockers surface to human
7. **Sequential execution:** One agent at a time (no conflicts)
8. **Audit trail:** Supporting docs preserve details
