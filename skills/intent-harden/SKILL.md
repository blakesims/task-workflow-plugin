---
name: intent-harden
description: Stress-test and tighten an Intent Contract before planning. Composes grill-me + linear-independence and adds three more phases (Visualize / Stress-test / Realign). Use right after a contract is drafted and before spawning a planner — especially when the contract was drafted in one pass, the request arrived under-specified, or the work is user-facing or data-sensitive. Triggers on "harden the contract", "before we plan, let's stress-test this", or invoke directly with /task-workflow:intent-harden.
user-invocable: true
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/intent-harden/SKILL.md
---

# Intent Harden

The default failure mode of contract drafting is **invisible scope** — decisions the planner has to invent because nobody surfaced them, and additions that creep in because nobody compared the build to the original ask. This skill is the explicit expansion-then-contraction cycle that catches both.

Run when an Intent Contract has been drafted (or is in late-stage drafting) and the user is about to commit it to a planner. Especially valuable when the user might otherwise rubber-stamp the contract under cognitive load. It is optional and must not become ceremony for small, obvious work.

## Inputs

Require a draft containing:

- executive intent;
- `DONE_WHEN`;
- scope in/out;
- source evidence;
- assumptions, risks, and material open decisions;
- validation expectations.

If these are absent, return to `task-start` Stage 1 first. When invoked standalone (outside the task workflow), draft this skeleton from the conversation before proceeding.

## The five phases — run in order

### Phase 1 — EXPAND  *(grill-me)*

Read `${CLAUDE_PLUGIN_ROOT}/skills/grill-me/SKILL.md` and apply it to the draft contract. Drive the design tree. Surface every decision the planner would otherwise have to invent silently. Cover at minimum:

- Privacy / enumeration / oracle attacks
- Idempotency, dedup windows, rate limits
- Validation strictness (server vs client, soft vs hard)
- Failure modes (what happens if external service X is down)
- Error UX (what does the user see; what does staff see)
- Observability (audit trail, logging, dashboards)
- Auth posture (how do we know it's the right person)
- Hidden state transitions, migrations, unchanged behaviour that must remain stable

For each branch, propose a recommended answer. The user steers; you do not interrogate without recommendations. Do not invent product features — mark candidate additions explicitly.

### Phase 2 — COMPRESS  *(linear-independence)*

Read `${CLAUDE_PLUGIN_ROOT}/skills/linear-independence/SKILL.md` and apply it to the grill output. Collapse it into the smallest set of truly independent decisions — typically 3-5. Anything that can be answered from the codebase, from existing conventions, or from a sensible default, you commit to deciding yourself. Do NOT ask the user about column names, file paths, or default tradeoffs that have an obvious answer.

Surface the compressed set with: **decision · tradeoff · cost of each option · your recommendation**. Use AskUserQuestion to bundle them when there are 2-4 questions.

### Phase 3 — VISUALIZE

Reading a contract is abstract; seeing the artifact is concrete. Produce:

1. **ASCII mockups** of every user-facing surface (forms, pages, emails, badges, dashboards). Even rough box-drawings beat prose.
2. **File tree** of what gets created and what gets mutated, grouped by frontend / backend / config / tests.
3. **Data flow diagram** for the critical path (one-page ASCII flowchart, with branches and side effects called out).

The user must see the build before they consent to it. Misplacements (wrong subdomain, wrong audience, wrong surface) usually only surface when they SEE the picture — not when they read the spec. Skip an artifact only when there is genuinely nothing user-facing to draw, or the repository or human explicitly disables mockups.

### Phase 4 — STRESS-TEST

Probe the upstream and downstream boundaries. For each major component, ask:

- **What's already built?** Grep + read the codebase. The most expensive scope creep is rebuilding something that already exists.
- **What's the action surface?** (UI button / external dashboard / cron / webhook / manual script) — sometimes the action lives outside our system entirely.
- **Where's the source of truth?** (DB column / external API / external dashboard) — we don't need to track state our system isn't authoritative for.
- **What fails silently if absent?** Identify the consequences of NOT building each piece. Sometimes the answer is "nothing user-visible" — cut it.
- **What's the downstream side-effect on success?** (other webhooks fire / other systems get notified / state propagates) — confirm we don't double-handle.

Then challenge the contract itself:

1. Could an implementation satisfy the words but miss the human outcome?
2. Could a planner make a materially wrong assumption?
3. Is any source of truth missing or contradictory?
4. Is out-of-scope behaviour protected?
5. Are high-impact failures and rollback/recovery covered?
6. Can each success claim be verified?

Cut dead-weight that already-wired systems handle. Resolve implementation details autonomously; ask the human only about high-impact choices that cannot be inferred safely.

### Phase 5 — REALIGN

Re-read the source-of-intent — the original PDF, transcript, decision doc, or client message that started this work. Audit every decision in the hardened scope against it.

Classify each decision as one of:

- **VERBATIM** — directly required by the source
- **ADDITION** — not in the source; we're proposing to add it
- **DEVIATION** — diverges from the source (different copy, different flow, different placement)

Surface the additions and deviations. For each non-VERBATIM item, offer three paths:

- **Path A — Ship as scoped, flag to client post-launch.** Cheap, gets us launched, client can veto post-fact.
- **Path B — Pause and ask client first.** Slow but zero misalignment risk.
- **Path C — Cut the addition, ship pure source intent.** Smallest, fastest, safest. Defer the addition to a follow-up task only if a real complaint emerges.

**Default recommendation: Path C** unless the verbatim spec cannot function without the addition.

This phase is where most scope creep dies. The addition you proposed in Phase 1 because it "felt useful" gets cut here because the client never asked for it.

## Output

Return a replacement brief:

```md
# Hardened Intent Contract

## DONE_WHEN
<single tight assertion>

## Executive intent
...

## Scope in
- ...

## Scope out / unchanged (cut-list explicitly named)
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

## Source-alignment audit
Verbatim: <count> · Additions kept: <count, listed> · Deviations: <count, listed>

## Hardening changes
- Added: ...
- Removed: ...
- Clarified: ...
```

The cuts are as important as the keeps; they prevent re-litigation downstream. Inside the task workflow, the parent replaces the draft Intent Contract with this brief, records `Intent hardening: RUN`, then regenerates the canonical handoff packet. Standalone, this brief becomes the input to whatever planning follows.

## When NOT to run

- Trivial fixes (≤2 files, ≤50 LOC) — the brief IS the commit message.
- Small loops with an obvious shape — the executor + reviewer will catch design issues.
- Tasks where the source-of-intent is already fully unambiguous AND the codebase implications are well-known.

In those cases, just go.

## Style notes

- Recommend an answer for every question. Never interrogate without offering a default.
- Use AskUserQuestion to bundle the linearly-independent decisions — single message, parallel answers.
- Use ASCII for mockups even when crude. The point is shared sight, not aesthetics.
- Keep the user in the driver's seat — every phase ends with a yes/no/refine before moving forward.
- The skill is a **discipline**, not a script. If the user pushes back at any phase, redirect; don't insist on completing the next phase.
