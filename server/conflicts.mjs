// Two live sessions editing the same file within this window is treated as a conflict.
// Only Edit/Write-style tool calls are seen; files changed through Bash (sed, git checkout…) are invisible.
const WINDOW_MS = 30 * 60_000;

// editsBySession: Map<sessionId, {file, at}[]>
export function findConflicts(editsBySession, now = Date.now()) {
  const byFile = new Map(); // file -> Map<sessionId, lastAt>
  for (const [sessionId, edits] of editsBySession) {
    for (const { file, at } of edits) {
      if (now - at > WINDOW_MS) continue;
      if (!byFile.has(file)) byFile.set(file, new Map());
      const who = byFile.get(file);
      who.set(sessionId, Math.max(who.get(sessionId) ?? 0, at));
    }
  }
  const conflicts = [];
  for (const [file, who] of byFile) {
    if (who.size < 2) continue;
    conflicts.push({ file, sessionIds: [...who.keys()].sort(), lastAt: Math.max(...who.values()) });
  }
  return conflicts.sort((a, b) => b.lastAt - a.lastAt);
}
