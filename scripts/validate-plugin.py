#!/usr/bin/env python3
"""Validate canonical task-workflow plugin structure and references."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_AGENTS = {
    "planner",
    "plan-reviewer",
    "executor",
    "code-reviewer",
    "phase-reviewer",
}
EXPECTED_SKILLS = {"task-start", "intent-harden", "start", "task-workflow"}


def frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text()
    if not text.startswith("---\n"):
        raise ValueError(f"{path.relative_to(ROOT)}: missing YAML frontmatter")
    _, raw, _ = text.split("---", 2)
    result: dict[str, str] = {}
    for line in raw.strip().splitlines():
        if ":" in line and not line.startswith((" ", "\t", "-")):
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip()
    return result


def check(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def main() -> int:
    errors: list[str] = []

    plugin = json.loads((ROOT / ".claude-plugin/plugin.json").read_text())
    marketplace = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())
    market_version = marketplace["plugins"][0]["version"]
    check(plugin["version"] == market_version, "plugin and marketplace versions differ", errors)

    agent_names = set()
    for path in sorted((ROOT / "agents").glob("*.md")):
        try:
            agent_names.add(frontmatter(path).get("name", ""))
        except ValueError as exc:
            errors.append(str(exc))
    check(EXPECTED_AGENTS <= agent_names, f"missing agents: {sorted(EXPECTED_AGENTS - agent_names)}", errors)

    for skill in EXPECTED_SKILLS:
        path = ROOT / "skills" / skill / "SKILL.md"
        check(path.exists(), f"missing skill: {skill}", errors)
        if path.exists():
            try:
                check(frontmatter(path).get("name") == skill, f"{path.relative_to(ROOT)}: wrong name", errors)
            except ValueError as exc:
                errors.append(str(exc))

    task_start_meta = frontmatter(ROOT / "skills/task-start/SKILL.md")
    check(task_start_meta.get("user-invocable") == "true", "task-start is not user-invocable", errors)
    check(
        task_start_meta.get("disable-model-invocation") == "true",
        "task-start can be invoked automatically despite side effects",
        errors,
    )

    task_start = (ROOT / "skills/task-start/SKILL.md").read_text()
    for agent in EXPECTED_AGENTS:
        check(f"task-workflow:{agent}" in task_start, f"task-start does not reference {agent}", errors)
    check("/task-workflow:intent-harden" in task_start, "task-start does not offer intent-harden", errors)
    check("Task(subagent_type" not in task_start, "task-start uses legacy Task delegation", errors)
    check(
        "Never use `git add .`, `git add -A`" in task_start,
        "task-start lacks broad-staging prohibition",
        errors,
    )
    check(not (ROOT / "schemas/merge-reviewer-output.json").exists(), "obsolete merge-reviewer schema still ships", errors)
    code_schema = (ROOT / "schemas/code-reviewer-output.json").read_text()
    check("MERGE_REVIEW" not in code_schema, "code-reviewer schema references removed MERGE_REVIEW state", errors)
    alias = (ROOT / "skills/start/SKILL.md").read_text()
    check("${CLAUDE_PLUGIN_ROOT}/skills/task-start/SKILL.md" in alias, "start alias does not read canonical task-start", errors)
    check("`Skill` tool" not in alias, "start alias tries to model-invoke protected task-start", errors)

    template = (ROOT / "templates/main.md").read_text()
    for field in ("DONE_WHEN", "Runtime Strategy", "Baseline SHA", "Intent hardening", "Plan Review", "Code Review Log"):
        check(field in template, f"template missing {field}", errors)

    if errors:
        print("Plugin validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Plugin validation passed (version {plugin['version']}; {len(agent_names)} agents; {len(EXPECTED_SKILLS)} canonical skills).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
