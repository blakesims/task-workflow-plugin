---
name: task-workflow
description: >
  Understand the multi-agent task workflow structure. Reference this when working
  on tasks in a tasks/ directory. Defines main.md format and agent responsibilities.
---

# Task Workflow

## Directory Structure

```
tasks/
├── active/          # Currently being worked on
│   └── T008-feature/
│       ├── main.md              # THE living task document
│       ├── plan-review.md       # Detailed plan review (if exists)
│       └── code-review-phase-1.md  # Detailed code reviews per phase
├── planning/        # Tasks being planned
├── paused/          # On hold
├── completed/       # Done
└── archived/        # Old/cancelled
```

## main.md Structure

The `main.md` file is the **single source of truth** for a task. All agents update it.

```markdown
# T{NNN}: {Task Title}

## Meta
- **Status:** PLANNING | PLAN_REVIEW | READY | EXECUTING_PHASE_{N} | CODE_REVIEW | COMPLETE | BLOCKED
- **Created:** {date}
- **Last Updated:** {date}
- **Blocked Reason:** {if BLOCKED, why}

## Task
{Original task description from human}

---

## Plan

### Objective
{1-2 sentence outcome from user's perspective}

### Scope
- **In:** {included}
- **Out:** {excluded}

### Phases

#### Phase 1: {title}
- **Objective:** {what this achieves}
- **Tasks:**
  - [ ] Task 1.1: {description}
  - [ ] Task 1.2: {description}
- **Acceptance Criteria:**
  - [ ] AC1: {verifiable outcome}
- **Files:** {files to modify}

#### Phase 2: {title}
{same structure}

### Decision Matrix

#### Open Questions (Need Human Input)
| # | Question | Options | Impact | Resolution |
|---|----------|---------|--------|------------|
| 1 | {question} | A) ... B) ... | {impact} | OPEN / {answer} |

#### Decisions Made (Autonomous)
| Decision | Choice | Rationale |
|----------|--------|-----------|
| {decision} | {choice} | {why} |

---

## Plan Review
- **Gate:** PENDING | READY | NEEDS_WORK | NOT_READY
- **Reviewed:** {date}
- **Summary:** {1-2 sentence assessment}
- **Issues:** {count} critical, {count} major, {count} minor
- **Open Questions Finalized:** {list questions needing human input}

→ Details: `plan-review.md`

---

## Execution Log

### Phase 1: {title}
- **Status:** PENDING | IN_PROGRESS | COMPLETE | BLOCKED
- **Started:** {date}
- **Completed:** {date}
- **Commits:** `abc123`, `def456`
- **Files Modified:**
  - `path/file.ts` — {what changed}
- **Notes:** {executor observations}
- **Blockers:** {if any}

### Phase 2: {title}
{same structure}

---

## Code Review Log

### Phase 1
- **Gate:** PENDING | PASS | REVISE | FAIL
- **Reviewed:** {date}
- **Issues:** {count} critical, {count} major, {count} minor
- **Summary:** {brief assessment}

→ Details: `code-review-phase-1.md`

### Phase 2
{same structure}

---

## Completion
- **Completed:** {date}
- **Summary:** {what was delivered}
- **Learnings:** {for future tasks}
```

## Agent Responsibilities

| Agent | Reads | Updates in main.md | Creates |
|-------|-------|-------------------|---------|
| Planner | Task section | Plan section, Status→PLAN_REVIEW | — |
| Plan Reviewer | Plan section | Plan Review section, Status→READY/BLOCKED | plan-review.md |
| Executor | Plan (current phase) | Execution Log section, Status→CODE_REVIEW | — |
| Code Reviewer | Execution Log, git diff | Code Review Log section, Status→next | code-review-phase-N.md |
| Phase Reviewer | Code Review Log, next phase | May update Plan with learnings | — |

## Status Flow

```
PLANNING → PLAN_REVIEW → READY → EXECUTING_PHASE_1 → CODE_REVIEW 
                ↓                        ↓               ↓
            BLOCKED              BLOCKED (stuck)    REVISE (back to executor)
                                                         ↓
                                                       FAIL (re-plan)
     
After CODE_REVIEW PASS:
  → More phases? → EXECUTING_PHASE_N
  → Last phase? → COMPLETE
```

## Orchestrator (Lem) Checks Status

To know what to do, read the **Status** field:
- `PLANNING` → spawn planner
- `PLAN_REVIEW` → spawn plan reviewer  
- `READY` → start execution, spawn executor for Phase 1
- `EXECUTING_PHASE_N` → executor working (or spawn if not running)
- `CODE_REVIEW` → spawn code reviewer
- `BLOCKED` → report to human with open questions
- `COMPLETE` → report success
