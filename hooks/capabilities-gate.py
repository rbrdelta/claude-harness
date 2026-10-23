#!/usr/bin/env python3
"""Keep every project's capabilities file current (Daniel, 2026-10-23).

  PreToolUse (Bash): refuse a `git push` whose commits change a project's code without updating its
    capabilities file. repo projects: CAPABILITIES.md changed in the pushed commits. vault projects
    (public repos): the vault file's checked_commit is one of the pushed commits. A commit message line
    `capabilities: no change` lets a push through on purpose. Pushes touching only README.md, CLAUDE.md,
    NEXT-SESSION.md or notes/ pass. A git repo under ~/projects/active/ missing from the registry can't push.
  PostToolUse (Bash): after a push lands, copy a repo project's CAPABILITIES.md into the vault (read-only copy).
  --audit: print one line per project whose code changed after its capabilities file (session start).

Registry: capabilities-projects.json at this repo's root. Test overrides: CAPABILITIES_REGISTRY,
CAPABILITIES_VAULT, CAPABILITIES_ACTIVE_ROOT.
"""
import json, os, re, shlex, subprocess, sys
from pathlib import Path

HERE = Path(os.path.realpath(__file__)).parent.parent
REGISTRY = Path(os.environ.get('CAPABILITIES_REGISTRY', HERE / 'capabilities-projects.json'))
VAULT_DIR = Path(os.environ.get('CAPABILITIES_VAULT', '/mnt/c/MCP')) / 'Sources' / 'Capabilities'
ACTIVE_ROOT = os.path.realpath(os.path.expanduser(os.environ.get('CAPABILITIES_ACTIVE_ROOT', '~/projects/active')))
NO_CHANGE = re.compile(r'^capabilities: no change', re.M | re.I)
DOC_ONLY = re.compile(r'(^|/)(README\.md|CLAUDE\.md|NEXT-SESSION\.md|CAPABILITIES\.md)$|(^|/)notes/')
TEMPLATE = '~/projects/active/phone-notes/CAPABILITIES.md'


def git(repo, *args):
    r = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def registry():
    data = json.loads(REGISTRY.read_text())['projects']
    return {os.path.realpath(os.path.expanduser(k)): v for k, v in data.items()}


def projects_in(root):
    """(path, entry, prefix) for every registered project in this git repo. prefix = folder inside the repo."""
    out = []
    for p, e in registry().items():
        if p == root:
            out.append((p, e, ''))
        elif e.get('subdir') and p.startswith(root + os.sep):
            out.append((p, e, os.path.relpath(p, root) + '/'))
    return out


def frontmatter(path):
    if not path.exists():
        return {}
    m = re.match(r'^---\n(.*?)\n---\n', path.read_text(), re.S)
    return dict(re.findall(r'^(\w+):\s*(.*?)\s*$', m.group(1), re.M)) if m else {}


def push_targets(command, cwd):
    """Directories a shell command pushes from: follows `cd X &&` and `git -C X push`."""
    here, out = cwd, []
    for seg in re.split(r'&&|\|\||;|\n|\|', command):
        try:
            tok = shlex.split(seg)
        except ValueError:
            tok = seg.split()
        if not tok:
            continue
        if tok[0] == 'cd' and len(tok) > 1:
            here = os.path.join(here, os.path.expanduser(tok[1]))
        elif tok[0] == 'git':
            rest, repo = tok[1:], here
            while len(rest) >= 2 and rest[0] == '-C':
                repo = os.path.join(repo, os.path.expanduser(rest[1]))
                rest = rest[2:]
            if rest and rest[0] == 'push':
                out.append(repo)
    return out


def pushed_range(root):
    return ['@{u}..HEAD'] if git(root, 'rev-parse', '--abbrev-ref', '@{u}') else ['HEAD', '--not', '--remotes']


