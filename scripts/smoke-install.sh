#!/usr/bin/env bash
# Deterministic fresh-copy discovery/bootstrap smoke. The optional runtime check
# disables tools and session persistence, so it cannot modify the test project.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---auto}"
case "$MODE" in
  --auto|--static|--runtime) ;;
  *) echo "usage: $0 [--auto|--static|--runtime]" >&2; exit 64 ;;
esac

TMP="$(mktemp -d "${TMPDIR:-/tmp}/task-workflow-smoke.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
INSTALL="$TMP/plugin"
PROJECT="$TMP/project"
mkdir -p "$INSTALL" "$PROJECT/tasks"/{planning,active,paused,completed}

# Copy only the release surfaces needed by Claude Code; do not depend on Git,
# user plugin caches, or the source checkout after this point.
for path in .claude-plugin .github agents docs pi-extension schemas scripts skills templates LICENSE; do
  cp -R "$ROOT/$path" "$INSTALL/$path"
done
cp "$ROOT/README.md" "$INSTALL/README.md"
rm -rf "$INSTALL/pi-extension/node_modules"

python3 "$INSTALL/scripts/validate-plugin.py" --root "$INSTALL"
cp "$INSTALL/templates/main.md" "$PROJECT/tasks/main-template.md"
cp "$INSTALL/templates/global-task-manager.md" "$PROJECT/tasks/global-task-manager.md"
cp "$INSTALL/templates/CLAUDE.md" "$PROJECT/tasks/CLAUDE.md"
for path in \
  tasks/main-template.md \
  tasks/global-task-manager.md \
  tasks/CLAUDE.md \
  tasks/planning tasks/active tasks/paused tasks/completed; do
  [[ -e "$PROJECT/$path" ]] || { echo "bootstrap missing: $path" >&2; exit 1; }
done
printf '%s\n' "Fresh-copy bootstrap smoke passed."

if command -v claude >/dev/null 2>&1; then
  claude plugin validate --strict "$INSTALL"
else
  [[ "$MODE" != "--runtime" ]] || { echo "claude is required for --runtime" >&2; exit 1; }
  printf '%s\n' "Claude CLI not found; runtime invocation skipped."
  printf '%s\n' "Task Workflow fresh-install smoke passed (static only)."
  exit 0
fi

if [[ "$MODE" == "--static" ]]; then
  printf '%s\n' "Task Workflow fresh-install smoke passed (static only)."
  exit 0
fi

set +e
OUTPUT="$({ cd "$PROJECT" && timeout "${CLAUDE_SMOKE_TIMEOUT:-120}" claude \
  --plugin-dir "$INSTALL" \
  --tools "" \
  --permission-mode dontAsk \
  --no-session-persistence \
  --model "${CLAUDE_SMOKE_MODEL:-haiku}" \
  --max-budget-usd "${CLAUDE_SMOKE_MAX_BUDGET_USD:-0.10}" \
  -p '/task-workflow:task-start Discovery-only smoke: do not use tools, create files, or start agents. If this skill is loaded, reply exactly TASK_WORKFLOW_DISCOVERED.'; } 2>&1)"
STATUS=$?
set -e
if [[ $STATUS -ne 0 ]]; then
  if [[ "$MODE" == "--auto" ]] && grep -Eqi 'auth|login|api key|credit balance' <<<"$OUTPUT"; then
    printf '%s\n' "Claude CLI found but unauthenticated; runtime invocation skipped."
    printf '%s\n' "Task Workflow fresh-install smoke passed (static only)."
    exit 0
  fi
  printf '%s\n' "$OUTPUT" >&2
  echo "Claude runtime smoke failed with exit $STATUS" >&2
  exit "$STATUS"
fi
[[ "$OUTPUT" == *"TASK_WORKFLOW_DISCOVERED"* ]] || {
  printf '%s\n' "$OUTPUT" >&2
  echo "Claude did not confirm task-start discovery" >&2
  exit 1
}
[[ -z "$(find "$PROJECT" -mindepth 1 -not -path "$PROJECT/tasks*" -print -quit)" ]] || {
  echo "runtime smoke created an unexpected project file" >&2
  exit 1
}
printf '%s\n' "Task Workflow fresh-install smoke passed (Claude runtime discovery confirmed)."
