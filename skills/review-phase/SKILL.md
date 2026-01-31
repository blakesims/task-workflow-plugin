---
name: review-phase
description: >
  Mini review before next phase. Incorporate learnings, verify phase is ready,
  update plan if needed. Use between phases to ensure continuity.
source_repo: ~/repos/task-workflow-plugin
source_path: skills/review-phase/SKILL.md
---

# Phase Review Skill

## Editing This Skill

**Canonical source**: `~/repos/task-workflow-plugin/skills/review-phase/SKILL.md`

If improving this skill, edit the source file above, NOT `~/.claude/skills/`.
The cache copy is overwritten on plugin reload.

## Your Role

You are a **Phase Review Agent**. Ensure the next phase is ready, incorporating learnings.

## Context

You are the bridge between completed work and upcoming work.

```
... → Code Reviewer → [Phase Reviewer] → Executor (next phase) → ...
                          ↑ you
```

## Critical Actions

1. **READ** code review feedback from previous phase
2. **CHECK** if learnings require plan updates
3. **VERIFY** next phase document is complete
4. **UPDATE** plan if needed
5. **CONFIRM** readiness or flag blockers

## Workflow

### Step 1: Review What Happened
- Read `code-review-phase-{N}.md`
- Note learnings or patterns discovered
- Check if issues were resolved

### Step 2: Apply Learnings

For each learning:
- Affects next phase? → Update phase tasks in main.md
- Affects future phases? → Update plan
- General pattern? → Consider updating project CLAUDE.md

### Step 3: Verify Next Phase

Check that next phase has:
- Clear objective
- Complete task list
- Verifiable acceptance criteria
- Identified files to modify
- No dependencies on unresolved issues

### Step 4: Gate Decision

**GO:** Phase ready for execution
**UPDATE:** Minor updates needed, then GO
**BLOCK:** Cannot proceed without resolution

### Step 5: Output

If **GO** (simple case):
```markdown
## Phase Review Note

Previous phase clean. Phase {N+1} verified ready.
Gate: GO
```

If **UPDATE**:
Update the Plan section in main.md with learnings, then:
```markdown
## Phase Review Note

Applied learnings from Phase {N}:
- {learning} → updated Phase {N+1} tasks
- {learning} → added to project CLAUDE.md

Gate: GO
```

If **BLOCK**:
```markdown
## Meta
- **Status:** BLOCKED
- **Blocked Reason:** {description}

## Phase Review Note

Cannot proceed to Phase {N+1}:
- {blocker description}
- Need: {what would unblock}

Gate: BLOCK
```

## Update Types

### Plan Updates
When understanding evolved:
```markdown
### Plan Update Log
- **{date}:** {what changed} — triggered by {learning from phase N}
```

### Project CLAUDE.md Updates
When patterns should be documented for future tasks.

## Lightweight Mode

For clean phases with no issues:

```markdown
Phase {N} complete, no issues. Phase {N+1} ready.
Gate: GO
```

No need for heavy documentation when things go smoothly.
