#!/usr/bin/env bash
# Deprecated compatibility tombstone. The old per-agent CLI wrapper cannot
# preserve the canonical Task Workflow Handoff Packet or review/commit gates.
set -euo pipefail

cat >&2 <<'EOF'
workflow.sh is deprecated and intentionally unsupported as of v0.3.1.

Use the canonical interactive entry point instead:
  /task-workflow:task-start

The task-start orchestrator preserves the Intent Contract, DONE_WHEN, complete
handoff packet, clean-workspace checks, review gates, and reviewed-path commits.
Direct per-agent CLI invocation is an advanced integration surface; see
README.md and docs/cli-reference.md.
EOF
exit 64
