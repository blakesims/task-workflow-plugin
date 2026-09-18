#!/usr/bin/env python3
"""Deterministic prompt/template regressions, not an LLM compliance test."""
from pathlib import Path
import re
import hashlib
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
    def test_risk_based_review_contracts(self):
        """Guard concepts/sections, not exact prose or a word budget."""
        for path in ('agents/code-reviewer.md', 'agents/plan-reviewer.md',
                     'skills/investigation-review/SKILL.md',
                     'pi-extension/personas/reviewer.md'):
            with self.subTest(path=path):
                text = (ROOT / path).read_text().lower()
                for concept in (r'nonblocking suggestions', r'blockers', r'evidence',
                                r're-review', r'affected', r'prior', r'limitations|scope'):
                    self.assertRegex(text, concept)
                self.assertRegex(text, r'full (approved criteria|investigation question)|complete `done_when`')
                self.assertNotRegex(text, r're-run at least \d|challenge at least one|unsure = revise')
        code = (ROOT / 'agents/code-reviewer.md').read_text().lower()
        for concept in ('staged', 'unstaged', 'untracked', 'cumulative integration', 'still-valid'):
            self.assertIn(concept, code)
        shared = (ROOT / 'skills/task-workflow/SKILL.md').read_text().lower()
        self.assertRegex(shared, r'maximum three')
        self.assertIn('do not waive approved criteria', shared)

    def test_safe_validation_instruction_surfaces(self):
        """Each independently dispatched role retains the isolation boundary."""
        paths = ('agents/planner.md', 'agents/executor.md', 'agents/plan-reviewer.md',
                 'agents/code-reviewer.md', 'skills/task-workflow/SKILL.md',
                 'skills/scientific-method/SKILL.md', 'skills/investigation-review/SKILL.md',
                 'pi-extension/personas/investigator.md', 'pi-extension/personas/reviewer.md')
        for path in paths:
            with self.subTest(path=path):
                text = (ROOT / path).read_text().lower()
                for concept in (r'source-mutating', r'authoring tree'):
                    self.assertRegex(text, concept)
                if path.startswith('pi-extension/personas/'):
                    # Workers receive raw persona text in an arbitrary project cwd.
                    self.assertNotIn('../skills/', text)
                    for concept in (r'disposable isolated', r'exact candidate',
                                    r'uncommitted', r'untracked', r'live.service',
                                    r'no shared writable source'):
                        self.assertRegex(text, concept)
                elif path != 'skills/task-workflow/SKILL.md':
                    self.assertIn('skills/task-workflow/SKILL.md', (ROOT / path).read_text())
        shared = section((ROOT / 'skills/task-workflow/SKILL.md').read_text(),
                         '## Review scope and safe validation').lower()
        for concept in (r'disposable isolated', r'exact candidate', r'uncommitted',
                        r'untracked', r'live.service', r'no shared writable source'):
            self.assertRegex(shared, concept)
        start = (ROOT / 'skills/task-start/SKILL.md').read_text().lower()
        self.assertIn('safe-validation', start)
        self.assertIn('full tests/lint/build', start)
        graph = (ROOT / 'pi-extension/graphs/investigation-grinder.yaml').read_text().lower()
        self.assertIn('safe-check', graph)
        self.assertNotIn('verify every claim', graph)

    def test_delta_report_preserves_prior_evidence_fixture(self):
        """A report can carry full criteria by pointers without copying history.

        This exercises artifacts, not model judgment or a runtime gate engine.
        """
        with tempfile.TemporaryDirectory() as tmp:
            task = Path(tmp)
            review = task / 'code-review-phase-1.md'
            prior = ('## Attempt 1\nBaseline: fixture-base; execution attempt: 1\n'
                     'Gate: REVISE\nAC1: supported by tests/unit.\n'
                     'AC2 / F1: boundary failure; repair and check integration.\n')
            review.write_text(prior)
            with review.open('a') as out:
                out.write('\n## Attempt 2\nBaseline: fixture-base; execution attempt: 2\n'
                          'Gate: PASS\nAC1: evidence unchanged; see code-review-phase-1.md#attempt-1.\n'
                          'AC2 / F1: repaired; targeted boundary and affected integration checks passed.\n'
                          'Nonblocking suggestion: shorten a test comment.\n')
            text = review.read_text()
            self.assertTrue(text.startswith(prior))
            latest = text.split('## Attempt 2')[1]
            self.assertEqual(set(re.findall(r'AC\d', prior)), set(re.findall(r'AC\d', latest)))
            self.assertEqual(text.count('supported by tests/unit'), 1)
            target, anchor = re.search(r'(code-review-phase-1.md)#(attempt-1)', latest).groups()
            self.assertTrue((task / target).is_file())
            self.assertIn('## ' + anchor.replace('-', ' ').title(), (task / target).read_text())

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
        step = init.split('## Step 2:')[0] + section(init, '## Step 3: Existing-ledger upgrade only')
        for phrase in ('check whether `tasks/main-template.legacy.md` exists',
                       'unique, non-overwriting backup path',
                       'or stop until the collision is resolved',
                       'Never overwrite an existing backup',
                       'Create and verify the backup before replacing'):
            self.assertIn(phrase, step)

    def test_upgrade_branches_are_disjoint(self):
        init = (ROOT / 'skills/task-management-init/SKILL.md').read_text()
        new = section(init, '## Step 2: New ledger only')
        upgrade = section(init, '## Step 3: Existing-ledger upgrade only')
        self.assertIn('Skip Step 3 and go directly to Step 4', new)
        self.assertIn('Never run Step 2', upgrade)
        for target in ('global-task-manager.md', 'CLAUDE.md'):
            command = f'cp ${{CLAUDE_PLUGIN_ROOT}}/templates/{target} tasks/{target}'
            self.assertIn(command, new)
            self.assertEqual(init.count(command), 1)
            self.assertNotIn(command, upgrade)
        for required in ('open(backup, "xb")', 'Compare the backup bytes',
                         'Only after verified backup success', 'preserving every project-specific rule',
                         'GTM and task-folder contents are unchanged'):
            self.assertIn(required, upgrade)
        # Exercise the prescribed exclusive backup primitive on a populated fixture.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            template = root / 'main-template.md'
            template.write_bytes(b'legacy template')
            backup = root / 'main-template.legacy.md'
            backup.write_bytes(b'prior backup')
            with self.assertRaises(FileExistsError):
                with backup.open('xb') as out:
                    out.write(template.read_bytes())
            self.assertEqual(backup.read_bytes(), b'prior backup')
            self.assertEqual(template.read_bytes(), b'legacy template')
            fresh = root / 'main-template.legacy-unique.md'
            with fresh.open('xb') as out:
                out.write(template.read_bytes())
            self.assertEqual(fresh.read_bytes(), template.read_bytes())

    def test_plan_review_freshness_contract(self):
        for path in ('agents/plan-reviewer.md', 'skills/task-workflow/SKILL.md',
                     'templates/CLAUDE.md', 'templates/main.md'):
            text = (ROOT / path).read_text()
            self.assertIn('Review attempt', text)
            self.assertIn('Reviewed specification SHA-256', text)
        start = (ROOT / 'skills/task-start/SKILL.md').read_text()
        for required in ('increment the review attempt monotonically',
                         'clear the prior gate to pending', 'latest numbered attempt',
                         'Recompute the current specification digest',
                         'Reject missing or stale plan-review evidence',
                         'Do not invent missing metadata', 'Recheck immediately before'):
            self.assertIn(required, start)
        reviewer = (ROOT / 'agents/plan-reviewer.md').read_text()
        self.assertIn('again before writing a verdict', reviewer)
        self.assertIn('A commit SHA alone cannot identify uncommitted plan edits', reviewer)

    def test_plan_review_freshness_fixture(self):
        """Model the documented gate with real bytes; not runtime enforcement."""
        main = (ROOT / 'templates/main.md').read_bytes()
        def digest(data):
            start = data.index(b'## Task\n')
            end = data.index(b'## Plan Review\n', start)
            return hashlib.sha256(data[start:end]).hexdigest()
        def ready(data, attempts, expected, pointer):
            if not attempts:
                return False
            latest = attempts[-1]
            return (latest.get('number') == latest.get('attempt') == expected
                    and latest.get('digest') == digest(data)
                    and latest.get('gate') == 'READY' and pointer == latest)
        first = dict(number=1, attempt=1, digest=digest(main), gate='READY')
        self.assertTrue(ready(main, [first], 1, first))
        self.assertFalse(ready(main, [], 1, first))
        for key in first:
            missing = {k: v for k, v in first.items() if k != key}
            self.assertFalse(ready(main, [missing], 1, missing))
        self.assertFalse(ready(main, [first], 2, first))
        self.assertFalse(ready(main, [first], 1, {}))
        for old in (b'{Original task description from human}',
                    b'{One or two lines defining the completed outcome}', b'### Planner Notes'):
            changed = main.replace(old, old + b' changed')
            self.assertFalse(ready(changed, [first], 1, first))
        second = dict(number=2, attempt=2, digest=digest(main), gate='NEEDS_WORK')
        self.assertFalse(ready(main, [first, second], 2, second))
        second['gate'] = 'READY'
        self.assertTrue(ready(main, [first, second], 2, second))
        metadata_only = main.replace(b'- **Gate:**', b'- **Gate metadata:**')
        self.assertEqual(digest(main), digest(metadata_only))

    def test_specification_unchanged_from_pre_repair(self):
        # Pinned from f89eb31; works in fresh release copies without Git history.
        current = (ROOT / 'templates/main.md').read_bytes()
        spec = current[current.index(b'## Task\n'):current.index(b'## Plan Review\n')]
        self.assertEqual(hashlib.sha256(spec).hexdigest(),
                         '46e998e420e08cb95041902d5dadb3dc45b1b2b8fc12924f0233aeb4ca341c40')

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
