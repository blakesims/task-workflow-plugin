#!/usr/bin/env bash
# Merge Queue CLI — manage merge queue items for serialized branch merges
# Usage:
#   merge-queue.sh add --task-id T032 --branch feat/t032 --project-dir /path [--priority high]
#   merge-queue.sh list [--format yaml|json]
#   merge-queue.sh next
#   merge-queue.sh start <id>
#   merge-queue.sh complete <id> [--merge-commit <sha>]
#   merge-queue.sh fail <id> --reason "..."
#   merge-queue.sh remove <id>
#   merge-queue.sh status

set -euo pipefail

# --- Configuration (env var overrides) ---
QUEUE_FILE="${MERGE_QUEUE_FILE:-tasks/merge-queue.yaml}"
LOCK_FILE="${MERGE_QUEUE_LOCK_FILE:-}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Derive lock file from queue file location if not explicitly set
if [ -z "$LOCK_FILE" ]; then
  LOCK_FILE="$(dirname "$QUEUE_FILE")/.merge-queue.lock"
fi

# --- Helpers ---

# Ensure queue file exists with correct schema (Task 1.2: auto-initialization)
ensure_files() {
  if [ ! -f "$QUEUE_FILE" ]; then
    mkdir -p "$(dirname "$QUEUE_FILE")"
    cat > "$QUEUE_FILE" <<'YAML'
schema_version: 1
config:
  auto_push: false
  target_branch: main
next_id: 1
last_updated: null
queue: []
YAML
  fi
}

# Backup before write
backup_file() {
  local f="$1"
  if [ -f "$f" ]; then
    cp "$f" "${f}.bak"
  fi
}

# Execute a write operation under flock
locked_write() {
  local callback="$1"
  shift
  mkdir -p "$(dirname "$LOCK_FILE")"
  (
    flock -w 10 200 || { echo "error: could not acquire lock" >&2; exit 1; }
    "$callback" "$@"
  ) 200>"$LOCK_FILE"
}

# --- Subcommands ---

cmd_add() {
  local task_id="" branch="" project_dir="" priority="normal"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --task-id) task_id="$2"; shift 2 ;;
      --branch) branch="$2"; shift 2 ;;
      --project-dir) project_dir="$2"; shift 2 ;;
      --priority) priority="$2"; shift 2 ;;
      *) echo "error: unknown argument to add: $1" >&2; exit 1 ;;
    esac
  done

  # Validate required fields
  if [ -z "$task_id" ]; then
    echo "error: --task-id is required" >&2; exit 1
  fi
  if [ -z "$branch" ]; then
    echo "error: --branch is required" >&2; exit 1
  fi
  if [ -z "$project_dir" ]; then
    echo "error: --project-dir is required" >&2; exit 1
  fi

  # Validate enum fields
  case "$priority" in
    high|normal) ;;
    *) echo "error: --priority must be one of: high, normal" >&2; exit 1 ;;
  esac

  locked_write _do_add "$task_id" "$branch" "$project_dir" "$priority"
}

_do_add() {
  local task_id="$1" branch="$2" project_dir="$3" priority="$4"

  ensure_files
  backup_file "$QUEUE_FILE"

  python3 -c "
import yaml, sys

queue_file = sys.argv[1]
task_id = sys.argv[2]
branch = sys.argv[3]
project_dir = sys.argv[4]
priority = sys.argv[5]
now = sys.argv[6]

with open(queue_file, 'r') as f:
    data = yaml.safe_load(f)

item_id = data.get('next_id', 1)
data['next_id'] = item_id + 1
data['last_updated'] = now

item = {
    'id': item_id,
    'task_id': task_id,
    'branch': branch,
    'project_dir': project_dir,
    'status': 'pending',
    'priority': priority,
    'added_at': now,
    'started_at': None,
    'completed_at': None,
    'merge_commit': None,
    'failure_reason': None,
}

if data.get('queue') is None:
    data['queue'] = []
data['queue'].append(item)

with open(queue_file, 'w') as f:
    yaml.dump(data, f, default_flow_style=False, sort_keys=False)

print(f'added: id={item_id} task_id={task_id} branch={branch}')
" "$QUEUE_FILE" "$task_id" "$branch" "$project_dir" "$priority" "$NOW"
}

cmd_list() {
  local format="yaml"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format) format="$2"; shift 2 ;;
      *) echo "error: unknown argument to list: $1" >&2; exit 1 ;;
    esac
  done

  ensure_files

  case "$format" in
    yaml)
      python3 -c "
import yaml, sys
with open(sys.argv[1], 'r') as f:
    data = yaml.safe_load(f)
queue = data.get('queue', [])
if not queue:
    print('queue: []')
else:
    print(yaml.dump({'queue': queue}, default_flow_style=False, sort_keys=False).rstrip())
" "$QUEUE_FILE"
      ;;
    json)
      python3 -c "
import yaml, json, sys
with open(sys.argv[1], 'r') as f:
    data = yaml.safe_load(f)
