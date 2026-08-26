---
name: intent-harden
description: Optionally stress-test and tighten an Intent Contract before task planning.
user-invocable: true
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/intent-harden/SKILL.md
---

# Intent Harden

Strengthen a draft Intent Contract before planning. This is optional and must not become ceremony for small, obvious work.

## Inputs

Require a draft containing:

- executive intent;
- `DONE_WHEN`;
- scope in/out;
- source evidence;
- assumptions, risks, and material open decisions;
- validation expectations.

If these are absent, return to `task-start` Stage 1 first.

## Pass 1 — Expand

Find what the brief may be under-specifying:

- affected users and workflows;
- hidden state transitions or lifecycle effects;
- permissions, privacy, payments, data integrity, migrations, or production risk;
- unchanged behaviour that must remain stable;
- source-of-truth conflicts;
- failure paths and recovery;
- operational and verification needs.

Do not invent product features. Mark candidate additions explicitly.

## Pass 2 — Compress

Remove noise and implementation detail. Tighten:

- one test-like `DONE_WHEN` assertion;
- scope boundaries;
- named source evidence;
- decisions already made;
- only genuinely material open decisions;
- concrete validation expectations.

## Pass 3 — Stress-test

Challenge the contract:

1. Could an implementation satisfy the words but miss the human outcome?
2. Could a planner make a materially wrong assumption?
3. Is any source of truth missing or contradictory?
4. Is out-of-scope behaviour protected?
5. Are high-impact failures and rollback/recovery covered?
6. Can each success claim be verified?

Resolve implementation details autonomously. Ask the human only about high-impact choices that cannot be inferred safely.

## Pass 4 — Optional visualization

Use visualization only when it materially reduces ambiguity for a UI, workflow, architecture, or state transition:

- user journey;
- state table;
- sequence diagram;
- file tree;
- data flow;
- compact ASCII mockup when visual layout is itself part of intent.

Do not require mockups universally. The repository or human may explicitly disable them.

## Output

Return a replacement brief:

```md
# Hardened Intent Contract

## DONE_WHEN
...

## Executive intent
...

## Scope in
- ...

## Scope out / unchanged
- ...

## Source evidence
- ...

## Decisions made
- ...

## Open decisions
- None, or only high-impact human decisions

## Assumptions and risks
- ...

## Validation expectations
- ...

## Hardening changes
- Added: ...
- Removed: ...
- Clarified: ...
```

The parent replaces the draft Intent Contract with this brief, records `Intent hardening: RUN`, then regenerates the canonical handoff packet.
