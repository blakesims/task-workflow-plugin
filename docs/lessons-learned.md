# Historical Lessons (Quarantined)

> **Historical evidence only — not operational documentation.** This page
> summarizes early experiments that predated the v0.3 canonical workflow. Do
> not copy old commands or use it for onboarding. Current usage is defined by
> the root [README](../README.md), [CLI reference](./cli-reference.md), and
> `/task-workflow:task-start`.

## What remains valid

- Independent plan and code review catch real defects and scope creep.
- Durable `main.md`, plan-review, and code-review artifacts make handoffs
  inspectable and resumable.
- Namespaced plugin agents prevent collisions.
- Validation tasks generally need fewer phases than implementation tasks.
- Source changes belong in this repository, never in a plugin cache.

## What was superseded

Early tests used a branch-specific orchestrator, direct per-agent shell calls,
legacy delegation names, executor commits, and ad-hoc plugin cache paths. Those
behaviors are intentionally not reproduced here. In v0.3.1:

- `/task-workflow:task-start` owns orchestration and the canonical handoff;
- the executor leaves changes uncommitted for independent review;
- the parent auto-commits only explicit reviewed paths after `PASS`;
- a clean selected workspace and recorded baseline are required per phase;
- push, PR, merge, deployment, force-push, and branch deletion are never
  automatic;
- `scripts/workflow.sh` is a deprecated tombstone, not an onboarding path;
- the Pi extension is an optional advanced experiment, not part of the Claude
  Code plugin workflow.

The detailed January 2026 experiment log was removed from active documentation
because its commands and role boundaries conflicted with the released workflow.
Git history remains the archive for maintainers who need that provenance.
