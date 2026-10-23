// Vault sync jobs: triggers/vault-sync.sh, notion-sync.sh, vault-reclassify.sh.
// npm/npx are shims, so no real sync runs; hardcoded vault and /tmp paths are rewritten into the sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync } from 'node:fs';
import { sandbox } from './helpers.mjs';

const NPM = `printf '%s\\n' "$FAKE_NPM_OUT"; echo "key=$CLAUDE_SESSION_KEY file=$CLAUDE_SESSION_KEY_FILE notion=$NOTION_TOKEN vault=$VAULT_PATH" >> "$SHIM_LOG"; exit \${FAKE_NPM_EXIT:-0}`;

function vaultSync(sb) {
  sb.write('projects/active/obsidian-mcp/package.json', '{}');
  sb.shim('npm', NPM);
  return sb.copyScript('triggers/vault-sync.sh', 'bin/vault-sync.sh', {
    '/mnt/c/MCP/Sources/Claude-Conversations/.claude_sync_index.json': sb.path('vault/.claude_sync_index.json'),
    '/tmp/vault-sync-alert.lock': sb.path('alert.lock'),
  });
}
const log = (sb, name) => sb.read(`.claude/hooks/${name}.log`);
const tg = (sb) => sb.calls().filter((c) => c.startsWith('curl'));

test('vault-sync: no key file or an empty key skips the sync and logs why', () => {
  const sb = sandbox();
  const s = vaultSync(sb);
  assert.equal(sb.run('bash', [s]).code, 0);
  assert.match(log(sb, 'vault-sync'), /SKIP: No session key file at .*\.claude_session_key/);
  sb.write('.claude_session_key', '   \n');
  sb.run('bash', [s]);
  assert.match(log(sb, 'vault-sync'), /SKIP: Session key file is empty/);
  assert.ok(!sb.calls().some((c) => c.startsWith('npm')));
});

test('vault-sync: skips when the sync index was written under 6 h ago', () => {
  const sb = sandbox();
  const s = vaultSync(sb);
  sb.write('.claude_session_key', 'sk-1');
  sb.write('vault/.claude_sync_index.json', '{}');
  sb.run('bash', [s]);
  assert.match(log(sb, 'vault-sync'), /SKIP: Last sync was 0h ago \(threshold: 6h\)/);
  const old = (Date.now() - 7 * 3600e3) / 1000;
  utimesSync(sb.path('vault/.claude_sync_index.json'), old, old);
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: 'done {"imported":2}' } });
  assert.match(log(sb, 'vault-sync'), /OK: \{"imported":2\}/);
});

test('vault-sync: runs npm run sync with the key and key file, logs the JSON summary as OK', () => {
  const sb = sandbox();
  const s = vaultSync(sb);
  sb.write('.claude_session_key', ' sk-abc \n');
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: 'progress\n{"imported":1,"failed":0}\nbye' } });
  assert.ok(sb.calls().includes('npm [run] [sync]'));
  assert.ok(sb.calls().some((c) => c.startsWith(`key=sk-abc file=${sb.path('.claude_session_key')}`)));
  assert.match(log(sb, 'vault-sync'), /START: Running vault sync\.\.\.\n.*OK: \{"imported":1,"failed":0\}/);
});

test('vault-sync: a rotated key reported by the importer is logged', () => {
  const sb = sandbox();
  const s = vaultSync(sb);
  sb.write('.claude_session_key', 'sk-abc');
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: 'KEY_ROTATED\n{"imported":0}' } });
  assert.match(log(sb, 'vault-sync'), /KEY_ROTATED: replacement key saved/);
});

test('vault-sync: an AUTH_EXPIRED failure is logged and alerted, and the key file is never blanked', () => {
  const sb = sandbox();
  const s = vaultSync(sb);
  sb.write('.claude_session_key', 'sk-dead');
  sb.write('.claude/channels/telegram/.env', 'TELEGRAM_BOT_TOKEN=tok\n');
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: 'Fatal: AUTH_EXPIRED 401', FAKE_NPM_EXIT: '1' } });
  assert.match(log(sb, 'vault-sync'), /AUTH_EXPIRED: Fatal: AUTH_EXPIRED 401/);
  assert.equal(sb.read('.claude_session_key'), 'sk-dead');
  assert.equal(tg(sb).length, 1);
  assert.match(tg(sb)[0], /text=\[harness\] Claude\.ai session key expired/);
});

