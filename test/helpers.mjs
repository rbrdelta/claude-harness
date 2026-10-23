// Shared test helpers. Every script under test runs with HOME pointed at a fresh temp dir and
// PATH led by a shim dir, so no test can reach the real vault, Notion, Telegram, Daily Standard
// or a real `claude -p`. Shims record their arguments to $SHIM_LOG.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// A shim that logs "<name> <args...>" and then runs an optional body.
const shim = (name, body = '') => `#!/bin/bash\nprintf '%s' "${name}" >> "$SHIM_LOG"; for a in "$@"; do printf ' [%s]' "\${a//$'\\n'/ }" >> "$SHIM_LOG"; done; echo >> "$SHIM_LOG"\n${body}\n`;

export function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'harness-test-'));
  const bin = join(home, 'shim-bin');
  mkdirSync(bin);
  mkdirSync(join(home, '.claude', 'hooks'), { recursive: true });
  mkdirSync(join(home, '.claude', 'logs'), { recursive: true });
  const log = join(home, 'shim.log');
  writeFileSync(log, '');
  const sb = {
    home, bin, log,
    path: (...p) => join(home, ...p),
    write(rel, content, mode) {
      const f = join(home, rel);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, content);
      if (mode) chmodSync(f, mode);
      return f;
    },
    read: (rel) => readFileSync(join(home, rel), 'utf8'),
    exists: (rel) => existsSync(join(home, rel)),
    // Put a recording shim on PATH. body runs after logging (bash).
    shim(name, body = '') { const f = join(bin, name); writeFileSync(f, shim(name, body)); chmodSync(f, 0o755); return f; },
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    // Copy a repo script into the sandbox, rewriting hardcoded paths (e.g. the vault) to sandbox paths.
    copyScript(repoRel, destRel, replacements = {}) {
      let text = readFileSync(join(REPO, repoRel), 'utf8');
      for (const [from, to] of Object.entries(replacements)) text = text.split(from).join(to);
      return sb.write(destRel, text, 0o755);
    },
    run(cmd, args = [], { env = {}, input = '', cwd } = {}) {
      const r = spawnSync(cmd, args, {
        cwd: cwd || home, input, encoding: 'utf8', timeout: 30000,
        env: {
          PATH: `${bin}:${process.env.PATH}`, HOME: home, SHIM_LOG: log, LANG: 'C.UTF-8', ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
          ...env,
        },
      });
      return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
    },
  };
  // Defaults: anything that could reach the network or a model is a harmless recorder.
  sb.shim('curl', 'echo \'{"ok":true}\'');
  sb.shim('claude', 'echo "fake claude: no output configured"; exit 1');
  sb.shim('sleep');
  return sb;
}

// "YYYY-MM-DD HH:MM:SS" in local time, hours ago — the format every harness log uses.
export function stamp(hoursAgo = 0) {
  const d = new Date(Date.now() - hoursAgo * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function today() { return stamp(0).slice(0, 10); }
export { copyFileSync };
