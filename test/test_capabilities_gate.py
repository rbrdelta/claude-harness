"""hooks/capabilities-gate.py: the push gate, the vault copy and the audit, against temp git repos with
bare remotes, a temp registry and a temp vault. Never touches a real repo or the vault."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

GATE = str(Path(__file__).resolve().parent.parent / 'hooks' / 'capabilities-gate.py')
ENV_GIT = {'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}


def sh(cwd, *args):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True, env={**os.environ, **ENV_GIT}).stdout.strip()


class Gate(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.active = self.tmp / 'active'
        self.vault = self.tmp / 'vault'
        self.active.mkdir()
        self.reg = self.tmp / 'registry.json'
        self.projects = {}

    def repo(self, name, entry=None, parent=None):
        """A repo with one pushed commit and a bare remote. entry=None leaves it out of the registry."""
        d = (parent or self.active) / name
        bare = self.tmp / f'{name}.git'
        sh(self.tmp, 'git', 'init', '-q', '--bare', str(bare))
        d.mkdir(parents=True)
        sh(d, 'git', 'init', '-q', '-b', 'main')
        sh(d, 'git', 'remote', 'add', 'origin', str(bare))
        (d / 'app.js').write_text('v1\n')
        (d / 'CAPABILITIES.md').write_text('# caps v1\n')
        sh(d, 'git', 'add', '-A')
        sh(d, 'git', 'commit', '-qm', 'start')
        sh(d, 'git', 'push', '-q', '-u', 'origin', 'main')
        if entry is not None:
            self.projects[str(d)] = entry
        self.reg.write_text(json.dumps({'projects': self.projects}))
        return d

    def commit(self, d, files, msg='change'):
        for f, text in files.items():
            (d / f).parent.mkdir(parents=True, exist_ok=True)
            (d / f).write_text(text)
        sh(d, 'git', 'add', '-A')
        sh(d, 'git', 'commit', '-qm', msg)
        return sh(d, 'git', 'rev-parse', '--short', 'HEAD')

    def run_gate(self, command, cwd, event='PreToolUse', args=()):
        env = {**os.environ, 'CAPABILITIES_REGISTRY': str(self.reg), 'CAPABILITIES_VAULT': str(self.vault),
               'CAPABILITIES_ACTIVE_ROOT': str(self.active)}
        payload = json.dumps({'tool_name': 'Bash', 'hook_event_name': event, 'cwd': str(cwd), 'tool_input': {'command': command}})
        return subprocess.run(['python3', GATE, *args], input=payload, capture_output=True, text=True, env=env)

    def vault_file(self, name, checked):
        p = self.vault / 'Sources' / 'Capabilities' / f'{name}.md'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f'---\nsource: capabilities\nchecked_commit: {checked}\n---\n# caps\n')

    # ---- repo projects ----
    def test_repo_code_change_without_capabilities_is_refused(self):
        d = self.repo('app', {'name': 'App', 'where': 'repo'})
        self.commit(d, {'app.js': 'v2\n'})
        r = self.run_gate('git push', d)
        self.assertEqual(r.returncode, 2)
        self.assertIn('BLOCKED by capabilities-gate', r.stderr)
        self.assertIn('CAPABILITIES.md', r.stderr)

    def test_repo_code_change_with_capabilities_passes(self):
        d = self.repo('app', {'name': 'App', 'where': 'repo'})
        self.commit(d, {'app.js': 'v2\n'})
        self.commit(d, {'CAPABILITIES.md': '# caps v2\n'})
        self.assertEqual(self.run_gate('git push', d).returncode, 0)

    def test_no_change_line_passes_on_purpose(self):
        d = self.repo('app', {'name': 'App', 'where': 'repo'})
        self.commit(d, {'app.js': 'v2\n'}, 'refactor\n\ncapabilities: no change')
        self.assertEqual(self.run_gate('git push', d).returncode, 0)

    def test_docs_only_push_passes(self):
        d = self.repo('app', {'name': 'App', 'where': 'repo'})
        self.commit(d, {'README.md': 'x\n', 'notes/plan.md': 'x\n', 'NEXT-SESSION.md': 'x\n'})
        self.assertEqual(self.run_gate('git push', d).returncode, 0)

    def test_nothing_to_push_passes(self):
        d = self.repo('app', {'name': 'App', 'where': 'repo'})
        self.assertEqual(self.run_gate('git push', d).returncode, 0)

    # ---- vault projects (public repos) ----
    def test_vault_project_needs_checked_commit_from_the_push(self):
        d = self.repo('pub', {'name': 'Pub', 'where': 'vault'})
        sha = self.commit(d, {'app.js': 'v2\n'})
        self.vault_file('Pub', 'abc1234')
        r = self.run_gate('git push', d)
        self.assertEqual(r.returncode, 2)
        self.assertIn('lives only in the vault', r.stderr)
        self.assertIn(sha, r.stderr)
        self.vault_file('Pub', sha)
        self.assertEqual(self.run_gate('git push', d).returncode, 0)

    def test_vault_project_never_gets_a_repo_file_copied(self):
        d = self.repo('pub', {'name': 'Pub', 'where': 'vault'})
        self.run_gate('git push', d, event='PostToolUse')
        self.assertFalse((self.vault / 'Sources' / 'Capabilities' / 'Pub.md').exists())

    # ---- registry coverage ----
    def test_unregistered_repo_under_active_is_refused(self):
        d = self.repo('newthing')
        r = self.run_gate('git push', d)
        self.assertEqual(r.returncode, 2)
        self.assertIn('has no capabilities file yet', r.stderr)

    def test_repo_outside_active_is_left_alone(self):
        d = self.repo('elsewhere', parent=self.tmp / 'other')
        self.commit(d, {'app.js': 'v2\n'})
        self.assertEqual(self.run_gate('git push', d).returncode, 0)

    def test_exempt_project_passes(self):
        d = self.repo('notebook', {'exempt': 'no code'})
        self.commit(d, {'app.js': 'v2\n'})
        self.assertEqual(self.run_gate('git push', d).returncode, 0)

    def test_project_in_a_folder_of_a_shared_repo(self):
        shared = self.repo('skills', parent=self.tmp / 'home')
        skill = shared / 'proto'
        self.projects[str(skill)] = {'name': 'Proto', 'where': 'repo', 'subdir': True}
        self.reg.write_text(json.dumps({'projects': self.projects}))
        self.commit(shared, {'other-skill/x.md': 'x\n'})
        self.assertEqual(self.run_gate('git push', shared).returncode, 0, 'another folder in the shared repo is not gated')
        self.commit(shared, {'proto/build.js': 'v1\n'})
        self.assertEqual(self.run_gate('git push', shared).returncode, 2)
        self.commit(shared, {'proto/CAPABILITIES.md': '# proto\n'})
        self.assertEqual(self.run_gate('git push', shared).returncode, 0)

    # ---- reading the command ----
    def test_follows_cd_and_git_dash_c(self):
        d = self.repo('app', {'name': 'App', 'where': 'repo'})
        self.commit(d, {'app.js': 'v2\n'})
        self.assertEqual(self.run_gate(f'cd {d} && git status && git push -u origin main', self.tmp).returncode, 2)
        self.assertEqual(self.run_gate(f'git -C {d} push -q origin HEAD', self.tmp).returncode, 2)
        self.assertEqual(self.run_gate(f'git -C {d} log --oneline', self.tmp).returncode, 0, 'not a push')

    def test_a_bug_in_the_gate_never_blocks_a_push(self):
        d = self.repo('app', {'name': 'App', 'where': 'repo'})
        self.commit(d, {'app.js': 'v2\n'})
        self.reg.write_text('{ not json')
        r = self.run_gate('git push', d)
        self.assertEqual(r.returncode, 0)
        self.assertIn('capabilities-gate error', r.stderr)

    # ---- vault copy after a push ----
    def test_copy_to_vault_only_after_the_push_lands(self):
        d = self.repo('app', {'name': 'App', 'where': 'repo'})
        self.commit(d, {'app.js': 'v2\n', 'CAPABILITIES.md': '# caps v2\n'})
        copy = self.vault / 'Sources' / 'Capabilities' / 'App.md'
        self.run_gate('git push', d, event='PostToolUse')
        self.assertFalse(copy.exists(), 'not pushed yet: no copy')
        sh(d, 'git', 'push', '-q')
        self.run_gate('git push', d, event='PostToolUse')
        text = copy.read_text()
        self.assertTrue(text.startswith('---\nsource: repo\nrepo: app\n'))
        self.assertIn('Read-only copy', text)
        self.assertTrue(text.endswith('# caps v2\n'))

    # ---- audit (session start) ----
    def test_audit_lists_only_projects_whose_code_moved_past_the_file(self):
        a = self.repo('a', {'name': 'A', 'where': 'repo'})
        b = self.repo('b', {'name': 'B', 'where': 'vault'})
        c = self.repo('c', {'name': 'C', 'where': 'repo'})
        self.vault_file('B', sh(b, 'git', 'rev-parse', '--short', 'HEAD'))
        self.commit(a, {'app.js': 'v2\n'})
        self.commit(b, {'app.js': 'v2\n'})
        self.commit(c, {'app.js': 'v2\n'}, 'tidy\n\ncapabilities: no change')
        self.commit(c, {'README.md': 'docs\n'})
        out = self.run_gate('', self.tmp, args=['--audit']).stdout
        self.assertIn('CAPABILITIES FILE STALE: A: code changed after its capabilities file', out)
        self.assertIn('B: code changed after its capabilities file', out)
        self.assertNotIn('C:', out)

    def test_audit_is_silent_when_everything_is_current(self):
        a = self.repo('a', {'name': 'A', 'where': 'repo'})
        b = self.repo('b', {'name': 'B', 'where': 'vault'})
        self.vault_file('B', sh(b, 'git', 'rev-parse', '--short', 'HEAD'))
        self.assertEqual(self.run_gate('', self.tmp, args=['--audit']).stdout, '')

    def test_audit_flags_a_missing_file(self):
        self.repo('b', {'name': 'B', 'where': 'vault'})
        self.assertIn('B: no vault capabilities file', self.run_gate('', self.tmp, args=['--audit']).stdout)


if __name__ == '__main__':
    unittest.main()
