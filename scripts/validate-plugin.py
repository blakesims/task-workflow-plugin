#!/usr/bin/env python3
"""Validate the canonical task-workflow plugin release surfaces."""

from __future__ import annotations

import argparse
import json
import stat
import sys
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
RELEASE_VERSION = "0.3.1"
EXPECTED_AGENTS = {"planner", "plan-reviewer", "executor", "code-reviewer"}
EXPECTED_SKILLS = {"task-start", "intent-harden", "start", "task-workflow"}
HIGH_TRUST_TOOLS = {"Bash", "Edit", "Write"}


def frontmatter(path: Path, root: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"{path.relative_to(root)}: missing YAML frontmatter")
    _, raw, _ = text.split("---", 2)
    result: dict[str, str] = {}
    for line in raw.strip().splitlines():
        if ":" in line and not line.startswith((" ", "\t", "-")):
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip()
    return result


def load_json(path: Path, root: Path, errors: list[str]) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{path.relative_to(root)}: invalid JSON: {exc}")
        return None


def check(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    required = [
        ".claude-plugin/plugin.json",
        ".claude-plugin/marketplace.json",
        ".github/workflows/ci.yml",
        "LICENSE",
        "README.md",
        "docs/architecture.md",
        "docs/cli-reference.md",
        "docs/lessons-learned.md",
        "scripts/smoke-install.sh",
        "scripts/workflow.sh",
        "pi-extension/package.json",
        "templates/main.md",
        "templates/global-task-manager.md",
        "templates/CLAUDE.md",
    ]
    required += [f"agents/{name}.md" for name in sorted(EXPECTED_AGENTS)]
    required += [f"skills/{name}/SKILL.md" for name in sorted(EXPECTED_SKILLS)]
    required += [f"schemas/{name}-output.json" for name in sorted(EXPECTED_AGENTS)]
    for relative in required:
        check((root / relative).exists(), f"missing release file: {relative}", errors)
    if errors:
        return errors

    plugin = load_json(root / ".claude-plugin/plugin.json", root, errors)
    marketplace = load_json(root / ".claude-plugin/marketplace.json", root, errors)
    if not isinstance(plugin, dict) or not isinstance(marketplace, dict):
        return errors
    listings = marketplace.get("plugins")
    check(isinstance(listings, list) and len(listings) == 1, "marketplace must contain exactly one plugin", errors)
    listing = listings[0] if isinstance(listings, list) and listings and isinstance(listings[0], dict) else {}
    versions = {plugin.get("version"), marketplace.get("version"), listing.get("version")}
    check(versions == {RELEASE_VERSION}, f"plugin and marketplace versions must all be {RELEASE_VERSION}", errors)
    check(plugin.get("name") == "task-workflow", "plugin name must be task-workflow", errors)
    check(listing.get("name") == plugin.get("name"), "marketplace plugin name differs", errors)
    check(listing.get("source") == "./", "marketplace source must be ./", errors)
    check(plugin.get("license") == "MIT", "plugin metadata license must be MIT", errors)

    license_text = (root / "LICENSE").read_text(encoding="utf-8")
    check("MIT License" in license_text and "Permission is hereby granted" in license_text, "LICENSE is not the MIT license text", errors)

    agent_names: set[str] = set()
    for path in sorted((root / "agents").glob("*.md")):
        try:
            meta = frontmatter(path, root)
            name = meta.get("name", "")
            agent_names.add(name)
            tools = {part.strip() for part in meta.get("tools", "").split(",") if part.strip()}
            check(HIGH_TRUST_TOOLS <= tools, f"{path.relative_to(root)} must declare Bash, Edit, and Write", errors)
        except ValueError as exc:
            errors.append(str(exc))
    check(agent_names == EXPECTED_AGENTS, f"agent set differs: expected {sorted(EXPECTED_AGENTS)}, got {sorted(agent_names)}", errors)

    skill_dirs = {path.parent.name for path in (root / "skills").glob("*/SKILL.md")}
    check(skill_dirs == EXPECTED_SKILLS, f"skill set differs: expected {sorted(EXPECTED_SKILLS)}, got {sorted(skill_dirs)}", errors)
    for skill in EXPECTED_SKILLS:
        path = root / "skills" / skill / "SKILL.md"
        if path.exists():
            try:
                check(frontmatter(path, root).get("name") == skill, f"{path.relative_to(root)}: wrong name", errors)
            except ValueError as exc:
                errors.append(str(exc))

    try:
        task_start_meta = frontmatter(root / "skills/task-start/SKILL.md", root)
    except ValueError as exc:
        errors.append(str(exc))
        task_start_meta = {}
    check(task_start_meta.get("user-invocable") == "true", "task-start is not user-invocable", errors)
    check(task_start_meta.get("disable-model-invocation") != "true", "task-start blocks natural-language invocation", errors)
    task_start = (root / "skills/task-start/SKILL.md").read_text(encoding="utf-8")
    for agent in EXPECTED_AGENTS:
        check(f"task-workflow:{agent}" in task_start, f"task-start does not reference {agent}", errors)
    for required_phrase in (
        "/task-workflow:intent-harden",
        "quickfix",
        "Require `git status --short` empty",
        "Never use `git add .`, `git add -A`",
        "do not push, merge, open a PR, or deploy unless authorized",
    ):
        check(required_phrase in task_start, f"task-start lacks canonical rule: {required_phrase}", errors)
    check("phase-reviewer" not in task_start, "task-start references removed phase-reviewer", errors)
    check("Task(subagent_type" not in task_start, "task-start uses legacy Task delegation", errors)

    alias = (root / "skills/start/SKILL.md").read_text(encoding="utf-8")
    check("${CLAUDE_PLUGIN_ROOT}/skills/task-start/SKILL.md" in alias, "start alias does not read canonical task-start", errors)
    shared = (root / "skills/task-workflow/SKILL.md").read_text(encoding="utf-8")
    check("The parent commits only after `PASS`" in shared, "shared contract lacks auto-commit boundary", errors)

    template = (root / "templates/main.md").read_text(encoding="utf-8")
    for field in ("DONE_WHEN", "Runtime Strategy", "Working Branch / Path", "Baseline SHA", "Lane", "Intent hardening", "Plan Review", "Code Review Log"):
        check(field in template, f"template missing {field}", errors)
    for name in ("main.md", "global-task-manager.md", "CLAUDE.md"):
        check((root / "templates" / name).is_file(), f"bootstrap template missing: {name}", errors)

    for path in sorted((root / "schemas").glob("*.json")) + sorted((root / "pi-extension/schemas").glob("*.json")):
        load_json(path, root, errors)
    check(not (root / "schemas/merge-reviewer-output.json").exists(), "obsolete merge-reviewer schema still ships", errors)
    check(not (root / "schemas/phase-reviewer-output.json").exists(), "obsolete phase-reviewer schema still ships", errors)
    code_schema = (root / "schemas/code-reviewer-output.json").read_text(encoding="utf-8")
    check("MERGE_REVIEW" not in code_schema, "code-reviewer schema references removed MERGE_REVIEW state", errors)

    docs = "\n".join(
        (root / path).read_text(encoding="utf-8")
        for path in ("README.md", "docs/cli-reference.md", "docs/architecture.md", "docs/lessons-learned.md")
    )
    for phrase in (
        "high-trust agents with Bash, Edit, and Write",
        "clean repository on a feature branch",
        "auto-commits locally",
        "does **not** automatically push",
        "optional, advanced experiment",
        "workflow.sh` is intentionally deprecated",
    ):
        check(phrase in docs, f"documentation lacks release safety statement: {phrase}", errors)
    check("workflow.sh <agent>" not in docs, "documentation still onboards through workflow.sh", errors)
    check("Phase-reviewer" not in docs and "phase-reviewer" not in docs, "documentation references removed phase-reviewer", errors)
    history = (root / "docs/lessons-learned.md").read_text(encoding="utf-8")
    check("Historical evidence only" in history and "not operational documentation" in history, "historical lessons are not quarantined", errors)

    wrapper = root / "scripts/workflow.sh"
    wrapper_text = wrapper.read_text(encoding="utf-8")
    check(
        "DEPRECATED" in wrapper_text
        and "task-workflow:task-start" in wrapper_text
        and "--agent" in wrapper_text,
        "workflow.sh must remain a deprecated v0.3.x compatibility wrapper",
        errors,
    )
    smoke = root / "scripts/smoke-install.sh"
    smoke_text = smoke.read_text(encoding="utf-8")
    for phrase in ("claude plugin validate --strict", "/task-workflow:task-start", "--tools \"\"", "tasks/main-template.md"):
        check(phrase in smoke_text, f"fresh-install smoke lacks: {phrase}", errors)
    for script in (wrapper, smoke):
        check(bool(script.stat().st_mode & stat.S_IXUSR), f"{script.relative_to(root)} is not executable", errors)

    package = load_json(root / "pi-extension/package.json", root, errors)
    if isinstance(package, dict):
        scripts = package.get("scripts", {})
        check(isinstance(scripts, dict) and scripts.get("test") == "tsx test-graph-engine.ts", "Pi extension lacks deterministic npm test", errors)
        check(package.get("private") is True, "Pi extension package must remain private/optional", errors)

    ci = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    for command in (
        "python3 scripts/validate-plugin.py",
        "claude plugin validate --strict .",
        "bash -n scripts/*.sh",
        "python3 -m compileall -q scripts",
        "scripts/smoke-install.sh --static",
        "npm test",
    ):
        check(command in ci, f"CI lacks command: {command}", errors)

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="plugin root to validate")
    args = parser.parse_args()
    root = args.root.resolve()
    errors = validate(root)
    if errors:
        print("Plugin validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    plugin = json.loads((root / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))
    print(
        f"Plugin validation passed (version {plugin['version']}; "
        f"{len(EXPECTED_AGENTS)} agents; {len(EXPECTED_SKILLS)} canonical skills; release/docs/smoke/CI checks passed)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
