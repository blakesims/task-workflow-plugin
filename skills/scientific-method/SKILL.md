---
name: scientific-method
description: Use hypothesis-driven investigation when uncertainty could change a conclusion or safety decision. Form a testable hypothesis, run proportionate experiments, and report evidence and limitations.
---

# Scientific Method

Now it's time to slow down.

Investigate before fixing. Focus experiments on assumptions material to the conclusion, correctness or safety, not exhaustive proof of incidental wording.

## Trigger

Use this mode when uncertainty could change the conclusion or a safety decision. Hedge words can signal an assumption to examine:

> "maybe", "probably", "likely", "it seems", "I think", "should be", "presumably"

State material assumptions and test them where possible; label unresolved uncertainty honestly. Incidental wording alone does not require another investigation.

## Phase 0: Verify the premise

Before investigating anything, check that the problem is real:

1. Restate the reported problem as a **testable assertion** — a specific value, state, or behavior that is claimed to be wrong.
2. Run the single cheapest check that could falsify it (reproduce the bug, run the failing test, query the actual value, read the actual file).
3. If the premise does not hold in this check, report the tested conditions and limits. A failed reproduction alone does not disprove an intermittent bug; choose another targeted check only if the evidence/risk warrants it.

## Phase 1: Surface the assumptions

List assumptions that could change the conclusion, including environment mismatches:

- "The config being read is the one I edited"
- "This code path actually runs"
- "The cache was invalidated"
- "The error and the symptom are related"

Mark material assumptions verified with evidence or unresolved with their effect on confidence. Do not present plausibility as fact.

## Phase 2: The loop

For the central question, apply the rigorous methodology:

1. **Form a hypothesis** given your context and the data you have. One sentence, falsifiable.
2. **Derive consequences.** If the hypothesis is true, what *must* also be true (necessary)? What would be *sufficient* to prove it? What observation would *disprove* it?
3. **Design the experiment.** The smallest action that distinguishes true from false: a log line, a minimal repro, a query, a bisect, reverting one variable. Change **one variable at a time**.
4. **Run the experiment safely.** Never run source-mutating tests in the authoring tree. For isolation and candidate completeness, read `${CLAUDE_PLUGIN_ROOT}/skills/task-workflow/SKILL.md` → Review scope and safe validation. Record actual commands/results; retain raw output in a linked artifact, not repeated handoffs.
5. **Deliver a verdict:** **PROVED | DISPROVED | INCONCLUSIVE**, plus any assumptions or limitations the experiment carries.

If **INCONCLUSIVE**, choose a sharper experiment when it can materially resolve uncertainty. Stop and report missing access, evidence or a human decision when further checks cannot safely progress; no arbitrary rerun or negative-control quotas.

If **DISPROVED** — say so plainly, form the next hypothesis, and repeat. A disproved hypothesis is progress, not failure.

## Rules of evidence

- **Every claim cites evidence.** A query and its result. A command and its output. A file and a line number. Never "I believe" or "this is typically how it works".
- **Count, don't estimate.** "Multiple records affected" is banned. Run the count. Report the number with the command that produced it.
- **Check the source, not the symptom.** If data flows from A → B → C and C looks wrong, inspect A before blaming B.
- **Distinguish observation from interpretation.** "The request returned 403" is an observation. "The token expired" is a hypothesis — test it.
- **Negative results are results.** Record what you ruled out and how, so the investigation never re-treads the same ground.

## Phase 3: Ramifications

Once the hypothesis is concluded, zoom back out:

- What does this conclusion mean for the bigger picture?
- What else does this break or explain? (Other code paths, other data, other environments.)
- What is the blast radius of the fix?
- What rule, test, or check would prevent this class of problem from recurring?

## Final report

Present your findings in this shape:

```
## Verdict: {PROVED | DISPROVED | INCONCLUSIVE}

**Hypothesis:** <one sentence>

**Evidence:**
1. <command/check> → <actual result>
2. ...

**Assumptions & limitations:** <what this experiment did NOT control for>

**Ruled out:** <hypotheses disproved along the way, with the evidence>

**Ramifications:** <scope, blast radius, prevention>
```

## Adversarial review

A verdict you graded yourself is a draft. Before acting on a PROVED/DISPROVED conclusion that matters, hand the report to a **fresh context** running `/task-workflow:investigation-review` — a new session or a subagent, not the one that did the investigating. It will independently check risk-critical evidence and return PASS or numbered blockers, separate from suggestions.

If it returns REVISE, address numbered blockers with evidence and resubmit the delta plus exact prior report pointers. Keep prior evidence/history; do not replay it. After three REVISE cycles without convergence, escalate. Review approval does not turn an INCONCLUSIVE result into proof.

Only after the verdict is delivered — reviewed, and confirmed with the user where it matters — do you return to fixing things.