print(json.dumps(data.get('queue', []), indent=2))
" "$QUEUE_FILE"
      ;;
    *) echo "error: --format must be yaml or json" >&2; exit 1 ;;
  esac
}

cmd_next() {
  ensure_files

  python3 -c "
import yaml, sys

with open(sys.argv[1], 'r') as f:
    data = yaml.safe_load(f)

queue = data.get('queue', [])
pending = [item for item in queue if item.get('status') == 'pending']

if not pending:
    print('none')
    sys.exit(0)

# Priority-aware: high before normal, FIFO within tier
priority_order = {'high': 0, 'normal': 1}
pending.sort(key=lambda x: (priority_order.get(x.get('priority', 'normal'), 1)))

item = pending[0]
print(yaml.dump(item, default_flow_style=False, sort_keys=False).rstrip())
" "$QUEUE_FILE"
}

cmd_start() {
  local item_id="${1:-}"
  if [ -z "$item_id" ]; then
    echo "usage: merge-queue.sh start <id>" >&2; exit 1
  fi

  locked_write _do_start "$item_id"
}

_do_start() {
  local item_id="$1"

  ensure_files
  backup_file "$QUEUE_FILE"

  python3 -c "
import yaml, sys

item_id = int(sys.argv[1])
queue_file = sys.argv[2]
now = sys.argv[3]

with open(queue_file, 'r') as f:
    data = yaml.safe_load(f)

queue = data.get('queue', [])
found = False
for item in queue:
    if item.get('id') == item_id:
        if item.get('status') != 'pending':
            print(f'error: item {item_id} is not pending (status: {item.get(\"status\")})', file=sys.stderr)
            sys.exit(1)
        item['status'] = 'in_progress'
        item['started_at'] = now
        found = True
        break

if not found:
    print(f'error: item {item_id} not found', file=sys.stderr)
    sys.exit(1)

data['last_updated'] = now

with open(queue_file, 'w') as f:
    yaml.dump(data, f, default_flow_style=False, sort_keys=False)

print(f'started: id={item_id}')
" "$item_id" "$QUEUE_FILE" "$NOW"
}

cmd_complete() {
  local item_id="${1:-}"
  shift || true
  local merge_commit=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --merge-commit) merge_commit="$2"; shift 2 ;;
      *) echo "error: unknown argument to complete: $1" >&2; exit 1 ;;
    esac
  done

  if [ -z "$item_id" ]; then
    echo "usage: merge-queue.sh complete <id> [--merge-commit <sha>]" >&2; exit 1
  fi

  locked_write _do_complete "$item_id" "$merge_commit"
}

_do_complete() {
  local item_id="$1" merge_commit="$2"

  ensure_files
  backup_file "$QUEUE_FILE"

  python3 -c "
import yaml, sys

item_id = int(sys.argv[1])
merge_commit = sys.argv[2] if sys.argv[2] else None
queue_file = sys.argv[3]
now = sys.argv[4]

with open(queue_file, 'r') as f:
    data = yaml.safe_load(f)

queue = data.get('queue', [])
found = False
for item in queue:
    if item.get('id') == item_id:
        if item.get('status') != 'in_progress':
            print(f'error: item {item_id} is not in_progress (status: {item.get(\"status\")})', file=sys.stderr)
            sys.exit(1)
        item['status'] = 'merged'
        item['completed_at'] = now
        if merge_commit:
            item['merge_commit'] = merge_commit
        found = True
        break

if not found:
    print(f'error: item {item_id} not found', file=sys.stderr)
    sys.exit(1)

data['last_updated'] = now

with open(queue_file, 'w') as f:
    yaml.dump(data, f, default_flow_style=False, sort_keys=False)

print(f'completed: id={item_id}' + (f' merge_commit={merge_commit}' if merge_commit else ''))
" "$item_id" "$merge_commit" "$QUEUE_FILE" "$NOW"
}

# Task 1.4: fail command with --reason flag
cmd_fail() {
  local item_id="${1:-}"
  shift || true
  local reason=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --reason) reason="$2"; shift 2 ;;
      *) echo "error: unknown argument to fail: $1" >&2; exit 1 ;;
    esac
  done

  if [ -z "$item_id" ]; then
    echo "usage: merge-queue.sh fail <id> --reason \"...\"" >&2; exit 1
  fi
  if [ -z "$reason" ]; then
    echo "error: --reason is required for fail" >&2; exit 1
  fi

  locked_write _do_fail "$item_id" "$reason"
}

