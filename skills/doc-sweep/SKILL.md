---
name: doc-sweep
description: End-of-day synthesis — reads today's worklog notes, resolves cross-note tensions, and fills today's daily summary. Optionally seeds tomorrow's summary and updates STATUS.md. Run as the last action of the day.
user-invocable: true
disable-model-invocation: true
---

# Daily Sweep

Synthesize today's worklog into a clean summary. Read everything first, then write once.

Behaviour depends on `summary_cadence` from `.notes-config.yml`:

| Cadence | What the sweep does |
|---------|---------------------|
| `none` | Report today's activity to the user; write nothing. |
| `daily` | Phases 1–4 + 6–7. No weekly rollup. |
| `weekly` | **Skip Phase 3 (daily summary).** On any day, gather today's notes and roll them into this week's weekly summary. Phase 4 (tomorrow) is also skipped. |
| `daily+weekly` | All phases. On Friday or Sunday, also run Phase 5 to roll the week's dailies into the weekly summary. |

## Prereq

`.notes-config.yml` must exist at project root. If not, stop and tell the user to run `/task-workflow:doc-init`.

## Convergent idempotency — the zeroth rule

The sweep is **convergent, not replay**. You may be invoked once a day, once a week, three times a day, or once every two weeks — the result must be the same: the summary reflects all notes, each note reflected exactly once, prior content preserved.

The summary's `## Notes` table IS the ledger. Before synthesizing anything, you must:

1. Locate the relevant summary file (daily or weekly, per cadence).
2. Read it. Parse the `## Notes` (or `## Notes Today` / `## Notes This Week`) table. Collect the list of note filenames already represented.
3. Glob the candidate notes for the time window (today for daily, this week for weekly).
4. Compute the diff: `new_notes = candidates − already_in_table`.
5. If `new_notes` is empty, report "summary is already up to date" and exit. **Do not re-synthesize.**
6. Otherwise, synthesize **only the new notes** and additively extend the sections via Edit. Append new rows to the Notes table.

Apply the same discipline to every section:
- **Open Threads** — dedupe against existing entries; strikethrough resolved ones rather than deleting.
- **Highlights / Work Completed** — only add items not already represented.
- **Tomorrow / Next Week** — append only if genuinely new; don't duplicate yesterday's carry-forward unless still unresolved.

## Phase 1 — Gather (with idempotency)

1. Read `.notes-config.yml`. Note `worklog_dir`, `granularity`, `summary_cadence`.

2. **Locate the target summary file first** (before reading any notes):
   - `daily` / `daily+weekly` → today's daily summary (may not exist yet)
   - `weekly` → this week's weekly summary
   - `none` → report today's activity and exit

   If the summary exists, Read it and parse its `## Notes*` table to collect `already_summarized` (set of filenames).

3. Find candidate notes based on granularity and cadence window:
   - **daily sweep / flat or daily granularity**: today's notes in `<worklog_dir>` (glob per granularity; see Phase 3 patterns).
   - **weekly sweep**: all of this week's notes.

   Exclude the summary itself (`-00-summary.md` or `00-summary.md` or `weekly-summary.md`).

4. Compute `new_notes = candidates − already_summarized`. If empty → report and exit.

5. Read every note in `new_notes` in order of sequence number. For each, extract:
   - Key claims, decisions, findings
   - Systems / files touched
   - Open questions or explicit next steps

6. Also scan:
   - `git log --after=<window_start> --before=<window_end> --oneline` — commits not covered by any note.
   - `tasks/active/` (if the project has a task system) — task states referenced in new notes.
   - Existing content in the target summary — **preserve it**; you will Edit, not Write.

## Phase 2 — Synthesize

5. Build a chronological timeline of what happened today.

6. Detect tensions: contradictions between notes about the same thing. Resolve chronologically (later note wins) unless the earlier note has stronger evidence (real data vs hypothesis). Flag genuinely unresolvable tensions explicitly.

## Phase 3 — Write the daily summary

**Skip this phase entirely if `summary_cadence` is `weekly` or `none`.** Under `weekly`, there is no daily summary — jump to Phase 5, which rolls today's notes directly into the weekly summary.

