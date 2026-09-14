---
name: task-management-init
description: Set up the lightweight tasks/ management system in a project — directory structure, tasks/CLAUDE.md procedures, global task manager, and main.md template. Use when the user asks to set up task management or task tracking in a repository.
user-invocable: true
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/task-management-init/SKILL.md
---

# Task Management System Setup

You are setting up the task-workflow ledger for a project. The canonical templates ship with the plugin — copy them; never write ledger files from memory. This is the same bootstrap `/task-workflow:task-start` performs in Stage 0, offered standalone so a project can be initialized before any task runs.

## Step 1: Check for an existing ledger

If `tasks/` does not exist, go to Step 2.

If `tasks/` already exists, do not overwrite anything silently:

1. Read `tasks/main-template.md`. If it contains `## Intent Contract`, `DONE_WHEN`, and the `phase-report-pointers-v1` marker, the template has the current report-pointer structure — report that and stop.
2. If any are missing (including an older Intent Contract template with inline execution logs), explain the template needs the report-pointer update. Offer to upgrade: first check whether `tasks/main-template.legacy.md` exists. If it exists, select a unique, non-overwriting backup path (for example `tasks/main-template.legacy-<timestamp>-<unique-id>.md`) or stop until the collision is resolved. Never overwrite an existing backup. Create and verify the backup before replacing `tasks/main-template.md`, then continue with Step 3 (templates only — leave existing task folders and the populated `global-task-manager.md` untouched, other than telling the user new tasks will use the new template).

## Step 2: Create the directory structure

```bash
mkdir -p tasks/{planning,active,paused,completed}
```

## Step 3: Copy the canonical templates

```bash
cp ${CLAUDE_PLUGIN_ROOT}/templates/main.md tasks/main-template.md
cp ${CLAUDE_PLUGIN_ROOT}/templates/global-task-manager.md tasks/global-task-manager.md
cp ${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md tasks/CLAUDE.md
```

The three commands above are for a **new ledger only**. Copy the canonical template verbatim (`cp` only — no paraphrasing, no regeneration). For an approved upgrade, first create a non-overwriting backup of `tasks/main-template.md`, then copy only the new `templates/main.md` to it. Leave the existing `global-task-manager.md` and all task folders untouched. Read the existing `tasks/CLAUDE.md` and merge only the report-pointer guidance, preserving every project-specific rule; do not run the unconditional copy commands over an existing ledger.

Then open `tasks/CLAUDE.md` and fill in the `## Project-specific rules` section with the user (Git strategy, validation commands, delivery expectation, extra gates). Ask only what cannot be inferred from the repository.

## Step 4: Verify

```bash
find tasks -type f -name "*.md" | sort
```

Expect at least:

```
tasks/CLAUDE.md
tasks/global-task-manager.md
tasks/main-template.md
```

Confirm `tasks/main-template.md` contains `## Intent Contract`, `DONE_WHEN`, and `phase-report-pointers-v1`; phase entries have report pointers rather than inline evidence fields. Preserve existing task folders and project-specific rules during upgrades; never overwrite an existing backup.

## Done

The ledger is ready. To work a task through it, run `/task-workflow:task-start` — it reads `tasks/CLAUDE.md`, creates the next task from `tasks/main-template.md`, and keeps `tasks/global-task-manager.md` up to date.
