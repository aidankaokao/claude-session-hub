import crypto from 'node:crypto';

// Messages to sessions, delivered through the Stop hook `hooks/hub-inbox.sh` (asyncRewake):
// after every turn the hook long-polls /inbox; answering it with text wakes the idle session.
// Must stay below the hook's timeout (install-hooks.mjs) and curl's -m (hub-inbox.sh).
const MAX_WAIT_MS = 43_000_000;

const listeners = new Map(); // sessionId -> { res, timer }
const queues = new Map(); // sessionId -> [{ id, text, at }]
let onChange = () => {};

export function onInboxChange(fn) {
  onChange = fn;
}

function format(messages) {
  return messages
    .map((m) => `【來自使用者，透過 Session Hub 傳送】\n${m.text}`)
    .join('\n\n');
}

function respond(sessionId, body) {
  const l = listeners.get(sessionId);
  if (!l) return false;
  listeners.delete(sessionId);
  clearTimeout(l.timer);
  if (!l.res.writableEnded) {
    if (body) l.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
    else l.res.writeHead(204).end();
  }
  return true;
}

function flush(sessionId) {
  const q = queues.get(sessionId);
  if (!q?.length || !listeners.has(sessionId)) return;
  queues.delete(sessionId);
  respond(sessionId, format(q));
}

// Called by hub-inbox.sh at the end of every turn.
export function listen(sessionId, res) {
  respond(sessionId, null); // a newer turn ended; the older listener is obsolete
  const timer = setTimeout(() => {
    respond(sessionId, null);
    onChange();
  }, MAX_WAIT_MS);
  listeners.set(sessionId, { res, timer });
  res.on('close', () => {
    if (listeners.get(sessionId)?.res === res) {
      clearTimeout(timer);
      listeners.delete(sessionId);
      onChange();
    }
  });
  flush(sessionId);
  onChange();
}

// The user typed in the terminal (or the session ended): the idle window is over.
export function cancel(sessionId) {
  if (respond(sessionId, null)) onChange();
}

export function enqueue(sessionId, text) {
  const msg = { id: crypto.randomUUID(), text, at: Date.now() };
  if (!queues.has(sessionId)) queues.set(sessionId, []);
  queues.get(sessionId).push(msg);
  flush(sessionId);
  onChange();
  return msg.id;
}

export function dropQueued(sessionId, id) {
  const q = queues.get(sessionId);
  const i = q?.findIndex((m) => m.id === id) ?? -1;
  if (i === -1) return false;
  q.splice(i, 1);
  if (!q.length) queues.delete(sessionId);
  onChange();
  return true;
}

export function forgetInbox(aliveIds) {
  for (const id of [...listeners.keys()]) if (!aliveIds.has(id)) respond(id, null);
  for (const id of [...queues.keys()]) if (!aliveIds.has(id)) queues.delete(id);
}

export function inboxState() {
  return {
    listening: [...listeners.keys()],
    queued: Object.fromEntries([...queues].map(([id, q]) => [id, q.map(({ id: mid, text, at }) => ({ id: mid, text, at }))])),
  };
}
