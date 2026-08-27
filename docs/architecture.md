# Task Workflow Plugin Architecture

## Canonical entry point

```text
/task-workflow:task-start
```

`/task-workflow:start` is a compatibility alias. The plugin repository is the canonical source for orchestration skills, specialist agents, templates, and workflow documentation.

## Design principles

1. The parent agent is the orchestrator, not the implementation executor.
2. `DONE_WHEN` and the canonical handoff packet preserve human intent across agent boundaries.
3. Planning and implementation are independently reviewed.
4. Review evidence is written to durable task artifacts.
5. Git substrate is selected from repository context rather than imposed globally.
6. Unrelated human work is never stashed, reset, deleted, staged, or committed.
7. Push, PR, merge, deployment, force-push, and branch deletion require authorization.

## Flow

```text
Human request
  ↓
Context + Git strategy gate
  ↓
Intent Contract with DONE_WHEN
  ↓
Optional intent-harden
  ↓
Canonical Task Workflow Handoff Packet
  ↓
ROUTE ── quickfix ──► executor → code-reviewer → COMPLETE
  ↓ planned
planner → plan-reviewer
  ↓ READY
per phase: executor → code-reviewer
  ↓
final holistic review (if >1 phase) → COMPLETE
```

## Runtime strategy

The orchestrator inspects:

- project instructions;
- current branch and working-tree state;
- remotes and delivery expectations;
- existing worktrees and concurrent work;
- task scope and risk.

It then records one strategy in `main.md`:

- **current branch** — direct serial work is explicitly appropriate;
- **feature branch** — isolated review or PR delivery is expected;
- **worktree** — a shared/dirty checkout or concurrent lane must be preserved.

The workflow is otherwise identical across substrates.

## Canonical artifacts

```text
tasks/
├── global-task-manager.md
├── planning/
├── active/
│   └── TXXX-task/
│       ├── main.md
│       ├── plan-review.md
│       └── code-review-phase-N.md
├── paused/
└── completed/
```

`main.md` contains:

- task metadata and runtime strategy;
- Intent Contract and `DONE_WHEN`;
- optional intent-hardening result;
- approved phased plan;
- plan-review summary;
- per-phase baseline and execution evidence;
- code-review summaries;
- completion evidence.

## Agents

| Agent | Responsibility | Gate |
|---|---|---|
| `task-workflow:planner` | Produce a phased plan from the handoff packet | submits for review |
| `task-workflow:plan-reviewer` | Verify alignment, executability, and validation | `READY` / `NEEDS_WORK` / `NOT_READY` |
| `task-workflow:executor` | Implement one approved phase without committing | `COMPLETE` / `BLOCKED` |
| `task-workflow:code-reviewer` | Inspect Git reality, tests, ACs, and `DONE_WHEN` | `PASS` / `REVISE` / `FAIL` |

The parent owns task routing, explicit-path staging, commits after `PASS`, GTM updates, and completion.

## Git review boundary

Before each phase:

1. Require a clean selected workspace.
2. Record `git rev-parse HEAD` as the phase baseline.
3. Let the executor leave source changes uncommitted.
4. Have the reviewer inspect the diff from that baseline and write its artifact.
5. On `PASS`, stage only reviewed paths with `git add -- <path...>`.
6. Verify `git diff --cached --name-only` before committing.

Never use `git add .` or `git add -A` in the workflow.

## Optional intent hardening

`/task-workflow:intent-harden` expands, compresses, and stress-tests the Intent Contract before planning. Visualization is optional and used only when it materially reduces ambiguity or project instructions require it.

## Project specialization

Projects may add stricter requirements—mockups, ADRs, sign-off, PR review, deployment gates—but should express those in repository instructions or a thin project profile. The plugin remains the canonical workflow engine.
