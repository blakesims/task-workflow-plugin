---
name: task-management-init
description: Set up the lightweight tasks/ management system in a project — directory structure, tasks/CLAUDE.md procedures, global task manager, and main.md template. Use when the user asks to set up task management or task tracking in a repository.
user-invocable: true
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/task-management-init/SKILL.md
---

# Task Management System Setup

You are setting up a task management system for AI-assisted development. Follow these instructions exactly.

## Step 1: Create Directory Structure

Create the following directories in the project root:

```bash
mkdir -p tasks/planning tasks/active tasks/ongoing tasks/paused tasks/completed tasks/archived
```

## Step 2: Create tasks/CLAUDE.md

Create `tasks/CLAUDE.md` with this exact content:

```markdown
---
description: Task documentation procedures for AI agents.
---

## AI Task Documentation Procedures

### Core Task Creation Process

For new tasks:
1. Get next Task ID from `tasks/global-task-manager.md`.
2. Create folder: `tasks/planning/TXXX-task-slug/`
3. Copy template: `tasks/main-template.md` → `tasks/planning/TXXX-task-slug/main.md`
4. Update GTM: add a row linking to the task and increment "Next available task id".
5. Update the main.md with the details for the plan, and then update the GTM

### Status / Directory Rules

-  PLANNING → `tasks/planning/`
-  ACTIVE → `tasks/active/`
-  ONGOING → `tasks/ongoing/`
-  PAUSED → `tasks/paused/`
-  COMPLETED → `tasks/completed/`
-  ARCHIVED → `tasks/archived/`

When status changes, move the task folder to the matching directory and update the GTM row (status + link).

Important: When creating tasks they be given a directory and continuously updated.
Eg. create the task in `./tasks/planning/` and move to `./tasks/active/` when started working on it.
Once completed move into `./tasks/completed/`.
Make sure the `./tasks/global-task-manager.md` is kept up-to-date.
```

## Step 3: Create tasks/global-task-manager.md

Create `tasks/global-task-manager.md` with this exact content:

```markdown
# Global Task Manager

Tracks all non-archived work (PLANNING, ACTIVE, PAUSED, ONGOING). Completed items may be moved out of this table.

## Current Tasks

| ID | Task Name | Priority(1-5) | Phases (Done/Total) | Status | Dependencies | Rules Required | Link |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |

Next available task id: T001
(When a new task is created, increment this in the same change.)
Important: When creating tasks they be given a directory and continuously updated.
Eg. create the task in `./tasks/planning/` and move to `./tasks/active/` when started working on it.
Once completed move into `./tasks/completed/`.
Make sure this tracker is kept up to date

---

**Task Status Legend:**
-  **PLANNING**: Defined but not started.
-  **ACTIVE**: Currently being worked on.
-  **ONGOING**: Recurring maintenance/workstream.
-  **PAUSED**: Blocked or intentionally stopped; include reason in task doc.
-  **COMPLETED**: Finished and reviewed.
-  **ARCHIVED**: Stored for reference only.
```

## Step 4: Create tasks/main-template.md

Create `tasks/main-template.md` with this exact content:

```markdown
# Task: [TXXX] - [Brief Task Name/Title]

## 0. Task Summary
-  **Task Name:** <name of task>
-  **Priority:** (1-5; 1 is highest)
-  **Number of Phases:** N
-  **Current Status:** PLANNING | ACTIVE | ONGOING | COMPLETED | PAUSED | ARCHIVED
-  **Dependencies:** <files, services, or other task IDs>
-  **Rules Required:** <rule files that must be followed>
-  **Executor Ref:** <main.md item IDs, e.g., "Deliverable A: S-001, S-003">
-  **Acceptance Criteria:** <bullet list of verifiable outcomes>

## 1. Goal / Objective
_A concise statement (1-2 sentences) describing the desired outcome._

## 2. Overall Status
_Short current state summary._

## 3. Phases Breakdown

| Phase ID | Phase Name / Objective | Status | Deliverable | Link to Details |
| :--- | :--- | :--- | :--- | :--- |
| P1 | [Objective for Phase 1] | Planned | - | - |
| P2 | [Objective for Phase 2] | Planned | - | - |

## 4. Detailed Requirements / Implementation Plan
_Core details of what needs to be done._

## 5. Technical Considerations
_Notes on approaches, architecture, constraints._

## 6. Relevant Rules
_List applicable agent rule files and any key constraints._
```

## Step 5: Verify Setup

Run this command to verify the structure:

```bash
find tasks -type f -name "*.md" | sort
```

Expected output:
```
tasks/CLAUDE.md
tasks/global-task-manager.md
tasks/main-template.md
```

## Done

The task management system is now set up. To create a new task:
1. Read `tasks/CLAUDE.md` for procedures
2. Check `tasks/global-task-manager.md` for the next available ID
3. Copy `tasks/main-template.md` to a new task folder
