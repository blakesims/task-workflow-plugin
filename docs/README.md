# Task Workflow Plugin

A Claude Code plugin for intent-led, reviewed multi-agent development workflows.

## Before you start: trust and Git boundaries

This workflow delegates to **high-trust agents with Bash, Edit, and Write
access**. Use it only in a repository you trust and can restore. Start from a
**clean repository on a feature branch** unless project instructions explicitly
select another isolated strategy. The orchestrator may choose a worktree for a
dirty/shared checkout; it must never stash, reset, delete, stage, or commit
unrelated human work.

The workflow **auto-commits locally after each code-review `PASS`**, staging only
explicit reviewed paths. It does **not** automatically push, open or merge a PR,
deploy, force-push, or delete branches. Those delivery actions require explicit
authorization or an already-authorized repository workflow.

## Canonical entry point

```text
/task-workflow:task-start
```

`/task-workflow:start` is a compatibility alias. `task-start` forms an Intent
Contract and `DONE_WHEN`, optionally hardens intent, records the Git strategy,
and routes work through either:

- **quickfix** — one bounded implementation phase with full code review; or
- **planned** — planner, plan reviewer, then executor/code-reviewer per phase.

```text
Human → Intent + Handoff → Planner → Plan Reviewer → Executor → Code Reviewer
                              (planned lane)          ↖ REVISE
```

## Install

From the marketplace:

```bash
claude plugin marketplace add blakesims/task-workflow-plugin
claude plugin install task-workflow@task-workflow-marketplace
```

For local development:

```bash
claude --plugin-dir /path/to/task-workflow-plugin
```

Then invoke `/task-workflow:task-start` in the trusted target repository. The
first run bootstraps `tasks/` from `templates/`.

## Agents and gates

| Agent | Purpose | Gate |
|---|---|---|
| `planner` | Creates an implementation plan | submits for review |
| `plan-reviewer` | Checks plan alignment and validation | `READY` / `NEEDS_WORK` / `NOT_READY` |
| `executor` | Implements one phase without committing | `COMPLETE` / `BLOCKED` |
| `code-reviewer` | Reviews Git reality and tests | `PASS` / `REVISE` / `FAIL` |

All four roles can receive Bash/Edit/Write-capable tool access because planners
and reviewers persist task artifacts and run validation. The code reviewer may
edit only its declared review artifacts, not source code.

## Task ledger

```text
tasks/
├── global-task-manager.md
├── planning/
├── active/TXXX-task/
│   ├── main.md
│   ├── plan-review.md
│   └── code-review-phase-N.md
├── paused/
└── completed/
```

`templates/main.md`, `templates/global-task-manager.md`, and
`templates/CLAUDE.md` are copied during bootstrap. `main.md` records the Intent
Contract, verbatim `DONE_WHEN`, lane, branch/worktree strategy, baseline SHA,
plan, execution evidence, reviews, and completion evidence.

## Advanced integration surfaces

### Direct Claude CLI agent calls

Schemas under `schemas/` support external systems that knowingly recreate the
canonical handoff and gate semantics. Direct agent invocation is not the
student/onboarding path; omitting the full Task Workflow Handoff Packet can
silently weaken intent and Git safety. See the [advanced CLI reference](./cli-reference.md).

`scripts/workflow.sh` is intentionally deprecated and exits without invoking an
agent because the old wrapper did not preserve the canonical handoff or commit
gates.

### Optional Pi extension

`pi-extension/` is an **optional, advanced experiment** for deterministic graph
orchestration in Pi. It is not installed by the Claude Code marketplace entry,
not used by `task-start`, and not required for normal users. Its deterministic
engine tests run in CI; tests that spawn a live LLM remain manual.

## Validate a release candidate

```bash
python3 scripts/validate-plugin.py
claude plugin validate --strict .
bash -n scripts/*.sh
python3 -m compileall -q scripts
scripts/smoke-install.sh          # runtime invocation when Claude is available
(cd pi-extension && npm ci && npm test)
```

Use `scripts/smoke-install.sh --static` in unauthenticated CI. The smoke copies
release surfaces into a temporary fresh install, validates discovery, bootstraps
a temporary project, and (when runtime mode is available) invokes
`task-workflow:task-start` with all tools disabled and no session persistence.

## Documentation

- [Architecture](./architecture.md)
- [Advanced CLI reference](./cli-reference.md)
- [Quarantined historical lessons](./lessons-learned.md)

## License

[MIT](../LICENSE)
