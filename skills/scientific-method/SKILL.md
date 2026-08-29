---
name: scientific-method
description: When you catch yourself using the words 'maybe', 'probably', or 'likely', stop and employ the scientific method. Replaces guessing with hypothesis-driven investigation - form a hypothesis, derive testable consequences, run experiments, and deliver an evidence-backed verdict.
---

# Scientific Method

Now it's time to slow down.

Your goal is no longer to "fix" things or "help" — it is to uncover the truth. You do this by employing the scientific method, applying full rigour and scrutiny to even the most seemingly safe assertions.

## Trigger

Invoke this mode whenever you (or the user) notice hedge words creeping in:

> "maybe", "probably", "likely", "it seems", "I think", "should be", "presumably"

Each of these marks a **hidden assumption**. From this point on you do not make assumptions — you **state them** and you **test them**.

## Phase 0: Verify the premise

Before investigating anything, check that the problem is real:

1. Restate the reported problem as a **testable assertion** — a specific value, state, or behavior that is claimed to be wrong.
2. Run the single cheapest check that could falsify it (reproduce the bug, run the failing test, query the actual value, read the actual file).
3. If the premise doesn't hold — the bug doesn't reproduce, the value is actually correct — **stop and report that**. Don't investigate a problem that doesn't exist.

## Phase 1: Surface the assumptions

List every assumption currently in play, including the boring ones:

- "The config being read is the one I edited"
- "This code path actually runs"
- "The cache was invalidated"
- "The error and the symptom are related"

Each assumption is either **verified** (with evidence), or it becomes a hypothesis to test. Never let one ride on plausibility.

## Phase 2: The loop

For the central question, apply the rigorous methodology:

1. **Form a hypothesis** given your context and the data you have. One sentence, falsifiable.
2. **Derive consequences.** If the hypothesis is true, what *must* also be true (necessary)? What would be *sufficient* to prove it? What observation would *disprove* it?
3. **Design the experiment.** The smallest action that distinguishes true from false: a log line, a minimal repro, a query, a bisect, reverting one variable. Change **one variable at a time**.
4. **Run the experiment.** Record the actual command and the actual output — not a paraphrase.
5. **Deliver a verdict:** **PROVED | DISPROVED | INCONCLUSIVE**, plus any assumptions or limitations the experiment carries.

If **INCONCLUSIVE** — derive a sharper experiment and repeat. Continue as many times as necessary until you reach a conclusion.

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

A verdict you graded yourself is a draft. Before acting on a PROVED/DISPROVED conclusion that matters, hand the report to a **fresh context** running `/task-workflow:investigation-review` — a new session or a subagent, not the one that did the investigating. It will re-run your evidence, challenge your strongest claim, and return PASS or numbered challenges.

If it returns REVISE, address each challenge with evidence and resubmit. Only a PASS-ed verdict graduates from hypothesis to fact.

Only after the verdict is delivered — reviewed, and confirmed with the user where it matters — do you return to fixing things.
