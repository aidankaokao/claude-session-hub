import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSessions } from './sessions.mjs';
import { applyHookEvent, hooksInstalled } from './hooks.mjs';
import {
  addRequest,
  decide,
  isRemoteApproval,
  listPending,
  onPermissionsChange,
  releaseAll,
  releaseForEvent,
  setRemoteApproval,
} from './permissions.mjs';
import { notify } from './notify.mjs';
import { readUsage } from './usage.mjs';
import { findConflicts } from './conflicts.mjs';
import { cancel, dropQueued, enqueue, forgetInbox, inboxState, listen, onInboxChange } from './inbox.mjs';
import { focusTerminal } from './terminal.mjs';
import { refreshTokens, tokenReport, tokenSnapshot } from './tokens.mjs';

const MAX_MESSAGE_CHARS = 4000;

const PORT = Number(process.env.CLAUDE_HUB_PORT ?? 4317);
const HOST = '127.0.0.1'; // never expose: session data includes prompts and file paths
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));
const TICK_MS = 1000;
// A page reload briefly drops the last client; only hand pending prompts back to the terminal after this.
const NO_CLIENT_GRACE_MS = 5000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const clients = new Set();
let snapshot = JSON.stringify({
  sessions: [],
  permissions: [],
  conflicts: [],
  inbox: { listening: [], queued: {} },
  hooksInstalled: false,
  remoteApproval: false,
  usage: null,
  tokens: null,
});
let currentSessions = [];

function broadcast(data) {
  for (const res of clients) res.write(`data: ${data}\n\n`);
}

let ticking = false;
let tickAgain = false;
async function tick() {
  // A hook event arriving mid-tick must not be dropped; run once more after the current tick.
  if (ticking) {
    tickAgain = true;
    return;
  }
  ticking = true;
  try {
    const { sessions, edits } = await collectSessions();
    const aliveIds = new Set(sessions.map((s) => s.id));
    forgetInbox(aliveIds);
    // rate-limited internally; not awaited so the first full scan doesn't stall the tick
    refreshTokens().catch((err) => console.error('[hub] token scan failed:', err));
    currentSessions = sessions;
    const next = JSON.stringify({
      sessions,
      permissions: listPending(),
      conflicts: findConflicts(edits),
      inbox: inboxState(),
      hooksInstalled: await hooksInstalled(),
      remoteApproval: isRemoteApproval(),
      usage: await readUsage(),
      tokens: tokenSnapshot(aliveIds),
    });
    if (next !== snapshot) {
      snapshot = next;
      broadcast(snapshot);
    }
  } catch (err) {
    console.error('[hub] tick failed:', err);
  } finally {
    ticking = false;
    if (tickAgain) {
      tickAgain = false;
      tick();
    }
  }
}
onPermissionsChange(tick);
onInboxChange(tick);

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) reject(new Error('body too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, res) {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400).end();
    return null;
  }
}

function applyAndNotify(evt) {
  const waitingMessage = applyHookEvent(evt);
  if (waitingMessage) notify(`Claude · ${path.basename(evt.cwd ?? '')}`, waitingMessage);
}

// Hook endpoints are called by curl, which sends no Origin; browsers always do, so this blocks cross-site spoofing.
async function handleHook(req, res) {
  const evt = await readJson(req, res);
  if (!evt) return;
  applyAndNotify(evt);
  releaseForEvent(evt);
  // the user typed in the terminal (or the session ended): its inbox listener from the last turn is obsolete
  if (evt.hook_event_name === 'UserPromptSubmit' || evt.hook_event_name === 'SessionEnd') cancel(evt.session_id);
  res.writeHead(204).end();
  tick();
}

// Long-polled by hooks/hub-inbox.sh after every turn; answered when a message is queued for the session.
async function handleInbox(req, res) {
  const evt = await readJson(req, res);
  if (!evt) return;
  if (!evt.session_id) {
    res.writeHead(400).end();
    return;
  }
  listen(evt.session_id, res);
}

async function handlePermission(req, res) {
  const evt = await readJson(req, res);
  if (!evt) return;
  applyAndNotify(evt);
  addRequest(evt, res, clients.size > 0);
  tick();
}

// UI actions. These can approve arbitrary tool calls, so only same-origin JSON requests are accepted.
async function handleApi(req, res, route) {
  if (!ALLOWED_ORIGINS.has(req.headers.origin) || !req.headers['content-type']?.startsWith('application/json')) {
    res.writeHead(403).end();
    return;
  }
  const body = await readJson(req, res);
  if (!body) return;
  const session = body.sessionId ? currentSessions.find((s) => s.id === body.sessionId) : null;
  const json = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

  switch (route) {
    case '/api/remote-approval':
      setRemoteApproval(body.enabled);
      return res.writeHead(204).end();
    case '/api/permission':
      return res.writeHead(decide(body.id, body.decision) ? 204 : 404).end();
    case '/api/message': {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!session || !text || text.length > MAX_MESSAGE_CHARS) return res.writeHead(400).end();
      return json(200, { id: enqueue(session.id, text) });
    }
    case '/api/message/drop':
      return res.writeHead(dropQueued(body.sessionId, body.id) ? 204 : 404).end();
    case '/api/focus':
      if (!session) return res.writeHead(404).end();
      return json(200, { result: await focusTerminal(session.pid) });
    default:
      return res.writeHead(404).end();
  }
}

let noClientTimer = null;

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${snapshot}\n\n`);
  clients.add(res);
  clearTimeout(noClientTimer);
  req.on('close', () => {
    clients.delete(res);
    if (clients.size === 0) {
      noClientTimer = setTimeout(() => clients.size === 0 && releaseAll(), NO_CLIENT_GRACE_MS);
    }
  });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

const server = http.createServer((req, res) => {
  // Rejecting foreign Host headers defeats DNS-rebinding attacks against this localhost server.
  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    res.writeHead(403).end();
    return;
  }
  const route = new URL(req.url, 'http://x').pathname;
  const hookRoutes = { '/hook': handleHook, '/permission': handlePermission, '/inbox': handleInbox };
  if (req.method === 'POST' && hookRoutes[route]) {
    if (req.headers.origin) {
      res.writeHead(403).end();
      return;
    }
    return hookRoutes[route](req, res);
  }
  if (req.method === 'GET' && route === '/api/tokens') {
    tokenReport().then(
      (data) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data)),
      (err) => {
        console.error(`[hub] ${route} failed:`, err);
        res.writeHead(500).end();
      },
    );
    return;
  }
  if (req.method === 'POST' && route.startsWith('/api/')) return handleApi(req, res, route);
  if (req.method === 'GET' && route === '/events') return handleEvents(req, res);
  if (req.method === 'GET' && route === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(snapshot);
    return;
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405).end();
});

server.listen(PORT, HOST, () => {
  console.log(`[hub] Claude Session Hub → http://${HOST}:${PORT}`);
  tick();
  setInterval(tick, TICK_MS);
  // keep SSE connections from being closed by idle timeouts
  setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 15_000);
});
