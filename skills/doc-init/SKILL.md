---
name: doc-init
description: Set up a lightweight project documentation system — worklog (transient notes) plus refs (curated docs). Discovers existing conventions, adapts defaults to project maturity, installs a note-creation script and a .notes-config.yml.
user-invocable: true
model: opus
disable-model-invocation: true
---

# Documentation System Init

Set up a low-friction, agent-safe documentation system for this project. Three layers:

- **Worklog** — transient chronological notes, created via a script, auto-named
- **Refs** — curated durable docs (ADRs, PRDs, API refs, domain maps), hand-maintained
- **Summaries** — daily/weekly rollups, written by `/task-workflow:doc-sweep`

The system lives in `.notes-config.yml` at project root plus a `new-note.sh` script. Global skills (`/task-workflow:doc-new-note`, `/task-workflow:doc-sweep`) read the config to behave correctly per project. There are no per-project skill copies.

## Important context

This init is LLM-driven on purpose. A generic scaffold can't know that this particular project already has (for example) `docs/features/inbox/` or a `check-feedback` skill that feeds triage artifacts. Do reconnaissance first. Let what you find inform defaults and integrations. Don't paint a generic tree on top of real existing structure.

## Phase 1 — Reconnaissance

Before asking anything, scan the project. This is quick discovery, not deep analysis.

1. **Already initialized? Be convergent.** If `.notes-config.yml` exists at project root, read it. **Do not bail out.** Instead, recon the project afresh and compute the delta — what's changed since the last init run? Examples:
   - Config says `refs_dir: docs/refs/` but `docs/adr/` now exists with 6 ADRs → propose moving refs_dir.
   - `tasks/` didn't exist at last init but does now → propose wiring task-completion integration.
   - Granularity is `flat` but the worklog now has 140 notes → propose upgrading to `weekly`.
   - A project-local skill was added that produces artifacts → propose wiring it.
   - Worklog script is stale vs the latest `${CLAUDE_PLUGIN_ROOT}/skills/doc-init/assets/new-note.sh` → offer to refresh.

   Present findings and proposed deltas. AskUserQuestion: **Apply changes / Reconfigure from scratch / Nothing to change**. On "nothing to change", exit cleanly. On "from scratch", proceed through the whole flow but preserve existing worklog contents.

2. **Project identity**: dir name, root `CLAUDE.md` if present. Read it — note any existing doc/task conventions or project rules.

3. **Existing doc locations**: check for `docs/`, `notes/`, `research/`, `worklog/`. For each, capture:
   - Subdirectories (e.g. `docs/adr/`, `docs/features/done/`, `docs/architecture/`, `docs/decisions/`, `docs/refs/`, `docs/specs/`) and rough file counts.
   - Any CLAUDE.md files inside.
   - Naming conventions in each subdirectory — are files date-prefixed (transient), numbered like `F001-*`/`ADR-001-*` (durable), or free-form?

   Durable-doc directories (curated, non-transient) are candidates for `refs_dir` — Phase 2 uses this inventory.

