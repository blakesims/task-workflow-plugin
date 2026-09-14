---
description: Project task documentation for the task-workflow plugin.
---

# Task Workflow (project)

`tasks/` is the durable record of human intention, agent planning, execution, and review for this project. Run it with `/task-workflow:task-start`.

The full contract — status machine, gates, artifact ownership, Git-safety rules — ships with the plugin (`task-workflow` and `task-start` skills). This file only records what is specific to this project. Project rules may add gates (mockups, sign-off, PR, merge, deployment) but must not weaken the canonical Intent Contract, `DONE_WHEN`, review evidence, or Git-safety rules.

## Layout

```text
tasks/
├── CLAUDE.md                # this file
├── global-task-manager.md   # task index and Next ID
├── main-template.md         # template for new task main.md files
├── planning/                # PLANNING / PLAN_REVIEW
├── active/                  # READY / EXECUTING_PHASE_N / CODE_REVIEW
│   └── TXXX-task-slug/
│       ├── main.md
│       ├── plan-review.md
│       ├── execution-phase-N.md
│       ├── code-review-phase-N.md
│       ├── final-review.md       # cumulative review when required
│       └── completion.md
├── paused/                  # BLOCKED
└── completed/               # COMPLETE
```

The entire approved plan stays in `main.md` as the planning agreement. Executors/reviewers update only compact status/outcome/report pointers; full reports live in the files above. On `REVISE`, the executor reads the linked full review before repairs. Each numbered `plan-review.md` attempt records `Review attempt` and `Reviewed specification SHA-256` (the exact Task/Intent/entire Plan byte range defined in task-start); the compact Plan Review entry carries the same metadata outside the specification. Before `READY`, the parent checks the current specification digest and dispatched attempt against the latest report and pointer; missing or stale evidence blocks continuation. No automatic migration of historical tasks.

## Project-specific rules

- **Git strategy:** {e.g. "feature branches off main; never commit to main directly" — or "current branch is fine for solo work"}
- **Validation:** {the test/lint/build commands a phase must pass}
- **Delivery:** {local only | push | PR | merge | deploy — and who authorizes it}
- **Extra gates:** {mockup approval, human sign-off, none}
