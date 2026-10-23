import fs from 'node:fs/promises';
import { SETTINGS_FILE } from './paths.mjs';
import { describeTool } from './describe.mjs';

export const HOOK_SCRIPT_NAME = 'hub-hook.sh';
export const PERMISSION_SCRIPT_NAME = 'hub-permission.sh';
export const INBOX_SCRIPT_NAME = 'hub-inbox.sh';
const ALL_SCRIPTS = [HOOK_SCRIPT_NAME, PERMISSION_SCRIPT_NAME, INBOX_SCRIPT_NAME];

// sessionId -> { waiting: {message, at} | null, activity: {tool, detail, at} | null,
//                inTool: between PreToolUse and PostToolUse, workAt: last sign of work (0 after Stop) }
const store = new Map();

function entry(id) {
  let e = store.get(id);
  if (!e) store.set(id, (e = { waiting: null, activity: null, inTool: false, workAt: 0 }));
  return e;
}

// Applies one Claude Code hook payload. Returns the waiting message when the session just started waiting on the user.
export function applyHookEvent(evt) {
  const id = evt.session_id;
  if (!id) return null;
  const e = entry(id);
  const now = Date.now();
  const wasWaiting = !!e.waiting;

  switch (evt.hook_event_name) {
    case 'PermissionRequest':
      // Fires the moment the prompt appears; the permission Notification only comes ~6s later.
      e.waiting = { message: `Needs permission: ${evt.tool_name}`, at: now };
      break;
    case 'Notification':
      // idle_prompt just means "finished, nothing to do" — the registry already reports that as idle.
      if (evt.notification_type !== 'idle_prompt') {
        e.waiting = { message: evt.message || 'Needs your attention', at: now };
      }
      break;
    case 'PreToolUse':
      e.activity = { tool: evt.tool_name, detail: describeTool(evt.tool_name, evt.tool_input), at: now };
      e.inTool = true;
      e.workAt = now;
      // AskUserQuestion blocks on the user without firing a Notification.
      e.waiting = evt.tool_name === 'AskUserQuestion' ? { message: 'Asking you a question', at: now } : null;
      break;
    case 'PostToolUse':
    case 'UserPromptSubmit':
      e.inTool = false;
      e.workAt = now;
      e.waiting = null;
      break;
    case 'Stop':
    case 'SessionStart':
      e.inTool = false;
      e.workAt = 0;
      e.waiting = null;
      break;
    case 'SessionEnd':
      store.delete(id);
      return null;
  }
  return !wasWaiting && e.waiting ? e.waiting.message : null;
}

export function getHookState(id) {
  return store.get(id) ?? null;
}

export function forgetSessions(aliveIds) {
  for (const id of store.keys()) if (!aliveIds.has(id)) store.delete(id);
}

let installedCache = { at: 0, value: false };

export async function hooksInstalled() {
  if (Date.now() - installedCache.at < 5000) return installedCache.value;
  const text = await fs.readFile(SETTINGS_FILE, 'utf8').catch(() => '');
  installedCache = { at: Date.now(), value: ALL_SCRIPTS.every((s) => text.includes(s)) };
  return installedCache.value;
}
