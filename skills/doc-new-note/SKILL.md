---
name: doc-new-note
description: Use when asked to create a "new note", "daily summary", "worklog entry", "weekly summary", or similar, in a project that has a worklog system (`.notes-config.yml` at root). Calls the project's new-note.sh script, which enforces naming and layout.
user-invocable: true
disable-model-invocation: true
---

# New Worklog Note

Create a worklog note via the project's `new-note.sh` script. Never create notes manually — the script enforces naming, sequence numbers, and directory layout based on `.notes-config.yml`.

## Process

1. **Locate the script.** Find `.notes-config.yml` at project root (or any parent). Read `worklog_dir` from it. The script is at `<worklog_dir>/new-note.sh`.

   If no `.notes-config.yml` exists, tell the user: *"This project isn't set up with the worklog system yet. Run `/task-workflow:doc-init` first."* Then stop.

2. **Run the script** with the appropriate mode:

   | Command | When |
   |---------|------|
   | `./<worklog_dir>/new-note.sh <slug>` | Detailed note (auto-increments sequence) |
   | `./<worklog_dir>/new-note.sh --summary` | Today's daily summary |
   | `./<worklog_dir>/new-note.sh --tomorrow` | Pre-create tomorrow's summary |
   | `./<worklog_dir>/new-note.sh --weekly` | This week's weekly summary |

   Slugs must be kebab-case (lowercase letters, numbers, hyphens). Examples: `auth-bug-investigation`, `caching-decision`, `api-refactor-plan`.

3. **Read the returned path.** The script prints the file path and a reminder. You **must** call the Read tool on that path before calling Edit. Claude Code's tool contract requires it.

4. **Edit sections** of the note using the Edit tool. Do not use Write to rewrite the whole file — it clobbers any existing content (the summary in particular may already have entries from earlier in the day).

## Rules

- Never create worklog files manually. Always the script.
- Always Read before Edit.
- Use Edit for section updates; Write only if the file is genuinely empty and you're authoring from scratch.
- Don't invent filenames — let the script number them.
- **Convergent idempotency.** If a summary already has content (from `/task-workflow:doc-sweep` or an earlier note-dump), don't clobber it — Edit additively into the right section. The summary's tables and lists are the ledger of what's been captured.
