import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR, projectDirFor } from './paths.mjs';
import { describeTool } from './describe.mjs';

// Only the tail of a transcript is parsed; they can grow to many MB.
const TAIL_BYTES = 256 * 1024;
const SUBAGENT_ACTIVE_MS = 30_000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

const cache = new Map(); // transcriptPath -> { mtimeMs, size, summary }
const locations = new Map(); // sessionId -> transcriptPath

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function locate(sessionId, cwd) {
  const known = locations.get(sessionId);
  if (known && (await exists(known))) return known;

  const guess = path.join(projectDirFor(cwd), `${sessionId}.jsonl`);
  if (await exists(guess)) {
    locations.set(sessionId, guess);
    return guess;
  }
  // Fallback: the cwd encoding rule may change between Claude Code versions.
  for (const dir of await fs.readdir(PROJECTS_DIR).catch(() => [])) {
    const p = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (await exists(p)) {
      locations.set(sessionId, p);
      return p;
    }
  }
  return null;
}

async function readTail(file, size) {
  const fh = await fs.open(file);
  try {
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // first line is probably cut in half
    return lines;
  } finally {
    await fh.close();
  }
}

function parse(lines, previous, cwd) {
  const s = {
    title: null,
    lastPrompt: null,
    permissionMode: null,
    model: null,
    contextTokens: null,
    activity: null,
    edits: [], // { file, at } for every file-editing tool call in the tail, newest first
  };
  const resolvedToolIds = new Set();

  // Walk backwards so the first hit for each field is the most recent one.
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (e.isSidechain) continue;

    if (e.type === 'ai-title' && !s.title) s.title = e.aiTitle;
    else if (e.type === 'last-prompt' && !s.lastPrompt) s.lastPrompt = e.lastPrompt;
    else if (e.type === 'permission-mode' && !s.permissionMode) s.permissionMode = e.permissionMode;
    else if (e.type === 'user' && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) if (c.type === 'tool_result') resolvedToolIds.add(c.tool_use_id);
    } else if (e.type === 'assistant' && e.message) {
      const m = e.message;
      if (m.usage && s.contextTokens == null) {
        const u = m.usage;
        s.contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        s.model = m.model ?? null;
      }
      if (Array.isArray(m.content)) {
        for (const c of m.content) {
          if (c.type === 'tool_use' && EDIT_TOOLS.has(c.name) && c.input?.file_path) {
            s.edits.push({ file: path.resolve(cwd, c.input.file_path), at: Date.parse(e.timestamp) || 0 });
          }
        }
      }
      if (!s.activity && Array.isArray(m.content)) {
        const tool = m.content.findLast((c) => c.type === 'tool_use');
        if (tool) {
          s.activity = {
            tool: tool.name,
            detail: describeTool(tool.name, tool.input),
            at: Date.parse(e.timestamp) || null,
            pending: !resolvedToolIds.has(tool.id),
          };
        }
      }
    }
  }
  // Titles are written rarely; keep the last known one if it scrolled out of the tail.
  s.title ??= previous?.title ?? null;
  s.lastPrompt ??= previous?.lastPrompt ?? null;
  s.permissionMode ??= previous?.permissionMode ?? null;
  return s;
}

async function countActiveSubagents(transcriptPath) {
  const dir = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  const files = await fs.readdir(dir).catch(() => []);
  const now = Date.now();
  let n = 0;
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const st = await fs.stat(path.join(dir, f)).catch(() => null);
    if (st && now - st.mtimeMs < SUBAGENT_ACTIVE_MS) n++;
  }
  return n;
}

export async function summarizeTranscript(sessionId, cwd) {
  const file = await locate(sessionId, cwd);
  if (!file) return null;
  const st = await fs.stat(file).catch(() => null);
  if (!st) return null;

  const cached = cache.get(file);
  let summary = cached?.summary;
  if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
    summary = parse(await readTail(file, st.size), cached?.summary, cwd);
    cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, summary });
  }
  return { ...summary, lastWriteAt: st.mtimeMs, subagents: await countActiveSubagents(file) };
}
