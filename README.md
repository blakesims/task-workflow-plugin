# Task Workflow Plugin

A Claude Code plugin for intent-led, reviewed multi-agent development workflows,
bundled with the standalone skills from [guide.zenaitutoring.com](https://guide.zenaitutoring.com)
(intent hardening, scientific method, docs system, task shaping, and more).

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

Inside a Claude Code session:

```text
/plugin marketplace add blakesims/task-workflow-plugin
/plugin install task-workflow@task-workflow-marketplace
```

If the install summary says so, activate it in the current session with:

```text
/reload-plugins
```

From the shell (or for an agent installing on your behalf):

```bash
claude plugin marketplace add blakesims/task-workflow-plugin
claude plugin install task-workflow@task-workflow-marketplace
```

A CLI install is not picked up by an already-running session until you run
`/reload-plugins` in it. New sessions load it automatically.

For local development:

```bash
claude --plugin-dir /path/to/task-workflow-plugin
```

Then invoke `/task-workflow:task-start` in the trusted target repository. The
first run bootstraps `tasks/` from `templates/`.

## Bundled skills

The workflow surface:

| Skill | Purpose |
|---|---|
| `/task-workflow:task-start` | Canonical entry point — Intent Contract, routing, gated execution |
| `/task-workflow:intent-harden` | Five-phase contract stress-test (composes grill-me + linear-independence) |
| `/task-workflow:grill-me` | Relentless design interview down the decision tree |
| `/task-workflow:linear-independence` | Compress questions to the smallest independent decision set |

Standalone skills, usable with or without the workflow:

| Skill | Purpose |
|---|---|
| `/task-workflow:cca-task-shape` | Shape a task via the CCA task-shape API (10-80-10 workflow) |
| `/task-workflow:scientific-method` | Hypothesis-driven investigation instead of guessing |
| `/task-workflow:investigation-review` | Adversarial review of an investigation verdict |
| `/task-workflow:task-management-init` | Bootstrap the lightweight `tasks/` ledger in a project |
| `/task-workflow:audit-rules` | Audit CLAUDE.md files for high-signal rules |
| `/task-workflow:mockups` | Quick frontend mockups for fast iteration |
| `/task-workflow:doc-init` | Set up the worklog/refs documentation system |
| `/task-workflow:doc-new-note` | Create a worklog note via the project script |
| `/task-workflow:doc-sweep` | End-of-day synthesis into daily/weekly summaries |

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
silently weaken intent and Git safety. See the [advanced CLI reference](docs/cli-reference.md).

`scripts/workflow.sh` is intentionally deprecated but remains available as a
v0.3.x compatibility wrapper. It invokes the same namespaced agents, but the
historical short prompt
contract cannot preserve the complete canonical handoff or reviewed-path commit
gates. Existing automation can migrate without an emergency break; all new
student and interactive work must use `task-start`.

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

- [Architecture](docs/architecture.md)
- [Advanced CLI reference](docs/cli-reference.md)
- [Quarantined historical lessons](docs/lessons-learned.md)

## License

[MIT](LICENSE)
