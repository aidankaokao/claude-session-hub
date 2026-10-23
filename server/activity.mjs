import fs from 'node:fs/promises';
import path from 'node:path';
import { HISTORY_FILE } from './paths.mjs';

// Activity = prompts you typed, from Claude Code's prompt history (~/.claude/history.jsonl).
const CALENDAR_DAYS = 84; // 12 weeks
const WEEK_HOUR_DAYS = 28;

let cache = { mtimeMs: 0, data: null };

const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function readActivity(now = new Date()) {
  const st = await fs.stat(HISTORY_FILE).catch(() => null);
  if (!st) return null;
  // also recompute when the day rolls over
  const key = `${st.mtimeMs}:${dayKey(now)}`;
  if (cache.key === key) return cache.data;

  const lines = (await fs.readFile(HISTORY_FILE, 'utf8')).split('\n');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const calendarStart = today.getTime() - (CALENDAR_DAYS - 1) * 86_400_000;
  const weekHourStart = today.getTime() - (WEEK_HOUR_DAYS - 1) * 86_400_000;

  const days = {};
  const weekHour = Array.from({ length: 7 }, () => Array(24).fill(0)); // [weekday 0=Sun][hour]
  const projects = new Map();
  let total = 0;

  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const t = e.timestamp;
    if (typeof t !== 'number' || t < calendarStart) continue;
    const d = new Date(t);
    total++;
    days[dayKey(d)] = (days[dayKey(d)] ?? 0) + 1;
    if (t >= weekHourStart) {
      weekHour[d.getDay()][d.getHours()]++;
      if (e.project) projects.set(e.project, (projects.get(e.project) ?? 0) + 1);
    }
  }

  const data = {
    from: dayKey(new Date(calendarStart)),
    to: dayKey(today),
    days,
    weekHour,
    weekHourDays: WEEK_HOUR_DAYS,
    total,
    topProjects: [...projects]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p, n]) => ({ project: path.basename(p), count: n })),
  };
  cache = { key, data };
  return data;
}
