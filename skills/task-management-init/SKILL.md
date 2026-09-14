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

If `tasks/` does not exist, use Step 2 (new ledger only), then Step 4. Otherwise use only the existing-ledger branch below; never enter Step 2.

If `tasks/` already exists, do not overwrite anything silently:

1. Read `tasks/main-template.md`. If it contains `## Intent Contract`, `DONE_WHEN`, the `phase-report-pointers-v1` marker, and the `Review attempt` / `Reviewed specification SHA-256` fields under `## Plan Review`, the template has the current report-pointer structure — report that and stop.
2. If any are missing (including an older Intent Contract template with inline execution logs), explain the template needs the report-pointer update. Offer to upgrade: first check whether `tasks/main-template.legacy.md` exists. If it exists, select a unique, non-overwriting backup path (for example `tasks/main-template.legacy-<timestamp>-<unique-id>.md`) or stop until the collision is resolved. Never overwrite an existing backup. After explicit user approval, go directly to Step 3 (existing-ledger upgrade only). If the template is missing or unreadable, stop for recovery rather than treating the existing ledger as new.

## Step 2: New ledger only

Precondition: `tasks/` does not exist. Never run this branch for an upgrade.

```bash
mkdir -p tasks/{planning,active,paused,completed}
cp ${CLAUDE_PLUGIN_ROOT}/templates/main.md tasks/main-template.md
cp ${CLAUDE_PLUGIN_ROOT}/templates/global-task-manager.md tasks/global-task-manager.md
cp ${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md tasks/CLAUDE.md
```

Copy the canonical template verbatim (no paraphrasing or regeneration). Then open `tasks/CLAUDE.md` and fill in the `## Project-specific rules` section with the user (Git strategy, validation commands, delivery expectation, extra gates). Ask only what cannot be inferred from the repository. Skip Step 3 and go directly to Step 4.

## Step 3: Existing-ledger upgrade only

Precondition: explicit upgrade approval and a readable existing `tasks/main-template.md`. Never run Step 2. Snapshot the populated GTM and task-folder contents for comparison; leave existing task folders and `tasks/global-task-manager.md` untouched.

1. Create and verify the backup before replacing `tasks/main-template.md`. Use exclusive creation (for example Python `open(backup, "xb")`), not a check followed by an overwriting copy. If creation collides, choose another unique path or stop. Compare the backup bytes to the original; on any error or mismatch, stop without replacing the template. Never overwrite an existing backup.
2. Only after verified backup success, copy `${CLAUDE_PLUGIN_ROOT}/templates/main.md` verbatim to `tasks/main-template.md`. This is the only template replacement in this branch.
3. Read existing `tasks/CLAUDE.md` and merge only canonical report-pointer and plan-review freshness guidance from `templates/CLAUDE.md`, preserving every project-specific rule. Do not copy over this file. If guidance conflicts with project rules, stop for resolution rather than deleting rules.
4. Verify GTM and task-folder contents are unchanged, project-specific rules remain intact, the backup still matches the old template, and the replacement matches the canonical template. New tasks use the new template; do not migrate active or historical tasks. Continue directly to Step 4.

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
