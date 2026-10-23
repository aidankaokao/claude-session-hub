import fs from 'node:fs/promises';
import path from 'node:path';
import { SESSIONS_DIR } from './paths.mjs';
import { summarizeTranscript } from './transcript.mjs';
import { getHookState, forgetSessions } from './hooks.mjs';
import { readContexts } from './context.mjs';

// Fallback when no status-line report exists yet: Opus 5.x sessions have a 1M window.
const FALLBACK_CONTEXT_LIMIT = 1_000_000;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// ~/.claude/sessions/<pid>.json is Claude Code's (undocumented) live registry of running sessions.
async function readRegistry() {
  const files = await fs.readdir(SESSIONS_DIR).catch(() => []);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(await fs.readFile(path.join(SESSIONS_DIR, f), 'utf8'));
      if (d.sessionId && d.pid && isAlive(d.pid)) out.push(d);
    } catch {
      // file being rewritten or stale; next tick will pick it up
    }
  }
  return out;
}

// Grace period after a PostToolUse/UserPromptSubmit while the model thinks about its next step.
const BUSY_GRACE_MS = 3000;

// The registry's status can lag behind; hook events are real-time. Whichever was written last wins,
// so an interrupt (registry goes idle, no PostToolUse ever fires) still ends the busy state.
function registryIsNewer(r, at) {
  return (r.statusUpdatedAt ?? 0) > at;
}

function isBusy(r, h, now) {
  if (r.status === 'busy') return true;
  if (!h?.workAt || registryIsNewer(r, h.workAt)) return false;
  return h.inTool || now - h.workAt < BUSY_GRACE_MS;
}

function newer(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return (a.at ?? 0) >= (b.at ?? 0) ? a : b;
}

// Returns { sessions, edits: Map<sessionId, {file, at}[]> } — edits stay server-side (conflict detection).
export async function collectSessions() {
  const registry = await readRegistry();
  const aliveIds = new Set(registry.map((r) => r.sessionId));
  forgetSessions(aliveIds);
  const contexts = await readContexts(aliveIds);
  const edits = new Map();
  const now = Date.now();

  const sessions = await Promise.all(
    registry.map(async (r) => {
      const t = await summarizeTranscript(r.sessionId, r.cwd);
      const h = getHookState(r.sessionId);
      const ctx = contexts.get(r.sessionId);
      if (t?.edits.length) edits.set(r.sessionId, t.edits);
      const waiting =
        h?.waiting && !(r.status === 'idle' && registryIsNewer(r, h.waiting.at)) ? h.waiting : null;
      return {
        id: r.sessionId,
        pid: r.pid,
        name: r.name ?? r.sessionId.slice(0, 8),
        title: t?.title ?? null,
        cwd: r.cwd,
        project: path.basename(r.cwd),
        status: waiting ? 'waiting' : isBusy(r, h, now) ? 'busy' : 'idle',
        waitingMessage: waiting?.message ?? null,
        kind: r.kind ?? null,
        entrypoint: r.entrypoint ?? null,
        version: r.version ?? null,
        startedAt: r.startedAt ?? null,
        statusSince: r.statusUpdatedAt ?? null,
        model: t?.model ?? null,
        permissionMode: t?.permissionMode ?? null,
        contextTokens: t?.contextTokens ?? null,
        contextPct: ctx ? ctx.pct : t?.contextTokens != null ? (t.contextTokens / FALLBACK_CONTEXT_LIMIT) * 100 : null,
        contextExact: !!ctx,
        lastPrompt: t?.lastPrompt ?? null,
        activity: newer(t?.activity, h?.activity),
        subagents: t?.subagents ?? 0,
        lastWriteAt: t?.lastWriteAt ?? null,
      };
    }),
  );
  sessions.sort((a, b) => a.cwd.localeCompare(b.cwd) || (a.startedAt ?? 0) - (b.startedAt ?? 0));
  return { sessions, edits };
}
