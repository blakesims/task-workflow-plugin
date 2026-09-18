---
name: investigation-review
description: Independently review a debugging conclusion against risk-critical evidence; return PASS or REVISE with concrete numbered blockers, separate from suggestions.
---

# Investigation Review

Review the investigation, not the investigator. Stay independent, evidence-led and read-only; do not implement fixes.

## Process

1. Read the report and identify the claims supporting its PROVED / DISPROVED / INCONCLUSIVE verdict.
2. Independently inspect source evidence and run selected checks where needed to establish the conclusion. Prioritize correctness, security, data integrity and operational risk; no fixed rerun count or negative control for every assertion. Distinguish checks you ran from evidence you evaluated.
3. Test material gaps: does the evidence distinguish competing explanations? Could the experiment detect the claimed effect? Is the right version/environment actually running? Are scope claims supported by measured results? A compilation or symptom check alone does not establish a runtime fix.
4. On re-review, check prior blockers, changed evidence and affected conclusions/dependencies. Retain the full investigation question and required evidence; reference still-valid prior report sections instead of replaying the history. Expand review if new evidence undermines earlier conclusions.
5. Return the gate with concise evidence and limitations. Preserve earlier reports/attempts; use exact report/section pointers for unchanged evidence.

## Gates

- **PASS** — the conclusion is supported within its stated scope and limitations; no material blockers remain. Nonblocking suggestions may remain. A well-supported INCONCLUSIVE verdict can pass; it is not proof of a fix.
- **REVISE** — a concrete error or evidence gap undermines the conclusion or a safety decision. Number each blocker with the claim/path, impact, evidence and smallest resolving check. Tooling/editorial preferences alone are nonblocking suggestions.

After 3 REVISE cycles without convergence, escalate to the user; do not expand proof machinery indefinitely.

## Safe checks

Never run source-mutating tests in the authoring tree. For isolation and candidate completeness, read `${CLAUDE_PLUGIN_ROOT}/skills/task-workflow/SKILL.md` → Review scope and safe validation. Report unavailable safe verification honestly; this is a prompt boundary, not a tool sandbox.

## Output

```md
## Review: PASS | REVISE
**Scope / attempt:** report and current evidence identity
**Evidence:** checks run/evaluated, actual results or exact report pointers
**Blockers:** numbered claim/path — impact, evidence, smallest resolving check (or None)
**Nonblocking suggestions:** optional improvements (or None)
**Limitations:** what remains unverified and why it matters
```

Use a fresh context or independent subagent, not the investigator's self-review. Write the full review once to the supplied report path; return a short gate/path handoff.
