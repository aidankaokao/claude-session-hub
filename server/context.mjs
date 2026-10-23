import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTEXT_DIR } from './paths.mjs';

// Files of sessions that ended are left behind by the status line snippet; prune them eventually.
const PRUNE_AFTER_MS = 7 * 24 * 3600_000;

const cache = new Map(); // file -> { mtimeMs, data }

// Exact context usage per session, as reported to each session's status line.
// Returns Map<sessionId, { pct, size, updatedAt }>.
export async function readContexts(aliveIds) {
  const out = new Map();
  const files = await fs.readdir(CONTEXT_DIR).catch(() => []);
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    const file = path.join(CONTEXT_DIR, f);
    const st = await fs.stat(file).catch(() => null);
    if (!st) continue;
    if (!aliveIds.has(id)) {
      if (now - st.mtimeMs > PRUNE_AFTER_MS) await fs.unlink(file).catch(() => {});
      continue;
    }
    let entry = cache.get(file);
    if (!entry || entry.mtimeMs !== st.mtimeMs) {
      try {
        entry = { mtimeMs: st.mtimeMs, data: JSON.parse(await fs.readFile(file, 'utf8')) };
        cache.set(file, entry);
      } catch {
        continue; // mid-write; next tick
      }
    }
    const { pct, size, updatedAt } = entry.data;
    if (typeof pct === 'number') out.set(id, { pct, size: size ?? null, updatedAt: updatedAt ? updatedAt * 1000 : st.mtimeMs });
  }
  return out;
}
