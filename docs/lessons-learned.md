# Lessons Learned — First Live Test

**Date:** 2026-01-28  
**Task:** T005 Audio Buffer Sync (Cap editor)  
**Result:** SUCCESS — 465 lines of Rust, bug fixed, code compiles

---

## What Worked

### 1. Plan Review Catches Real Issues
The plan-reviewer agent identified genuine architectural problems:
- Segment vs clip confusion in caching strategy
- Overengineered 4-phase plan → simplified to 2 phases
- Crossfade duration too long (50ms → 15ms)

This prevented wasted execution time on a flawed plan.

### 2. File-Based Handoffs
`main.md` as single source of truth worked perfectly:
- Each agent reads current state
- Each agent updates their section
- Status field drives orchestration
- Supporting docs (plan-review.md, code-review-phase-N.md) preserve audit trail

### 3. Executor Produces Quality Code
The executor agent:
- Analyzed existing codebase patterns
- Wrote idiomatic Rust
- Made atomic commits with clear messages
- Updated execution log accurately

### 4. Code Review Finds Non-Blocking Issues
Reviewers found real concerns (LRU complexity, clip index mapping) without blocking progress. The "PASS with issues" pattern works well.

---

## Issues & Solutions

### 1. Plugin Discovery
**Problem:** Plugins in `~/.claude/plugins/` are NOT auto-discovered.  
**Solution:** Always use `--plugin-dir ~/.claude/plugins/task-workflow`

### 2. File Write Permissions
**Problem:** `-p` mode skips workspace trust dialog, blocking file writes.  
**Solution:** Always use `--allowedTools "Edit Read Write"`

For executor (needs git/build tools):
```bash
--allowedTools "Edit Read Write Bash(git:*) Bash(cargo:*) Bash(grep:*)"
```

### 3. Agent Namespacing
**Problem:** Plugin agents are namespaced, not bare names.  
**Solution:** Use `--agent task-workflow:planner` not `--agent planner`

### 4. No Build Tools on Server
**Problem:** Executor couldn't run `cargo check` (no Rust toolchain).  
**Impact:** Code review was purely static.  
**Solutions:**
- Install Rust on server, OR
- Run executor on Mac node via `nodes.run`, OR
- Accept static-only review for remote execution

### 5. API Crashes
**Problem:** Claude API returned 500 error mid-execution.  
**Solution:** Restart executor with RESUME prompt:
```
"RESUME: Continue executing Phase N. Check 'git diff' and 'git status' 
to see what's already done. Continue from where it left off."
```

The executor successfully picked up partial work from the previous run.

### 6. Status Schema Drift
**Problem:** Agents used slightly different status values than spec:
- `APPROVED` instead of `READY`
- `IN_PROGRESS` instead of `EXECUTING_PHASE_N`

**Impact:** Minor — orchestrator can handle synonyms.  
**Future:** Consider adding status synonyms to agent prompts.

### 7. No Streaming Output
**Problem:** Background PTY processes show no output until completion.  
**Workaround:** Monitor progress via:
- `git diff --stat` (see code changes)
- File modification times
- Process CPU usage

---

## Timing Benchmarks

| Step | Time |
|------|------|
| Planning (initial) | 3m40s |
| Plan Review | ~2m |
| Planning (revision) | 2m14s |
| Plan Review (re-review) | ~1m |
| Execution Phase 1 | 8m06s |
| Code Review Phase 1 | ~2m |
| Execution Phase 2 | ~12m (including restart) |
| Code Review Phase 2 | ~2m |
| **Total** | ~45 minutes |

---

## Recommended Command Template

```bash
cd PROJECT_DIR && claude \
  --plugin-dir ~/.claude/plugins/task-workflow \
  --allowedTools "Edit Read Write Bash(git:*) Bash(cargo:*) Bash(grep:*) Bash(find:*) Bash(cat:*) Bash(ls:*)" \
  --agent task-workflow:AGENT_NAME \
  -p "PROMPT"
```

---

## Future Improvements

1. **Add Rust toolchain to server** — enables `cargo check` during execution
2. **Structured JSON output** — use `--output-format json` for machine-parseable gates
3. **Parallel-safe phases** — if phases are independent, could run in parallel
4. **Status synonyms** — make agents accept both `READY` and `APPROVED`
5. **Progress streaming** — investigate PTY buffering or use `--verbose` flag