def check(repo):
    """None if the push may go ahead, else the reason it can't."""
    root = git(repo, 'rev-parse', '--show-toplevel')
    if not root:
        return None
    root = os.path.realpath(root)
    projects = projects_in(root)
    if not projects:
        if root == ACTIVE_ROOT or root.startswith(ACTIVE_ROOT + os.sep):
            return (f'{root} has no capabilities file yet. Write one (template: {TEMPLATE}; a public repo keeps it '
                    f'in the vault only, at {VAULT_DIR}/<name>.md) and add the project to {REGISTRY}.')
        return None
    rng = pushed_range(root)
    commits = (git(root, 'log', '--format=%H', *rng) or '').split()
    if not commits:
        return None
    files = set((git(root, 'log', '--name-only', '--format=', *rng) or '').split('\n')) - {''}
    if NO_CHANGE.search(git(root, 'log', '--format=%B', *rng) or ''):
        return None
    for path, entry, prefix in projects:
        if 'exempt' in entry:
            continue
        mine = {f for f in files if f.startswith(prefix)}
        if all(DOC_ONLY.search(f[len(prefix):]) for f in mine):
            continue
        if entry['where'] == 'repo':
            if prefix + 'CAPABILITIES.md' in mine:
                continue
            return (f"{entry['name']}: these commits change the code but not {prefix}CAPABILITIES.md. Update it in a "
                    f"commit (every capability tied to a test, native platform, or 'no test needed: <why>'), or add "
                    f"the line 'capabilities: no change' to a commit message if behavior really didn't change.")
        vf = VAULT_DIR / f"{entry['name']}.md"
        checked = frontmatter(vf).get('checked_commit', '')
        if checked and any(c.startswith(checked) for c in commits):
            continue
        return (f"{entry['name']} is a public repo, so its capabilities file lives only in the vault: {vf}. "
                f"Update it for these commits and set checked_commit to {commits[0][:7]}, or add the line "
                f"'capabilities: no change' to a commit message if behavior really didn't change.")
    return None


def copy_to_vault(repo):
    root = git(repo, 'rev-parse', '--show-toplevel')
    if not root:
        return
    root = os.path.realpath(root)
    if git(root, 'rev-parse', '@{u}') != git(root, 'rev-parse', 'HEAD'):
        return  # the push didn't land
    for path, entry, prefix in projects_in(root):
        src = Path(path) / 'CAPABILITIES.md'
        if entry.get('where') != 'repo' or not src.exists():
            continue
        commit = git(root, 'log', '-1', '--format=%h', '--', prefix + 'CAPABILITIES.md')
        name = Path(path).name
        text = (f"---\nsource: repo\nrepo: {name}\nrepo_file: CAPABILITIES.md\nrepo_commit: {commit}\n---\n"
                f"> Read-only copy, written after each push by the capabilities gate. The original is "
                f"`CAPABILITIES.md` in {path.replace(os.path.expanduser('~'), '~')} on the laptop; edit it there.\n\n"
                f"{src.read_text()}")
        vf = VAULT_DIR / f"{entry['name']}.md"
        if not vf.exists() or vf.read_text() != text:
            VAULT_DIR.mkdir(parents=True, exist_ok=True)
            vf.write_text(text)


CODE = ['--', '.', ':!README.md', ':!CLAUDE.md', ':!NEXT-SESSION.md', ':!notes', ':!CAPABILITIES.md']


def audit():
    """One line per project whose code changed after its capabilities file."""
    out = []
    for path, entry in registry().items():
        if 'exempt' in entry or not os.path.isdir(path):
            continue
        if entry['where'] == 'repo':
            if not (Path(path) / 'CAPABILITIES.md').exists():
                out.append(f"{entry['name']}: no CAPABILITIES.md")
                continue
            since = git(path, 'log', '-1', '--format=%H', '--', 'CAPABILITIES.md')
        else:
            since = frontmatter(VAULT_DIR / f"{entry['name']}.md").get('checked_commit', '')
            if not since or git(path, 'rev-parse', '--verify', '-q', since + '^{commit}') is None:
                out.append(f"{entry['name']}: no vault capabilities file")
                continue
        later = (git(path, 'log', '--format=%H', f'{since}..HEAD', *CODE) or '').split()
        if any(not NO_CHANGE.search(git(path, 'log', '-1', '--format=%B', c) or '') for c in later):
            out.append(f"{entry['name']}: code changed after its capabilities file ({len(later)} commit(s))")
    return out


def main():
    if sys.argv[1:] == ['--audit']:
        for line in audit():
            print('CAPABILITIES FILE STALE: ' + line)
        return 0
    try:
        p = json.loads(sys.stdin.read())
    except Exception:
        return 0
    if p.get('tool_name') != 'Bash':
        return 0
    cmd = (p.get('tool_input') or {}).get('command', '') or ''
    if 'push' not in cmd:
        return 0
    targets = push_targets(cmd, p.get('cwd') or os.getcwd())
    try:
        if p.get('hook_event_name') == 'PostToolUse':
            for t in targets:
                copy_to_vault(t)
            return 0
        for t in targets:
            reason = check(t)
            if reason:
                print('BLOCKED by capabilities-gate: ' + reason, file=sys.stderr)
                return 2
    except Exception as e:  # a bug in the gate must never wedge every push: say so and let it through
        print(f'capabilities-gate error (push allowed): {e}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
