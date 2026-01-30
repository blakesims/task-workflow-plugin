# CLI Reference

## Requirements

- **Claude Code v2.1.23+** — The `--agent` flag for invoking plugin agents was added in this version

## Installation

The plugin can be installed via marketplace:

```bash
# Add the marketplace
/plugin marketplace add ~/repos/task-workflow-plugin

# Install the plugin
/plugin install task-workflow@task-workflow-marketplace
```

Or for development:
```bash
claude --plugin-dir ~/repos/task-workflow-plugin
```

## Two Orchestration Modes

This plugin supports two orchestration patterns:

### 1. External Orchestrator (scripts, CI, custom agents)

Use the CLI with `-p` mode:

```bash
claude --agent task-workflow:planner \
  -p "Create plan for T007" \
  --output-format json \
  --json-schema "$(cat schemas/planner-output.json)"
```

**Pros:**
- Schema validation via `--json-schema`
- Structured JSON output for parsing gates
- Works from any environment

**Cons:**
- Requires PTY for external orchestrators (see lessons-learned.md)
- Process spawn overhead

### 2. Claude Code as Orchestrator

Use the Task tool with `subagent_type`:

```
Task(
  subagent_type="task-workflow:planner",
  prompt="Create plan for T007..."
)
```

**Pros:**
- Native integration, no PTY issues
- Lower overhead
- Easy parallel execution

**Cons:**
- No `--json-schema` support (text output only)
- Gate parsing requires reading main.md

## Agent Names

Plugin agents are namespaced. Always use the full name:

| Agent | Full Name |
|-------|-----------|
| planner | `task-workflow:planner` |
| plan-reviewer | `task-workflow:plan-reviewer` |
| executor | `task-workflow:executor` |
| code-reviewer | `task-workflow:code-reviewer` |
| phase-reviewer | `task-workflow:phase-reviewer` |

## workflow.sh Script

The `scripts/workflow.sh` orchestrator script wraps the CLI with sensible defaults:

```bash
# Usage
workflow.sh <agent> <task-id> [phase] [extra-prompt]

# Examples
workflow.sh planner T007 "" "Create an auth system with JWT"
workflow.sh plan-reviewer T007
workflow.sh executor T007 1
workflow.sh code-reviewer T007 1
workflow.sh phase-reviewer T007 2
```

Features:
- Auto-finds task directory by ID pattern (`T007-*`)
- Loads correct JSON schema per agent
- Sets appropriate `--allowedTools` per role
- JSON output to stdout, logs to stderr
- Configurable timeout (default 5 min)

Environment variables:
- `WORKDIR` — Project directory (default: current directory)
- `TIMEOUT` — Command timeout in seconds (default: 300)

## CLI Flags Reference

### Essential Flags

| Flag | Purpose |
|------|---------|
| `--agent <name>` | Invoke a named agent (e.g., `task-workflow:planner`) |
| `-p <prompt>` | Non-interactive mode, required for scripting |
| `--output-format json` | Return structured JSON with metadata |
| `--json-schema <schema>` | Validate output against JSON schema |
| `--allowedTools <tools>` | Auto-approve specific tools |

### Recommended Tool Permissions

```bash
# Read-only agents (planner, plan-reviewer, code-reviewer)
--allowedTools "Read,Glob,Grep,Bash(git *)"

# Executor (needs write access)
--allowedTools "Read,Write,Edit,Glob,Grep,Bash"

# Phase-reviewer (can update plan)
--allowedTools "Read,Edit,Glob,Grep,Bash(git *)"
```

### Full Command Template

```bash
cd "$PROJECT_DIR" && claude \
  --agent task-workflow:executor \
  --output-format json \
  --json-schema "$(cat schemas/executor-output.json)" \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash" \
  -p "Execute Phase 1 from tasks/active/T007-feature/main.md"
```

## Parsing Output

The JSON output includes metadata and structured output:

```bash
# Extract the gate decision
workflow.sh plan-reviewer T007 | jq '.structured_output.gate'

# Check if all checklist items passed
workflow.sh executor T007 1 | jq '.structured_output.checklist | to_entries | all(.value == true)'

# Get summary
workflow.sh code-reviewer T007 1 | jq -r '.structured_output.summary'
```

## Troubleshooting

### "unknown option '--agent'"
Update Claude Code: `claude update` or `npm update -g @anthropic-ai/claude-code`

### Agent not found
Ensure the plugin is installed. Check with `/plugin` in Claude Code.

### Timeout with no output (external orchestrator)
Use PTY when spawning from external tools. See lessons-learned.md section on PTY.

### Permission denied on file writes
Add write tools: `--allowedTools "Read,Write,Edit,Bash"`
