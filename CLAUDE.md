# Task Workflow Plugin

Multi-agent task workflow system for Claude Code.

## Skill Source Files

**IMPORTANT**: When improving skills in this plugin, edit the files HERE in the repo, not in `~/.claude/skills/`.

The `~/.claude/skills/` directory contains cached copies that get overwritten on plugin reload. Edits there will be lost.

Each skill has `source_repo` and `source_path` in its frontmatter pointing back to this repo.

## Structure

```
skills/           # Skill definitions (SKILL.md files)
agents/           # Agent definitions
docs/             # Architecture, advanced CLI reference, quarantined history
schemas/          # JSON schemas for advanced structured-output integrations
scripts/          # Release validator, fresh-install smoke, deprecated wrapper
```

## Development

When developing, use `--plugin-dir` to load directly from repo:

```bash
claude --plugin-dir ~/repos/task-workflow-plugin
```

This ensures you're always using the latest source, not a cached copy.