7. Locate today's summary via `./<worklog_dir>/new-note.sh --summary`. Read the returned file.

8. **Use Edit to update individual sections. Never use Write.** Existing content must be preserved — additively extend, don't replace.

9. Fill/update each section:

   **`## Overview`** — 2-4 sentences. What were the main threads of work today? Big picture.

   **`## Work Completed`** — what shipped, what progressed. Group by task or topic if meaningful. Don't copy the whole of each note — summarise.

   **`## Notes Today`** — one row per note, in sequence order, linking to the note file:
   ```markdown
   | # | Note | Topic |
   |---|------|-------|
   | 01 | [slug](YYYY-MM-DD-01-slug.md) | Brief topic |
   ```

   **`## Open Threads`** — unresolved items, open questions, things flagged "needs checking". Consolidate and deduplicate across notes.

   **`## Tomorrow`** — explicit carry-forward items. What will need attention tomorrow morning?

10. If tensions were found, add a `## Tensions` section (Edit the summary to insert it above `## Open Threads`) with each tension described and how you resolved it (or that it's unresolved).

## Phase 4 — Tomorrow (if cadence includes daily)

**Skip if `summary_cadence` is `weekly` or `none`.**

11. If `summary_cadence` is `daily` or `daily+weekly`, pre-create tomorrow's summary:
    ```bash
    ./<worklog_dir>/new-note.sh --tomorrow
    ```

12. Read it, then Edit to append the carry-forward items from today's `## Tomorrow` into a `## Morning Checklist` section at the top of tomorrow's summary. Format each item as a single bullet with what to check.

## Phase 5 — Weekly rollup (conditional)

Two trigger cases:

**Case A: `summary_cadence: daily+weekly`** — only run this phase on Friday or Sunday. Input is this week's daily summaries.

**Case B: `summary_cadence: weekly`** — run this phase on every invocation of `/task-workflow:doc-sweep`. Input is today's raw notes (from Phase 1) plus whatever is already in this week's weekly summary from prior days in the same week.

13. Run `./<worklog_dir>/new-note.sh --weekly` to locate/create this week's weekly summary.

14. Read its current contents (may have entries from earlier days this week — **preserve them**).

15. Use Edit (never Write) to additively update these sections:
    - `## Highlights` — append today's key items (or, for Case A, roll up the week's daily summaries)
    - `## Key Decisions` — append decisions from today's notes
    - `## Open Threads` — consolidate; deduplicate against entries already present
    - `## Next Week` — append carry-forward only on the final sweep of the week (Fri or Sun). Otherwise leave alone.

16. Under weekly-only cadence, don't write any daily summary — the weekly summary IS the record.

## Phase 6 — STATUS.md (if present)

14. If `STATUS.md` exists at project root, Edit it to update two things:
    - A pointer link to today's summary
    - 3-5 bullets describing current project state (what shipped recently, what's in flight, what's blocked)

    Keep STATUS.md short — it's a landing page for returning after time away, not an archive.

## Phase 7 — Report

15. Print to the user:
    - Notes synthesized (count)
    - Tensions found (with refs, or "none")
    - Open thread count
    - Path to today's summary
    - Tomorrow's checklist item count (if seeded)
    - Weekly summary path (if updated)

## Rules

- **Convergent idempotency.** Before generating output, read the target summary, parse its Notes table as a ledger, and act only on the delta. Running sweep twice in a row on the same notes is a no-op.
- **Read everything before writing.** Synthesize after, not during.
- **Edit, never Write, on existing summaries.** The file may have content from earlier runs, manual edits, or `/task-workflow:doc-new-note` — preserve it.
- **Compress, don't copy.** The summary should be shorter than the sum of its notes.
- **Don't fabricate.** Only include what notes, git log, or task files actually say. If something feels missing, flag it as a gap, don't invent.
- **Later note wins on contradiction**, unless earlier has stronger evidence.
- **Don't over-compress carry-forward items.** If tomorrow needs to verify 5 specific things, list 5 items, not one generic "verify deploys".
- **Strikethrough, don't delete.** Resolved open threads become `~~resolved: ...~~`. The summary shows evolution.
