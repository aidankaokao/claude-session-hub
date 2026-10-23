// Builds a fake CLAUDE_CONFIG_DIR with fictional sessions for README screenshots.
// Usage: node setup.mjs <dir>   (prints the sessions it created; run via scripts/demo/screenshots.sh)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const dir = process.argv[2];
fs.rmSync(dir, { recursive: true, force: true });
const mk = (...p) => fs.mkdirSync(path.join(dir, ...p), { recursive: true });
mk('sessions');
mk('projects');
mk('session-hub', 'context');

const now = Date.now();
const SESSIONS = [
  { cwd: '/Users/demo/web-shop', name: 'shop-1', title: '結帳流程重構', prompt: '把結帳流程拆成三個步驟，保留現有的優惠券邏輯', status: 'busy', tool: ['Edit', { file_path: 'src/cart.ts' }], ctx: 42, edits: ['src/cart.ts'] },
  { cwd: '/Users/demo/web-shop', name: 'shop-2', title: '購物車單元測試', prompt: '幫購物車補上單元測試', status: 'busy', tool: ['Write', { file_path: 'src/cart.ts' }], ctx: 23, edits: ['src/cart.ts', 'test/cart.test.ts'] },
  { cwd: '/Users/demo/api-server', name: 'api-1', title: '加上速率限制', prompt: '每個 API key 每分鐘最多 60 次請求', status: 'idle', tool: ['Bash', { command: 'npm test' }], ctx: 67, waiting: 'Bash' },
  { cwd: '/Users/demo/api-server', name: 'api-2', title: '修正登入逾時', prompt: 'session 過期後要導回登入頁', status: 'idle', tool: ['Read', { file_path: 'src/auth.ts' }], ctx: 84 },
  { cwd: '/Users/demo/data-pipeline', name: 'etl-1', title: '每日報表 ETL', prompt: '每天早上八點產生前一天的營收報表', status: 'busy', tool: ['Bash', { command: 'python etl/run.py --date yesterday' }], ctx: null, tokens: 312_000 },
  { cwd: '/Users/demo/docs-site', name: 'docs-1', title: '改寫安裝教學', prompt: '安裝教學改成 macOS 和 Linux 分開寫', status: 'idle', tool: ['WebFetch', { url: 'https://nodejs.org/en/download' }], ctx: 55 },
];

const out = [];
SESSIONS.forEach((s, i) => {
  const child = spawn('sleep', ['3600'], { detached: true, stdio: 'ignore' });
  child.unref();
  const id = crypto.randomUUID();
  const startedAt = now - (20 + i * 13) * 60_000;
  fs.writeFileSync(
    path.join(dir, 'sessions', `${child.pid}.json`),
    JSON.stringify({ pid: child.pid, sessionId: id, cwd: s.cwd, name: s.name, status: s.status, statusUpdatedAt: now - (i + 1) * 47_000, startedAt, kind: 'interactive', version: '2.1.309' }),
  );
  const pdir = path.join(dir, 'projects', s.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(pdir, { recursive: true });
  const ts = (ago) => new Date(now - ago).toISOString();
  const tokens = s.tokens ?? Math.round(((s.ctx ?? 10) / 100) * 1_000_000);
  const lines = [
    { type: 'permission-mode', permissionMode: i % 2 ? 'acceptEdits' : 'default' },
    { type: 'last-prompt', lastPrompt: s.prompt },
    { type: 'ai-title', aiTitle: s.title },
    ...(s.edits ?? []).map((f, k) => ({
      type: 'assistant',
      timestamp: ts(300_000 - k * 60_000),
      message: { id: `msg_${id}_e${k}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `e${k}`, name: 'Edit', input: { file_path: f } }] },
    })),
    {
      type: 'assistant',
      timestamp: ts(8_000),
      cwd: s.cwd,
      sessionId: id,
      message: {
        id: `msg_${id}_last`,
        model: 'claude-opus-5-5',
        usage: { input_tokens: 2000, output_tokens: 3000 + i * 900, cache_read_input_tokens: tokens - 2000, cache_creation_input_tokens: 0 },
        content: [{ type: 'tool_use', id: 't1', name: s.tool[0], input: s.tool[1] }],
      },
    },
  ];
  fs.writeFileSync(path.join(pdir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (s.ctx != null)
    fs.writeFileSync(path.join(dir, 'session-hub', 'context', `${id}.json`), JSON.stringify({ pct: s.ctx, size: 1_000_000, updatedAt: Math.floor(now / 1000) }));
  out.push({ pid: child.pid, id, ...s });
});

// all three hook scripts "installed", so the HUD shows no warning
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ hooks: { x: 'hub-hook.sh hub-permission.sh hub-inbox.sh' } }));
fs.writeFileSync(
  path.join(dir, 'session-hub', 'usage.json'),
  JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 38, resets_at: Math.floor(now / 1000) + 2 * 3600 + 14 * 60 },
      seven_day: { used_percentage: 61, resets_at: Math.floor(now / 1000) + 3 * 86400 + 5 * 3600 },
    },
    updatedAt: Math.floor(now / 1000) - 20,
  }),
);

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const projects = ['web-shop', 'api-server', 'data-pipeline', 'docs-site', 'infra'];

// past API responses (deduped by message id in tokens.mjs), so the tokens tab has a few weeks of history
const usageDir = path.join(dir, 'projects', '-Users-demo-history');
fs.mkdirSync(usageDir, { recursive: true });
const usage = [];
for (let d = 0; d < 27; d++) {
  const day = new Date(now - d * 86_400_000);
  if (rand() < 0.15) continue;
  const n = Math.floor(rand() * (day.getDay() % 6 === 0 ? 8 : 40));
  for (let k = 0; k < n; k++) {
    const p = projects[Math.min(4, Math.floor(rand() * rand() * 5))];
    const model = rand() < 0.85 ? 'claude-opus-5-5' : 'claude-sonnet-5-5';
    const ctx = 40_000 + Math.floor(rand() * 400_000);
    const write = 2000 + Math.floor(rand() * 15_000);
    usage.push({
      type: 'assistant',
      timestamp: new Date(Math.min(now - 60_000, day.getTime() - Math.floor(rand() * 8 * 3600_000))).toISOString(),
      cwd: `/Users/demo/${p}`,
      sessionId: 'demo-history',
      message: {
        id: `msg_hist_${d}_${k}`,
        model,
        usage: {
          input_tokens: 50 + Math.floor(rand() * 500),
          output_tokens: 300 + Math.floor(rand() * 6000),
          cache_read_input_tokens: ctx,
          cache_creation_input_tokens: write,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write },
          speed: 'standard',
        },
        content: [],
      },
    });
  }
}
fs.writeFileSync(path.join(usageDir, 'demo-history.jsonl'), usage.map((l) => JSON.stringify(l)).join('\n') + '\n');

console.log(JSON.stringify(out.map(({ pid, id, name, waiting }) => ({ pid, id, name, waiting }))));
