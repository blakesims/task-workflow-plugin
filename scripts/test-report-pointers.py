#!/usr/bin/env python3
"""Deterministic prompt/template regressions, not an LLM compliance test."""
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def section(text, heading):
    """Extract a level-two Markdown section without changing its contents."""
    start = text.index(heading + '\n')
    end = text.find('\n## ', start + len(heading) + 1)
    return text[start:end if end >= 0 else len(text)]


def specification(text):
    """Return the entire immutable Task, Intent Contract and Plan sections."""
    return tuple(section(text, heading) for heading in
                 ('## Task', '## Intent Contract', '## Plan'))


class ReportPointers(unittest.TestCase):
    def test_template_preserves_entire_phase_plan(self):
        """Keep the full phase specification and compact mutable report entries."""
        text = (ROOT / 'templates/main.md').read_text()
        plan = section(text, '## Plan')
        for field in ('### Objective', '### Scope', '### Phases',
                      '#### Phase 1:', '**Tasks:**', '**Acceptance Criteria:**',
                      '**Likely Files:**', '**Validation:**', '**Dependencies:**',
                      '### Open Questions', '### Planner Notes'):
            self.assertIn(field, plan)
        for name in ('## Plan Review', '## Execution Log', '## Code Review Log', '## Completion'):
            pointer = section(text, name)
            self.assertIn('**Report:**', pointer)
            for forbidden in ('**Notes:**', '**Files Modified:**', '**Validation:**', '**Issues:**', '**Summary:**'):
                self.assertNotIn(forbidden, pointer)

    def test_agent_ownership_and_repair_handoff(self):
        """Ensure agent prompts own pointers and route repairs to full reports."""
        executor = (ROOT / 'agents/executor.md').read_text()
        self.assertIn('execution-phase-N.md', executor)
        self.assertIn('under `## Execution Log` in `main.md`', executor)
        self.assertIn('On `REVISE`, open the exact linked', executor)
        self.assertIn('Missing or stale review evidence is a blocker', executor)
        reviewer = (ROOT / 'agents/code-reviewer.md').read_text()
        self.assertIn('gate, review date and report path', reviewer)
        self.assertIn('Read the linked execution report', reviewer)
        start = (ROOT / 'skills/task-start/SKILL.md').read_text()
        self.assertIn('which must read it and repair the numbered findings', start)
        self.assertNotIn('update the remaining plan', start)
        self.assertNotIn('even progress is parent-only', start)
        self.assertIn('Never paste that full output into `main.md`', start)
        self.assertIn('current working tree', start)
        self.assertIn('commits any repairs before completion', start)
        self.assertIn('on `FAIL` or exhausted cycles, block', start)
        init = (ROOT / 'skills/task-management-init/SKILL.md').read_text()
        self.assertIn('phase-report-pointers-v1', init)
        self.assertIn('leave existing task folders', init)

    def test_cumulative_revise_handoff_fixture(self):
        """Dereference a cumulative repair brief without requiring a phase label."""
        executor = (ROOT / 'agents/executor.md').read_text()
        reviewer = (ROOT / 'agents/code-reviewer.md').read_text()
        shared = (ROOT / 'skills/task-workflow/SKILL.md').read_text()
        for prompt in (executor, reviewer, shared):
            self.assertIn('cumulative baseline, current working tree, and review attempt', prompt)
        self.assertIn('phase reports identify the relevant phase and execution attempt', executor)
        self.assertNotIn('verify it covers this phase/attempt', executor)
        main = (ROOT / 'templates/main.md').read_text()
        original_spec = specification(main)
        with tempfile.TemporaryDirectory() as tmp:
            task = Path(tmp)
            report = task / 'final-review.md'
            report.write_text('Cumulative baseline: fixture-base\nCurrent working tree: fixture-tree\n'
                              'Review attempt: 1\nGate: REVISE\n1. Fix cross-phase integration.\n')
            block = section(main, '## Code Review Log')
            main = main.replace(block, block + '\n### Final review\n- **Gate:** REVISE\n'
                                '- **Report:** [review](final-review.md)\n')
            pointer = re.findall(r'\[review\]\(([^)]+)\)', section(main, '## Code Review Log'))[-1]
            evidence = (task / pointer).read_text()
            for required in ('Cumulative baseline:', 'Current working tree:', 'Review attempt:',
                             '1. Fix cross-phase integration.'):
                self.assertIn(required, evidence)
            self.assertNotIn('Phase 1', evidence)
            self.assertEqual(original_spec, specification(main))
            report.unlink()
            self.assertFalse((task / pointer).is_file(), 'Missing review must block continuation')

    def test_upgrade_backup_collision_contract(self):
        """Require an explicit collision branch before replacing an old template."""
        init = (ROOT / 'skills/task-management-init/SKILL.md').read_text()
        step = init.split('## Step 2:')[0]
        for phrase in ('check whether `tasks/main-template.legacy.md` exists',
                       'unique, non-overwriting backup path',
                       'or stop until the collision is resolved',
                       'Never overwrite an existing backup',
                       'Create and verify the backup before replacing'):
            self.assertIn(phrase, step)

    def test_two_phase_revise_pass_pointer_fixture(self):
        """Exercise artifact shape and report dereferencing; no simulated model claim."""
        main = (ROOT / 'templates/main.md').read_text()
        phase = section(main, '## Plan')
        phase = phase.replace('### Open Questions',
                              '#### Phase 2: Integration\n\n- **Objective:** Verify integration.\n'
                              '- **Tasks:** Run the complete test path.\n'
                              '- **Likely Files:** tests/integration.py\n\n### Open Questions')
        main = main.replace(section(main, '## Plan'), phase)
        original_spec = specification(main)
        with tempfile.TemporaryDirectory() as tmp:
            task = Path(tmp)
            (task / 'main.md').write_text(main)
            for n in (1, 2):
                execution = task / f'execution-phase-{n}.md'
                review = task / f'code-review-phase-{n}.md'
                for attempt, gate in ((1, 'REVISE'), (2, 'PASS')):
                    if attempt == 2:
                        # Follow the recorded pointer, not an inline summary.
                        paths = re.findall(r'\[review\]\(([^)]+)\)', section(main, '## Code Review Log'))
                        self.assertIn(review.name, paths)
                        self.assertIn('F1: fix the boundary case', (task / paths[-1]).read_text())
                    with execution.open('a') as out:
                        out.write(f'Phase {n}; attempt {attempt}; baseline fixture\nAC evidence and commands\n')
                    with review.open('a') as out:
                        out.write(f'Phase {n}; attempt {attempt}; gate {gate}\nF1: fix the boundary case\n')
                    for heading, entry in (
                        ('## Execution Log', f'### Phase {n}\n- **Status:** CODE_REVIEW\n- **Report:** [execution]({execution.name})\n'),
                        ('## Code Review Log', f'### Phase {n}\n- **Gate:** {gate}\n- **Report:** [review]({review.name})\n')):
                        block = section(main, heading)
                        marker = f'### Phase {n}'
                        if marker in block:
                            start = block.index(marker)
                            end = block.find('\n### ', start + len(marker))
                            updated = block[:start] + entry + (block[end:] if end >= 0 else '\n')
                        else:
                            updated = block.rstrip() + '\n\n' + entry + '\n'
                        main = main.replace(block, updated)
                    (task / 'main.md').write_text(main)
                    self.assertEqual(original_spec, specification(main))
                    self.assertNotIn('F1:', main)
                    self.assertEqual(1, section(main, '## Execution Log').count(f'### Phase {n}'))
                    self.assertEqual(1, section(main, '## Code Review Log').count(f'### Phase {n}'))
                    for link in re.findall(r'\]\(([^)]+)\)', re.sub(r'<!--.*?-->', '', main, flags=re.S)):
                        self.assertTrue((task / link).is_file(), link)
                self.assertIn('attempt 1', execution.read_text())
                self.assertIn('attempt 2', review.read_text())
            # These mutations must NOT be confused with legitimate pointer edits.
            changed = main.replace('Verify integration.', 'Add a new product feature.')
            self.assertNotEqual(original_spec, specification(changed))
            injected = main.replace('### Planner Notes', 'Execution output: unexpected inline detail\n\n### Planner Notes')
            self.assertNotEqual(original_spec, specification(injected))


if __name__ == '__main__':
    unittest.main()
