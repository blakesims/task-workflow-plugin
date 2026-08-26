---
name: start
description: Compatibility alias for the canonical task-start workflow.
user-invocable: true
disable-model-invocation: true
source_repo: https://github.com/blakesims/task-workflow-plugin
source_path: skills/start/SKILL.md
---

# Start — compatibility alias

This command is retained for existing `/task-workflow:start` users.

Read `${CLAUDE_PLUGIN_ROOT}/skills/task-start/SKILL.md` and follow it exactly, passing through the user's original task request.

Do not execute or reconstruct the historical branch-specific workflow from this wrapper.

Preferred entry point for new documentation:

```text
/task-workflow:task-start
```
