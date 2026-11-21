// Remote Control link for a session a launcher started in tmux (asks-launch, retro-launch).
// Claude Code writes a bridge_status line with the link into the session's transcript about a second after start.
// Until 2026-11-21 the launchers read the link off the terminal instead. A long prompt makes the session work at
// once, the screen redraws and the link is gone from it, so a session that had come up was killed as a failure
// (the ask session, three days running). The transcript is the record; the screen is only a fallback.
import { existsSync, readFileSync } from 'node:fs';

// Claude Code keeps a session's transcript under ~/.claude/projects/<cwd with every non-alphanumeric as ->/<id>.jsonl.
export const transcriptPath = (home, cwd, sessionId) =>
  `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${sessionId}.jsonl`;

export function linkFromTranscript(file) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"bridge_status"')) continue;
    try { const d = JSON.parse(line); if (d.subtype === 'bridge_status' && d.url) return d.url; } catch {}
  }
  return null;
}

export const LINK_ON_SCREEN = /https:\/\/claude\.ai\/code\/session_\w+/;
