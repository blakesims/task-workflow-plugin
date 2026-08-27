# Advanced CLI Reference

The supported onboarding path is the interactive skill:

```text
/task-workflow:task-start
```

It owns intent capture, the complete Task Workflow Handoff Packet, runtime Git
strategy, review loops, and reviewed-path commits. Do not teach new users to
invoke specialist agents one-by-one.

## Trust, workspace, and delivery boundary

The specialist agents are high-trust roles with Bash, Edit, and Write access so
they can inspect repositories, persist task/review artifacts, and run checks.
Use them only in a trusted repository. Begin from a clean feature branch unless
project instructions explicitly choose a clean current branch or isolated
worktree.

After a review `PASS`, the parent orchestrator auto-commits only explicit paths
the reviewer inspected. It never automatically pushes, opens or merges a PR,
deploys, force-pushes, or deletes a branch. Explicit authorization (or an
already-authorized repository workflow) is required for those actions.

## Advanced external orchestration

Claude Code 2.1.23+ supports direct namespaced agent calls. External systems may
use this interface only if they reproduce the canonical handoff and gate
contract from `skills/task-start/SKILL.md`:

```bash
claude --plugin-dir /path/to/task-workflow-plugin \
  --agent task-workflow:planner \
  --output-format json \
  --json-schema "$(cat /path/to/task-workflow-plugin/schemas/planner-output.json)" \
  -p "<complete Task Workflow Handoff Packet, including verbatim DONE_WHEN>"
```

| Agent | Full name | Structured gate |
|---|---|---|
| planner | `task-workflow:planner` | submits plan |
| plan reviewer | `task-workflow:plan-reviewer` | `READY` / `NEEDS_WORK` / `NOT_READY` |
| executor | `task-workflow:executor` | `COMPLETE` / `BLOCKED` |
| code reviewer | `task-workflow:code-reviewer` | `PASS` / `REVISE` / `FAIL` |

Schemas live in `schemas/`. In native interactive orchestration, the `Agent`
tool starts these namespaced roles and durable Markdown artifacts carry gates.
External callers may use JSON schemas, but schema validity does not replace the
handoff packet, baseline checks, artifact writes, or review loop.

## Deprecated shell wrapper

`scripts/workflow.sh` remains as a deprecated v0.3.x compatibility wrapper. It
invokes the same namespaced agents and preserves existing automation, but its
historical short prompts cannot carry the complete Handoff Packet or enforce
reviewed-path commit gates. New integrations must use
`/task-workflow:task-start` or build against the canonical skill contract.

## Safe validation and discovery smoke

```bash
python3 scripts/validate-plugin.py
claude plugin validate --strict .
scripts/smoke-install.sh
```

The smoke creates a temporary fresh copy and project bootstrap. If Claude CLI is
available, default mode performs a tool-disabled, sessionless skill invocation.
Use `--static` in unauthenticated CI or `--runtime` when runtime discovery must
be mandatory.

## Optional Pi extension

`pi-extension/` is an optional advanced experiment, separate from Claude Code
plugin onboarding and runtime. Its deterministic graph-engine test is:

```bash
cd pi-extension
npm ci
npm test
```

`test-spawn-worker.ts` and `test-orchestrator.ts` require a live Pi/LLM setup and
are intentionally not CI tests.

## Troubleshooting

- **Agent not found:** validate the plugin, then confirm `--plugin-dir` or the
  marketplace install points to this release.
- **Unknown `--agent`:** update Claude Code to 2.1.23 or newer.
- **Write denied:** prefer interactive `task-start`; do not broadly bypass
  permissions in an untrusted repository.
- **Dirty workspace:** preserve unrelated work and use a separate worktree when
  repository policy permits; never “fix” it with stash/reset/delete.