4. **Task system**: a bare `tasks/` directory is not enough — it could be runtime state (e.g. Claude Code's task-tool stores UUIDs there). Require *project-task-system* evidence:
   - `tasks/CLAUDE.md` exists, **or**
   - `tasks/global-task-manager.md` / `tasks/GTM.md` / similar, **or**
   - `tasks/active/TXXX-*/main.md` or `tasks/planning/TXXX-*/` pattern, **or**
   - any directly-authored markdown task docs.

   If none of those signals are present (e.g. `tasks/` contains only UUIDs or opaque runtime subdirs), skip task integration entirely and do not mention it in Phase 2 proposals.

5. **Project-local skills**: list `.claude/skills/` (if present). For each skill, read the frontmatter `description` to understand what it does. Pay attention to ones that create artifacts (feedback triage, bug reports, feature specs, incident notes) — these are integration candidates.

6. **Hooks**: glance at `.claude/settings.json` for existing hooks relevant to docs.

7. **Project size/age**: `git log --oneline | wc -l`, first commit date, last commit date. Use to size the system.

8. **Version control**: `test -d .git`. Note if not a git repo.

Present findings to the user in 5-10 lines. Example shape:

> Found:
> - Project: `expenses-app` — 3 months old, 187 commits
> - Docs: `docs/features/inbox/` (existing feature spec system)
> - Tasks: none
> - Local skills: `check-feedback` (triages voice feedback from the mobile app)
> - Hooks: none relevant
>
> Proposed setup:
> - Worklog at `docs/worklog/` alongside existing `docs/features/`
> - Daily granularity, daily summaries
> - Refs at `docs/refs/` for future ADRs
> - Integration: `check-feedback` could append triage notes to today's worklog
>
> Proceed with defaults, customise, or architect?

## Phase 2 — Propose a shape

Default rules (use unless recon suggests otherwise):

**Worklog location**: reuse existing `docs/` if present; otherwise create `docs/worklog/`. Never collide with existing content.

**Refs location**: detect existing durable-doc directories before creating a new one.

- Scan `docs/` for subdirectories containing ≥3 markdown files that are **not** date-prefixed (i.e. curated, not transient). Candidates include `docs/adr/`, `docs/architecture/`, `docs/decisions/`, `docs/features/done/`, `docs/refs/`, `docs/specs/`.
- **One match** → propose it as `refs_dir`. Don't create a parallel empty `docs/refs/`.
- **Multiple matches** → ask which (or store multiple, comma-separated, if the user wants).
- **No matches** → default to `docs/refs/`. Skip entirely if the project is <1 month old and has no durable docs yet.

**Granularity**:
- <1 month old, <50 commits → `flat`
- 1-6 months → `daily`
- 6+ months or 500+ commits → `weekly`

**Summary cadence**:
- `flat` → `none` (project is small enough that git log + STATUS.md suffice)
- `daily` → `daily`
- `weekly` → `daily+weekly`

Cadence options: `none` / `daily` / `weekly` / `daily+weekly`. `weekly`-only is for long-running projects with modest daily volume — `/task-workflow:doc-sweep` runs at week-end (Friday or Sunday) and rolls up the week without daily summaries.

**Integrations**: propose one per genuinely relevant existing artifact producer you found in recon. Don't invent integrations — only propose wiring for things you actually saw.

Use `AskUserQuestion` with three choices: Quick Start / Customise / Architect.

## Phase 3 — Interview (level-gated)

### Quick Start
No questions. You already confirmed with them in Phase 2. Go to Phase 4.

### Customise
Batch into a single `AskUserQuestion` call (skip any already answered by recon):

1. Worklog directory (free text, default from recon)
2. Granularity — `flat` / `daily` / `weekly`
3. Summary cadence — `none` / `daily` / `weekly` / `daily+weekly`
4. Include refs directory (`yes` / `no`)
5. If `tasks/` exists: wire task-completion notes (`yes` / `no`)

### Architect
All Customise questions, plus:

- Template overrides (custom headings for note / summary / weekly-summary)
- Hooks via `update-config` skill — e.g. on-stop reminder to sweep, on-task-complete note creation
- Integrations list — confirm each one you proposed and allow the user to reject or add
- `week_style` (iso is the only supported value for now; note if the user wants engagement-relative weeks so it can be added later)

## Phase 4 — Scaffold

Create files (exact paths, relative to project root):

1. **`.notes-config.yml`** — start from `${CLAUDE_PLUGIN_ROOT}/skills/doc-init/assets/config-template.yml`, substitute the answers. Write it to project root.

2. **`<worklog_dir>/new-note.sh`** — copy verbatim from `${CLAUDE_PLUGIN_ROOT}/skills/doc-init/assets/new-note.sh`. Then `chmod +x <worklog_dir>/new-note.sh`.

3. **`<worklog_dir>/CLAUDE.md`** — **copy verbatim** from `${CLAUDE_PLUGIN_ROOT}/skills/doc-init/assets/worklog-claude.md`. Do not paraphrase or regenerate from memory. Use `cp` so the file is an exact byte copy.

4. **`<refs_dir>/CLAUDE.md`** (only if refs dir is included) — **copy verbatim** from `${CLAUDE_PLUGIN_ROOT}/skills/doc-init/assets/refs-claude.md`. Same rule: `cp` only, no paraphrase.

5. **`mkdir -p`** the worklog and (if included) refs dirs.

### Phase 4.5 — Reconcile existing notes

Existing worklog-style content must match the chosen granularity. **Migrate it — don't yield to a bad SOP.** The new system is the new system.

**Migration scope is NOT just `worklog_dir`.** Scan two sets of directories:

- **Set A** — the chosen `<worklog_dir>` and its subdirectories.
- **Set B** — any *other* directory recon flagged as "worklog-style" in Phase 1 (e.g. `docs/security/` in a project where you chose `docs/worklog/` as the new home but found date-prefixed notes elsewhere). Present these explicitly to the user before migrating — they may want to keep topical silos separate from the unified worklog, or they may want everything consolidated.

1. **Set A**: list `.md` files in `<worklog_dir>` (ignore `CLAUDE.md` and the script itself).

2. **Set B**: for each recon-flagged worklog-style directory outside `<worklog_dir>`, list its date-prefixed `.md` files. Ask the user explicitly: *"I also found <N> date-prefixed notes in `<other_dir>/`. Migrate these into the unified worklog too, or leave them where they are?"* — use AskUserQuestion with **Migrate / Leave in place / Cancel**.

3. Classify every candidate file by filename pattern:
   - `YYYY-MM-DD-slug.md` at root → **flat**
   - `YYYY-MM-DD-NN-slug.md` at root → **flat** (already sequenced)
   - `<dir>/YYYY-MM-DD/NN-slug.md` → **daily**
   - `<dir>/YYYY-Www/YYYY-MM-DD-NN-slug.md` → **weekly**
   - Anything else → flag as "needs user review"

4. If every existing Set-A note already matches the chosen granularity, and the user chose to leave Set B in place, skip. Done.

5. Otherwise build a migration plan. Source → target. For each file:
   - Extract date from filename (or file mtime if the filename has no date).
   - Extract slug (strip date prefix and any existing sequence number). If migrating from a topical silo like `docs/security/`, optionally prefix the slug with the silo name (`security-<slug>`) so the origin is preserved — ask the user.
   - Compute target path per the chosen granularity:
     - **flat** target: `<worklog_dir>/YYYY-MM-DD-NN-slug.md` (NN auto-increments per date)
     - **daily** target: `<worklog_dir>/YYYY-MM-DD/NN-slug.md`
     - **weekly** target: `<worklog_dir>/YYYY-Www/YYYY-MM-DD-NN-slug.md` (ISO week of the date)
   - Resolve sequence collisions by ordering files chronologically (by date, then alphabetically by slug) and assigning 01, 02, … within each target day.

6. Show the plan to the user (source → target for each file) and `AskUserQuestion`: **Migrate / Skip / Cancel**.

7. On **Migrate**: use `git mv` if the worklog dir is under git (preserves history); otherwise `mv`. Create target subdirectories as needed. Report what moved.

8. On **Skip** / **Leave in place**: leave existing files untouched but warn the user that `/task-workflow:doc-new-note` and `/task-workflow:doc-sweep` will only see notes that live under `<worklog_dir>` and match the config's granularity; notes elsewhere will be invisible to the system.

## Phase 5 — Integrate

Now weave the system into what already exists. Be surgical — don't bloat existing files.

1. **Root `CLAUDE.md`**: check for a symlink first.

   - **If `CLAUDE.md` is a symlink** (e.g. `readlink CLAUDE.md` returns a path into a dotfiles repo), do NOT edit it blindly — that would silently modify the symlink target (often a user-global agent guide in a different repo). Ask the user explicitly via `AskUserQuestion`: **Edit the symlink target / Skip root CLAUDE.md edit / Create a sibling `CLAUDE.notes.md`**. Default recommendation: **Skip** — the `.notes-config.yml` at project root is enough of a discovery pointer.

   - **If `CLAUDE.md` is a regular file** (or doesn't exist), append (don't replace) a minimal pointer. **Default is a single line** — the user's root CLAUDE.md is a carefully-curated agent guide; don't bloat it:

     ```markdown
     ## Docs

     See `.notes-config.yml` for the worklog / refs / sweep system.
     ```

     Only expand to a multi-bullet section if the user selected **Architect** and explicitly asked for a fuller pointer. If no root CLAUDE.md exists, create a minimal one with just the two-line block above.

   - **Before appending, check if the block is already present** (convergent idempotency — earlier init run may have added it). If so, skip.

2. **`tasks/CLAUDE.md`** (if the user opted in to task integration): append a "Task Completion Notes" paragraph instructing task-workflow agents to run `<worklog_dir>/new-note.sh <task-slug>` on completion and link the resulting note in the task's `main.md`.

3. **Existing project-local skills** (for each integration the user accepted): edit those skills to reference the worklog. **Show the diff to the user before applying.** Example: a `check-feedback` skill's "Workflow" section could gain a step "After triaging, run `./<worklog_dir>/new-note.sh feedback-<date>` to capture what was processed."

4. **`STATUS.md`** at project root (optional — ask the user): create a stub pointing at the latest daily summary. `/task-workflow:doc-sweep` will keep it updated.

5. Record every integration you wired in `.notes-config.yml` under `integrations:` — `name`, `hook`, `note`.

## Phase 6 — Verify & report

```bash
cat .notes-config.yml
ls -la <worklog_dir>
```

Print to the user:
- Worklog dir, refs dir, granularity, cadence
- Script path
- **Files migrated** (if Phase 4.5 ran): count + from→to example
- Integrations wired
- How to create their first note:
  - `<worklog_dir>/new-note.sh --summary` — seed today's summary
  - `<worklog_dir>/new-note.sh <slug>` — first detailed note
  - `/task-workflow:doc-sweep` — at end of day

Suggest they commit these files as a single "docs: initialise documentation system" commit. If a migration happened, mention that the commit will include renames (`git mv`) so history is preserved.

## Rules

- **Convergent idempotency.** Init is safe to re-run. Each run recons, computes the delta vs current state, and applies only what's new or changed. Never re-scaffold files that already exist and already match intent.
- **Reconnaissance before questions.** Never ask for info you can see.
- **Don't overwrite.** Append to existing CLAUDE.md files; never replace them. Before appending, check whether the content you're about to add is already present — if so, skip.
- **Minimal root CLAUDE.md footprint.** Default is a one-line pointer to `.notes-config.yml`. The root CLAUDE.md is a carefully-curated agent guide — don't bloat it.
- **Respect existing durable-doc conventions.** If the project already uses `docs/adr/` or `docs/features/done/`, propose that as `refs_dir` — don't create a parallel empty `docs/refs/`.
- **Don't yield to a bad SOP.** When existing notes don't match the chosen granularity, migrate them (Phase 4.5) rather than dumbing down the config to match the mess. The new system is the new system.
- **Use `git mv` for migrations** when the worklog dir is under git. History matters.
- **Confirm integrations before editing other skills.** Show the diff. The user must see what's changing.
- **Small footprint.** Only create files that are strictly needed.
- **Script stays as-is.** Don't edit the script per-project — it reads `.notes-config.yml` at runtime. If the user needs different templates, regenerate via architect level.
- **No global summarizer.** Cross-project summarization is out of scope for this skill. Per-project only.
