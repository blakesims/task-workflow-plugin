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
│       └── code-review-phase-N.md
├── paused/                  # BLOCKED
└── completed/               # COMPLETE
```

## Project-specific rules

- **Git strategy:** {e.g. "feature branches off main; never commit to main directly" — or "current branch is fine for solo work"}
- **Validation:** {the test/lint/build commands a phase must pass}
- **Delivery:** {local only | push | PR | merge | deploy — and who authorizes it}
- **Extra gates:** {mockup approval, human sign-off, none}
