import crypto from 'node:crypto';
import path from 'node:path';
import { describeTool } from './describe.mjs';

// Must stay below the hook's `timeout` (install-hooks.mjs) and curl's -m (hub-permission.sh).
const MAX_WAIT_MS = 540_000;
const PREVIEW_MAX = 2000;

// id -> { id, sessionId, project, tool, detail, preview, inputKey, suggestions, at, res, timer }
const pending = new Map();
let remoteApproval = false;
let onChange = () => {};

export function onPermissionsChange(fn) {
  onChange = fn;
}

export const isRemoteApproval = () => remoteApproval;

export function setRemoteApproval(enabled) {
  remoteApproval = !!enabled;
  if (!remoteApproval) releaseAll();
  onChange();
}

function preview(tool, input = {}) {
  let text;
  if (tool === 'Bash') text = input.command;
  else if (tool === 'Edit') text = `${input.file_path}\n\n- ${input.old_string ?? ''}\n+ ${input.new_string ?? ''}`;
  else if (tool === 'Write') text = `${input.file_path}\n\n${input.content ?? ''}`;
  else if (tool === 'WebFetch') text = input.url;
  else text = JSON.stringify(input, null, 2);
  text = String(text ?? '');
  return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) + '\n…' : text;
}

function decisionBody(decision, req) {
  if (decision === 'allow' || decision === 'allowAlways') {
    const d = { behavior: 'allow' };
    if (decision === 'allowAlways' && req.suggestions?.length) d.updatedPermissions = req.suggestions;
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } };
  }
  if (decision === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'The user denied this from Session Hub.' },
      },
    };
  }
  return null; // 'release': no decision, Claude Code falls back to its own prompt
}

function finish(id, decision) {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  clearTimeout(req.timer);
  const body = decisionBody(decision, req);
  if (!req.res.writableEnded) {
    if (body) req.res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    else req.res.writeHead(204).end();
  }
  onChange();
  return true;
}

// Holds the hook's HTTP response open until the user decides in the UI.
// Without remote approval (or with no UI open) it answers immediately with "no decision".
export function addRequest(evt, res, uiConnected) {
  if (!remoteApproval || !uiConnected) {
    res.writeHead(204).end();
    return;
  }
  const id = crypto.randomUUID();
  const req = {
    id,
    sessionId: evt.session_id,
    project: path.basename(evt.cwd ?? ''),
    tool: evt.tool_name,
    detail: describeTool(evt.tool_name, evt.tool_input),
    preview: preview(evt.tool_name, evt.tool_input),
    inputKey: JSON.stringify(evt.tool_input ?? {}),
    suggestions: Array.isArray(evt.permission_suggestions) ? evt.permission_suggestions : [],
    at: Date.now(),
    res,
    timer: setTimeout(() => finish(id, 'release'), MAX_WAIT_MS),
  };
  pending.set(id, req);
  // Claude Code kills the hook if the prompt is resolved elsewhere (e.g. answered in the terminal).
  res.on('close', () => pending.has(id) && finish(id, 'release'));
  onChange();
}

export function decide(id, decision) {
  if (!['allow', 'allowAlways', 'deny', 'release'].includes(decision)) return false;
  return finish(id, decision);
}

// The tool already ran (or the turn moved on), so a still-open card is stale.
export function releaseForEvent(evt) {
  for (const req of [...pending.values()]) {
    if (req.sessionId !== evt.session_id) continue;
    const sameCall =
      evt.hook_event_name === 'PostToolUse' &&
      req.tool === evt.tool_name &&
      req.inputKey === JSON.stringify(evt.tool_input ?? {});
    if (sameCall || ['Stop', 'UserPromptSubmit', 'SessionEnd'].includes(evt.hook_event_name)) {
      finish(req.id, 'release');
    }
  }
}

export function releaseAll() {
  for (const id of [...pending.keys()]) finish(id, 'release');
}

export function listPending() {
  return [...pending.values()].map(({ id, sessionId, project, tool, detail, preview, suggestions, at }) => ({
    id,
    sessionId,
    project,
    tool,
    detail,
    preview,
    canRemember: suggestions.length > 0,
    at,
  }));
}
