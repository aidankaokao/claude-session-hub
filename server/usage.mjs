import fs from 'node:fs/promises';
import { USAGE_FILE } from './paths.mjs';

let cache = { mtimeMs: 0, data: null };

function windowOf(w, nowSec) {
  if (!w || typeof w.used_percentage !== 'number') return null;
  // Claude Code drops a window once it resets; the file may still hold the old one.
  if (w.resets_at && w.resets_at <= nowSec) return { pct: 0, resetsAt: null, reset: true };
  return { pct: w.used_percentage, resetsAt: w.resets_at ? w.resets_at * 1000 : null, reset: false };
}

// Account rate limits as last reported to any session's status line, or null if never seen.
export async function readUsage() {
  const st = await fs.stat(USAGE_FILE).catch(() => null);
  if (!st) return null;
  if (st.mtimeMs !== cache.mtimeMs) {
    try {
      cache = { mtimeMs: st.mtimeMs, data: JSON.parse(await fs.readFile(USAGE_FILE, 'utf8')) };
    } catch {
      return null;
    }
  }
  const { rate_limits: rl = {}, updatedAt } = cache.data ?? {};
  const nowSec = Date.now() / 1000;
  return {
    fiveHour: windowOf(rl.five_hour, nowSec),
    sevenDay: windowOf(rl.seven_day, nowSec),
    updatedAt: updatedAt ? updatedAt * 1000 : st.mtimeMs,
  };
}