_do_fail() {
  local item_id="$1" reason="$2"

  ensure_files
  backup_file "$QUEUE_FILE"

  python3 -c "
import yaml, sys

item_id = int(sys.argv[1])
reason = sys.argv[2]
queue_file = sys.argv[3]
now = sys.argv[4]

with open(queue_file, 'r') as f:
    data = yaml.safe_load(f)

queue = data.get('queue', [])
found = False
for item in queue:
    if item.get('id') == item_id:
        if item.get('status') != 'in_progress':
            print(f'error: item {item_id} is not in_progress (status: {item.get(\"status\")})', file=sys.stderr)
            sys.exit(1)
        item['status'] = 'failed'
        item['completed_at'] = now
        item['failure_reason'] = reason
        found = True
        break

if not found:
    print(f'error: item {item_id} not found', file=sys.stderr)
    sys.exit(1)

data['last_updated'] = now

with open(queue_file, 'w') as f:
    yaml.dump(data, f, default_flow_style=False, sort_keys=False)

print(f'failed: id={item_id} reason=\"{reason}\"')
" "$item_id" "$reason" "$QUEUE_FILE" "$NOW"
}

cmd_remove() {
  local item_id="${1:-}"
  if [ -z "$item_id" ]; then
    echo "usage: merge-queue.sh remove <id>" >&2; exit 1
  fi

  locked_write _do_remove "$item_id"
}

_do_remove() {
  local item_id="$1"

  ensure_files
  backup_file "$QUEUE_FILE"

  python3 -c "
import yaml, sys

item_id = int(sys.argv[1])
queue_file = sys.argv[2]
now = sys.argv[3]

with open(queue_file, 'r') as f:
    data = yaml.safe_load(f)

queue = data.get('queue', [])
new_queue = []
found = False
for item in queue:
    if item.get('id') == item_id:
        found = True
    else:
        new_queue.append(item)

if not found:
    print(f'error: item {item_id} not found', file=sys.stderr)
    sys.exit(1)

data['queue'] = new_queue
data['last_updated'] = now

with open(queue_file, 'w') as f:
    yaml.dump(data, f, default_flow_style=False, sort_keys=False)

print(f'removed: id={item_id}')
" "$item_id" "$QUEUE_FILE" "$NOW"
}

cmd_status() {
  ensure_files

  python3 -c "
import yaml, sys

with open(sys.argv[1], 'r') as f:
    data = yaml.safe_load(f)

queue = data.get('queue', [])

counts = {'pending': 0, 'in_progress': 0, 'merged': 0, 'failed': 0}
for item in queue:
    status = item.get('status', 'pending')
    if status in counts:
        counts[status] += 1

total = len(queue)
print(f'## Merge Queue Status')
print(f'')
print(f'- **Total:** {total}')
print(f'- **Pending:** {counts[\"pending\"]}')
print(f'- **In Progress:** {counts[\"in_progress\"]}')
print(f'- **Merged:** {counts[\"merged\"]}')
print(f'- **Failed:** {counts[\"failed\"]}')

# Show pending items
pending = [i for i in queue if i.get('status') == 'pending']
if pending:
    print(f'')
    print(f'### Pending')
    for item in pending:
        priority_tag = f' [HIGH]' if item.get('priority') == 'high' else ''
        print(f'- #{item.get(\"id\", \"?\")} {item.get(\"task_id\", \"?\")} ({item.get(\"branch\", \"?\")}){priority_tag}')

# Show in-progress items
in_progress = [i for i in queue if i.get('status') == 'in_progress']
if in_progress:
    print(f'')
    print(f'### In Progress')
    for item in in_progress:
        print(f'- #{item.get(\"id\", \"?\")} {item.get(\"task_id\", \"?\")} ({item.get(\"branch\", \"?\")})')

# Show failed items
failed = [i for i in queue if i.get('status') == 'failed']
if failed:
    print(f'')
    print(f'### Failed')
    for item in failed:
        reason = item.get('failure_reason', 'unknown')
        print(f'- #{item.get(\"id\", \"?\")} {item.get(\"task_id\", \"?\")} -- {reason}')
" "$QUEUE_FILE"
}

# --- Main ---
case "${1:-}" in
  add)
    shift
    cmd_add "$@"
    ;;
  list)
    shift
    cmd_list "$@"
    ;;
  next)
    cmd_next
    ;;
  start)
    shift
    cmd_start "$@"
    ;;
  complete)
    shift
    cmd_complete "$@"
    ;;
  fail)
    shift
    cmd_fail "$@"
    ;;
  remove)
    shift
    cmd_remove "$@"
    ;;
  status)
    cmd_status
    ;;
  *)
    echo "usage: merge-queue.sh {add|list|next|start|complete|fail|remove|status}" >&2
    echo "" >&2
    echo "  add        -- add new queue item (--task-id, --branch, --project-dir, [--priority])" >&2
    echo "  list       -- list all queue items (--format yaml|json)" >&2
    echo "  next       -- get next pending item (priority-aware)" >&2
    echo "  start <id> -- mark item as in_progress" >&2
    echo "  complete <id> -- mark item as merged (--merge-commit <sha>)" >&2
    echo "  fail <id>  -- mark item as failed (--reason \"...\")" >&2
    echo "  remove <id> -- remove item from queue" >&2
    echo "  status     -- show queue summary" >&2
    exit 1
    ;;
esac
