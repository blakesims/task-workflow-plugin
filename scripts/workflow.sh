#!/usr/bin/env bash
#
# Task Workflow Orchestrator
# Usage: workflow.sh <agent> <task-id> [phase] [extra-prompt]
#
# Examples:
#   workflow.sh planner T007 "" "Create an auth system with JWT"
#   workflow.sh plan-reviewer T007
#   workflow.sh executor T007 1
#   workflow.sh code-reviewer T007 1
#
# Outputs JSON to stdout, logs to stderr

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
SCHEMAS_DIR="$PLUGIN_DIR/schemas"

# Colors for stderr logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[workflow]${NC} $*" >&2; }
error() { echo -e "${RED}[workflow]${NC} $*" >&2; }
success() { echo -e "${GREEN}[workflow]${NC} $*" >&2; }

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <agent> <task-id> [phase] [extra-prompt]

Agents:
  planner        Create implementation plan
  plan-reviewer  Review plan, decide READY/NEEDS_WORK/NOT_READY
  executor       Execute a phase
  code-reviewer  Review executed code, decide PASS/REVISE/FAIL

Arguments:
  task-id        Task identifier (e.g., T007)
  phase          Phase number (required for executor, code-reviewer)
  extra-prompt   Additional context for the agent

Environment:
  WORKDIR        Project directory (default: current directory)
  TIMEOUT        Command timeout in seconds (default: 300)

EOF
  exit 1
}

# Validate arguments
[[ $# -lt 2 ]] && usage

AGENT="$1"
TASK_ID="$2"
PHASE="${3:-}"
EXTRA_PROMPT="${4:-}"
WORKDIR="${WORKDIR:-$(pwd)}"
TIMEOUT="${TIMEOUT:-300}"

# Map agent to schema and namespaced agent name
case "$AGENT" in
  planner)
    SCHEMA_FILE="$SCHEMAS_DIR/planner-output.json"
    AGENT_NAME="task-workflow:planner"
    ;;
  plan-reviewer)
    SCHEMA_FILE="$SCHEMAS_DIR/plan-reviewer-output.json"
    AGENT_NAME="task-workflow:plan-reviewer"
    ;;
  executor)
    SCHEMA_FILE="$SCHEMAS_DIR/executor-output.json"
    AGENT_NAME="task-workflow:executor"
    [[ -z "$PHASE" ]] && { error "executor requires phase number"; exit 1; }
    ;;
  code-reviewer)
    SCHEMA_FILE="$SCHEMAS_DIR/code-reviewer-output.json"
    AGENT_NAME="task-workflow:code-reviewer"
    [[ -z "$PHASE" ]] && { error "code-reviewer requires phase number"; exit 1; }
    ;;
  *)
    error "Unknown agent: $AGENT"
    usage
    ;;
esac

# Verify schema exists
[[ ! -f "$SCHEMA_FILE" ]] && { error "Schema not found: $SCHEMA_FILE"; exit 1; }

# Find task directory
TASK_DIR=$(find "$WORKDIR/tasks/active" -maxdepth 1 -type d -name "${TASK_ID}-*" 2>/dev/null | head -1)
if [[ -z "$TASK_DIR" ]]; then
  # Try planning directory
  TASK_DIR=$(find "$WORKDIR/tasks/planning" -maxdepth 1 -type d -name "${TASK_ID}-*" 2>/dev/null | head -1)
fi
if [[ -z "$TASK_DIR" ]]; then
  error "Task directory not found for $TASK_ID in $WORKDIR/tasks/{active,planning}/"
  exit 1
fi

MAIN_MD="$TASK_DIR/main.md"
[[ ! -f "$MAIN_MD" ]] && { error "main.md not found: $MAIN_MD"; exit 1; }

log "Agent: $AGENT_NAME"
log "Task: $TASK_ID ($TASK_DIR)"
[[ -n "$PHASE" ]] && log "Phase: $PHASE"

# Build prompt based on agent type
case "$AGENT" in
  planner)
    PROMPT="Create an implementation plan for task $TASK_ID. Task file: $MAIN_MD"
    [[ -n "$EXTRA_PROMPT" ]] && PROMPT="$PROMPT. Additional context: $EXTRA_PROMPT"
    ;;
  plan-reviewer)
    PROMPT="Review the plan in $MAIN_MD for task $TASK_ID"
    ;;
  executor)
    PROMPT="Execute Phase $PHASE from $MAIN_MD for task $TASK_ID"
    [[ -n "$EXTRA_PROMPT" ]] && PROMPT="$PROMPT. Notes: $EXTRA_PROMPT"
    ;;
  code-reviewer)
    PROMPT="Review the Phase $PHASE execution in $MAIN_MD for task $TASK_ID"
    ;;
esac

# Load schema
SCHEMA=$(cat "$SCHEMA_FILE")

# Build allowed tools based on agent
case "$AGENT" in
  planner|plan-reviewer|code-reviewer|executor)
    ALLOWED_TOOLS="Read,Write,Edit,Glob,Grep,Bash"
    ;;
esac

log "Running claude with timeout ${TIMEOUT}s..."

# Execute claude
cd "$WORKDIR"
timeout "$TIMEOUT" claude \
  --agent "$AGENT_NAME" \
  --output-format json \
  --json-schema "$SCHEMA" \
  --allowedTools "$ALLOWED_TOOLS" \
  -p "$PROMPT"

EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  success "Agent completed successfully"
elif [[ $EXIT_CODE -eq 124 ]]; then
  error "Agent timed out after ${TIMEOUT}s"
  exit 124
else
  error "Agent failed with exit code $EXIT_CODE"
  exit $EXIT_CODE
fi
