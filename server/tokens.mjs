import fs from 'node:fs/promises';
import path from 'node:path';
import { HUB_DIR, PROJECTS_DIR, TOKENS_FILE } from './paths.mjs';
import { costOf, tokensOf } from './pricing.mjs';

// Token usage from every transcript (including subagents). Each API response carries a `usage` block,
// but Claude Code writes one line per content block, all repeating the same usage: dedupe by message id
// (the last line wins; a streamed response can be rewritten with its final output count).
// Transcripts are deleted after ~30 days (cleanupPeriodDays), so daily totals are also persisted.

const CALENDAR_DAYS = 84;
const BREAKDOWN_DAYS = 28;
const CHUNK = 8 * 1024 * 1024;
const REFRESH_MS = 15_000;
const MESSAGE_TTL_MS = 40 * 86_400_000;

const files = new Map(); // path -> { size, offset }
const messages = new Map(); // message id -> { at, day, model, project, sessionId, usage }
let stored = null; // { days: { [day]: totals } } from TOKENS_FILE
let lastRefresh = 0;
let refreshing = null;

const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const emptyTotals = () => ({ input: 0, output: 0, read: 0, write: 0, cost: 0, unpriced: 0, requests: 0 });

function add(totals, m) {
  const t = tokensOf(m.usage);
  const cost = costOf(m.model, m.usage);
  totals.input += t.input;
  totals.output += t.output;
  totals.read += t.read;
  totals.write += t.write5m + t.write1h;
  totals.requests++;
  if (cost == null) totals.unpriced += t.input + t.output + t.read + t.write5m + t.write1h;
  else totals.cost += cost;
}

const sumTokens = (t) => t.input + t.output + t.read + t.write;

async function listTranscripts(dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listTranscripts(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function ingestLine(line) {
  // cheap filter before JSON.parse: most lines are not API responses
  if (!line.includes('"usage"')) return;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  const msg = e.message;
  if (e.type !== 'assistant' || !msg?.usage || !msg.id || msg.model === '<synthetic>') return;
  const at = Date.parse(e.timestamp);
  if (!at) return;
  messages.set(msg.id, {
    at,
    day: dayKey(new Date(at)),
    model: msg.model ?? 'unknown',
    project: e.cwd ? path.basename(e.cwd) : null,
    sessionId: e.sessionId ?? null,
    usage: msg.usage,
  });
}

// Reads only what was appended since the last call; a partial last line waits for the next refresh.
async function readNew(file) {
  const st = await fs.stat(file).catch(() => null);
  if (!st) return files.delete(file);
  let state = files.get(file);
  if (!state || st.size < state.offset) state = { offset: 0 }; // new, or rewritten in place
  if (st.size === state.offset) return files.set(file, state);
  const fh = await fs.open(file);
  try {
    let pos = state.offset;
    let carry = '';
    while (pos < st.size) {
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - pos));
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const lines = (carry + buf.toString('utf8', 0, bytesRead)).split('\n');
      carry = lines.pop();
      for (const l of lines) ingestLine(l);
    }
    // don't consume an unfinished line (or a multi-byte char cut at the chunk edge)
    files.set(file, { offset: pos - Buffer.byteLength(carry) });
  } finally {
    await fh.close();
  }
}

async function loadStored() {
  try {
    stored = JSON.parse(await fs.readFile(TOKENS_FILE, 'utf8'));
  } catch {
    stored = { days: {} };
  }
}

async function refresh() {
  if (!stored) await loadStored();
  const list = await listTranscripts(PROJECTS_DIR);
  for (const f of list) await readNew(f);
  for (const f of files.keys()) if (!list.includes(f)) files.delete(f);

  // Persist per-day totals. Transcripts only ever disappear (cleanup) or grow, so for each day keep
  // whichever of the stored and freshly computed totals has more tokens.
  const fresh = {};
  for (const m of messages.values()) add((fresh[m.day] ??= emptyTotals()), m);
  let changed = false;
  for (const [day, t] of Object.entries(fresh)) {
    const old = stored.days[day];
    // >= so that a price table update re-prices days whose transcripts still exist
    if ((!old || sumTokens(t) >= sumTokens(old)) && JSON.stringify(old) !== JSON.stringify(t)) {
      stored.days[day] = t;
      changed = true;
    }
  }
  // already persisted per day; keep memory bounded on a long-running hub
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  for (const [id, m] of messages) if (m.at < cutoff) messages.delete(id);
  if (changed) {
    await fs.mkdir(HUB_DIR, { recursive: true });
    const tmp = `${TOKENS_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(stored) + '\n');
    await fs.rename(tmp, TOKENS_FILE);
  }
  lastRefresh = Date.now();
}

// Coalesces concurrent callers and rate-limits rescans.
export async function refreshTokens(force = false) {
  if (!force && Date.now() - lastRefresh < REFRESH_MS) return;
  refreshing ??= refresh().finally(() => (refreshing = null));
  await refreshing;
}

// Small summary for the live snapshot: today's totals and per-session totals of running sessions.
export function tokenSnapshot(aliveIds, now = new Date()) {
  if (!stored) return null;
  const today = stored.days[dayKey(now)] ?? emptyTotals();
  const sessions = {};
  for (const m of messages.values()) {
    if (!m.sessionId || !aliveIds.has(m.sessionId)) continue;
    add((sessions[m.sessionId] ??= emptyTotals()), m);
  }
  return { today, sessions };
}

// Full report for the tokens modal (明細).
export async function tokenReport(now = new Date()) {
  await refreshTokens(true);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(today.getTime() - (CALENDAR_DAYS - 1) * 86_400_000);
  const days = {};
  for (const [day, t] of Object.entries(stored.days)) if (day >= dayKey(from)) days[day] = t;

  const sinceBreakdown = today.getTime() - (BREAKDOWN_DAYS - 1) * 86_400_000;
  const byModel = new Map();
  const byProject = new Map();
  for (const m of messages.values()) {
    if (m.at < sinceBreakdown) continue;
    add(byModel.get(m.model) ?? byModel.set(m.model, emptyTotals()).get(m.model), m);
    const p = m.project ?? '（未知）';
    add(byProject.get(p) ?? byProject.set(p, emptyTotals()).get(p), m);
  }
  const rank = (map) => [...map].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.cost - a.cost || sumTokens(b) - sumTokens(a));
  const oldest = Math.min(...[...messages.values()].map((m) => m.at));
  return {
    from: dayKey(from),
    to: dayKey(today),
    days,
    breakdownDays: BREAKDOWN_DAYS,
    byModel: rank(byModel),
    byProject: rank(byProject).slice(0, 8),
    transcriptsSince: Number.isFinite(oldest) ? dayKey(new Date(oldest)) : null,
  };
}