test('vault-sync: any other failure (Cloudflare, timeout, 5xx) is a FAIL, the key stays', () => {
  const sb = sandbox();
  const s = vaultSync(sb);
  sb.write('.claude_session_key', 'sk-ok');
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: 'Fatal: CLOUDFLARE_CHALLENGE 403', FAKE_NPM_EXIT: '2' } });
  assert.match(log(sb, 'vault-sync'), /FAIL \(exit 2\): Fatal: CLOUDFLARE_CHALLENGE 403/);
  assert.equal(sb.read('.claude_session_key'), 'sk-ok');
});

test('vault-sync: each alert type goes to Telegram at most once per 24 h, and only with a bot token', () => {
  const sb = sandbox();
  const s = vaultSync(sb);
  sb.run('bash', [s]);
  assert.equal(tg(sb).length, 0, 'no token: no alert');
  sb.write('.claude/channels/telegram/.env', 'TELEGRAM_BOT_TOKEN=tok\n');
  sb.run('bash', [s]);
  sb.run('bash', [s]);
  assert.equal(tg(sb).length, 1);
  assert.match(tg(sb)[0], /chat_id=8691823610/);
  assert.ok(sb.exists('alert.lock.key_missing'));
  const old = (Date.now() - 25 * 3600e3) / 1000;
  utimesSync(sb.path('alert.lock.key_missing'), old, old);
  sb.run('bash', [s]);
  assert.equal(tg(sb).length, 2);
});

function notionSync(sb) {
  sb.write('projects/active/obsidian-mcp/package.json', '{}');
  sb.shim('npm', NPM);
  return sb.copyScript('triggers/notion-sync.sh', 'bin/notion-sync.sh');
}

test('notion-sync: no token file or an empty one skips; otherwise runs npm run notion:sync and logs OK', () => {
  const sb = sandbox();
  const s = notionSync(sb);
  sb.run('bash', [s]);
  assert.match(log(sb, 'notion-sync'), /SKIP: No token file/);
  sb.write('.notion_token', '\n');
  sb.run('bash', [s]);
  assert.match(log(sb, 'notion-sync'), /SKIP: Token file is empty/);
  sb.write('.notion_token', 'ntn_x\n');
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: '{"imported":15,"updated":0}' } });
  assert.ok(sb.calls().includes('npm [run] [notion:sync]'));
  assert.ok(sb.calls().some((c) => c.includes('notion=ntn_x')));
  assert.match(log(sb, 'notion-sync'), /OK: \{"imported":15,"updated":0\}/);
});

test('notion-sync: a 401/unauthorized failure logs AUTH_EXPIRED and blanks the token file', () => {
  const sb = sandbox();
  const s = notionSync(sb);
  sb.write('.notion_token', 'ntn_x');
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: 'APIResponseError: Unauthorized', FAKE_NPM_EXIT: '1' } });
  assert.match(log(sb, 'notion-sync'), /AUTH_EXPIRED: Notion token is no longer valid/);
  assert.equal(sb.read('.notion_token').trim(), '');
});

test('notion-sync: other failures log FAIL and keep the token', () => {
  const sb = sandbox();
  const s = notionSync(sb);
  sb.write('.notion_token', 'ntn_x');
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: 'ETIMEDOUT', FAKE_NPM_EXIT: '1' } });
  assert.match(log(sb, 'notion-sync'), /FAIL \(exit 1\): ETIMEDOUT/);
  assert.equal(sb.read('.notion_token'), 'ntn_x');
});

test('vault-reclassify: runs the local reclassifier on the vault and logs its JSON summary or the failure', () => {
  const sb = sandbox();
  sb.write('projects/active/obsidian-mcp/package.json', '{}');
  sb.shim('npx', NPM);
  const s = sb.copyScript('triggers/vault-reclassify.sh', 'bin/vault-reclassify.sh');
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: '{"total":3,"updated":1}' } });
  assert.ok(sb.calls().includes('npx [ts-node] [src/importers/reclassify.ts]'));
  assert.ok(sb.calls().some((c) => c.includes('vault=/mnt/c/MCP')));
  assert.match(log(sb, 'vault-reclassify'), /OK: \{"total":3,"updated":1\}/);
  sb.run('bash', [s], { env: { FAKE_NPM_OUT: 'TypeError: x', FAKE_NPM_EXIT: '1' } });
  assert.match(log(sb, 'vault-reclassify'), /FAIL \(exit 1\): TypeError: x/);
  const sb2 = sandbox();
  sb2.run('bash', [sb2.copyScript('triggers/vault-reclassify.sh', 'bin/v.sh')]);
  assert.match(log(sb2, 'vault-reclassify'), /FAIL: Could not cd to/);
});
