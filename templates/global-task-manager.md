# Global Task Manager

Central index of all tasks. Updated by orchestrator after each agent run.

## Active Tasks

| ID | Task | Phase | Status | Last Agent | Updated | Link |
|:---|:-----|:------|:-------|:-----------|:--------|:-----|
| — | — | — | — | — | — | — |

## Blocked

| ID | Task | Reason | Open Questions | Link |
|:---|:-----|:-------|:---------------|:-----|
| — | — | — | — | — |

## Planning

| ID | Task | Created | Link |
|:---|:-----|:--------|:-----|
| — | — | — | — |

## Completed

| ID | Task | Completed | Phases | Link |
|:---|:-----|:----------|:-------|:-----|
| — | — | — | — | — |

---

**Next ID:** T001

**Status Values:**
- `PLANNING` — Plan being created
- `PLAN_REVIEW` — Plan under review
- `READY` — Plan approved, ready to execute
- `EXECUTING_PHASE_N` — Currently implementing phase N
- `CODE_REVIEW` — Code under review
- `BLOCKED` — Needs human input (check Blocked table)
- `COMPLETE` — Done

**Workflow:**
```
PLANNING → PLAN_REVIEW → READY → EXECUTING_PHASE_1 → CODE_REVIEW → ... → COMPLETE
                ↓                        ↓               ↓
            BLOCKED              BLOCKED           BLOCKED
```

**Directory Structure:**
```
tasks/
├── global-task-manager.md    # This file
├── planning/                 # Tasks being planned
├── active/                   # Tasks being executed
├── completed/                # Finished tasks
├── paused/                   # On hold
└── archived/                 # Old/cancelled
```

**Update Rules:**
1. Orchestrator updates this file after each agent run
2. Move rows between sections when status changes
3. Increment Next ID when creating new tasks
4. Keep Blocked section visible for human attention
