import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  ISLAND_TOP,
  PLAZA_R,
  animateFireworks,
  animateWorld,
  bridgeHead,
  burstFireworks,
  createIsland,
  createLightning,
  createPlaza,
  orientIsland,
  plazaFoot,
  resizeIsland,
  spotLocal,
  stationFor,
} from './world.js';
import { bindPermissionActions, bindRemoteToggle, permissionCard } from './permissions-ui.js';
import { createScenery } from './scenery.js';
import { bindActivity, openActivity } from './activity-ui.js';

const STATE_COLOR = { busy: 0x2fb67c, idle: 0x9aa3b2, waiting: 0xff5a4e };
const PLAZA = '__plaza__';
const WALK_SPEED = 4.5;
// Only celebrate turns that were real work, not a one-line answer.
const CELEBRATE_AFTER_MS = 45_000;

// ---------- scene ----------

const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3d9b8);
// Far enough that the distant mountains read as hazy silhouettes instead of vanishing.
scene.fog = new THREE.Fog(0xf3d9b8, 90, 340);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 34, 44);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 8;
controls.maxDistance = 140;

// ---------- trackpad navigation ----------
// Map-style: two-finger swipe pans, pinch zooms, three-finger drag (left drag) still orbits.

const PAN_SPEED = 0.0015; // world units per scroll pixel, per unit of camera distance
const KEY_PAN_PX_PER_SEC = 700;
const panForward = new THREE.Vector3();
const panRight = new THREE.Vector3();
const dollyOffset = new THREE.Vector3();

function panBy(dx, dy) {
  const k = camera.position.distanceTo(controls.target) * PAN_SPEED;
  camera.getWorldDirection(panForward);
  panForward.y = 0;
  panForward.normalize();
  panRight.crossVectors(panForward, camera.up).normalize();
  const move = panRight.multiplyScalar(dx * k).addScaledVector(panForward, dy * k);
  camera.position.add(move);
  controls.target.add(move);
  followId = null;
}

function dollyBy(factor) {
  dollyOffset.subVectors(camera.position, controls.target);
  const len = THREE.MathUtils.clamp(dollyOffset.length() * factor, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(dollyOffset.setLength(len));
}

// Capture phase on the container runs before OrbitControls' own wheel handler on the canvas,
// so touch-screen pinch (handled by OrbitControls) keeps working.
container.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    e.stopPropagation();
    const scale = e.deltaMode === 1 ? 16 : 1; // line-based deltas (some mice)
    if (e.ctrlKey) dollyBy(Math.exp(e.deltaY * scale * 0.01)); // Chrome/Firefox report pinch as ctrl+wheel
    // "grab the ground", like dragging a map on a phone. Signs were tuned by hand on a Mac trackpad:
    // the vertical axis needed flipping, the horizontal one did not.
    else panBy(e.deltaX * scale, -e.deltaY * scale);
  },
  { capture: true, passive: false },
);

// Safari reports pinch as gesture events instead of ctrl+wheel.
let gestureStartDistance = null;
container.addEventListener('gesturestart', (e) => {
  e.preventDefault();
  gestureStartDistance = camera.position.distanceTo(controls.target);
});
container.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (gestureStartDistance == null) return;
  dollyBy(gestureStartDistance / e.scale / camera.position.distanceTo(controls.target));
});
container.addEventListener('gestureend', () => (gestureStartDistance = null));

// Arrow keys / WASD pan while held (positive dy = forward).
const KEY_DIRS = {
  ArrowUp: [0, 1], KeyW: [0, 1],
  ArrowDown: [0, -1], KeyS: [0, -1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};
const heldKeys = new Set();
addEventListener('keydown', (e) => {
  if (!KEY_DIRS[e.code] || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
  heldKeys.add(e.code);
  e.preventDefault();
});
addEventListener('keyup', (e) => heldKeys.delete(e.code));
addEventListener('blur', () => heldKeys.clear());

function keyPan(dt) {
  if (!heldKeys.size) return;
  let dx = 0;
  let dy = 0;
  for (const code of heldKeys) {
    dx += KEY_DIRS[code][0];
    dy += KEY_DIRS[code][1];
  }
  if (dx || dy) panBy(dx * KEY_PAN_PX_PER_SEC * dt, dy * KEY_PAN_PX_PER_SEC * dt);
}

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3b6e8f, 1.1));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
sun.position.set(25, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 150 });
scene.add(sun);

// Low-poly ocean: a flat-shaded grid whose vertices ripple every frame.
const oceanGeo = new THREE.PlaneGeometry(300, 300, 80, 80);
oceanGeo.rotateX(-Math.PI / 2);
const oceanBase = Float32Array.from(oceanGeo.attributes.position.array);
const ocean = new THREE.Mesh(
  oceanGeo,
  new THREE.MeshStandardMaterial({ color: 0x3b8ea5, flatShading: true, roughness: 0.6 }),
);
ocean.receiveShadow = true;
scene.add(ocean);

function animateOcean(t) {
  const pos = oceanGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = oceanBase[i * 3];
    const z = oceanBase[i * 3 + 2];
    pos.array[i * 3 + 1] = Math.sin(x * 0.18 + t * 0.9) * 0.18 + Math.cos(z * 0.21 + t * 0.7) * 0.18 - 0.2;
  }
  pos.needsUpdate = true;
  oceanGeo.computeVertexNormals();
}

createPlaza(scene);
const animateScenery = createScenery(scene);

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.round(s / 60)} 分`;
  return `${(s / 3600).toFixed(1)} 小時`;
}

function hashHue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 360) / 360;
}

// same thresholds for the label bar and the context board; you usually compact somewhere in 60–80%
const ctxLevel = (pct) => (pct >= 80 ? 'full' : pct >= 60 ? 'warn' : '');
const kTokens = (n) => (n == null ? '—' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function disposeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
    if (o.isCSS2DObject) o.element.remove();
  });
  obj.removeFromParent();
}

// ---------- islands ----------

const islands = new Map(); // cwd -> island
const characters = new Map(); // sessionId -> character

function addIsland(cwd, project) {
  const island = createIsland(scene, project);
  const label = new CSS2DObject(island.labelEl);
  island.group.add(label);
  island.label = label;
  islands.set(cwd, island);
  return island;
}

function removeIsland(cwd) {
  const island = islands.get(cwd);
  disposeObject(island.group);
  disposeObject(island.bridge);
  islands.delete(cwd);
}

// ---------- characters ----------

function createCharacter(session) {
  const group = new THREE.Group();
  const hue = hashHue(session.id);
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.55, 0.55), flatShading: true });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 3, 8), bodyMat);
  body.position.y = 0.6;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffdcb8, flatShading: true }),
  );
  head.position.y = 1.32;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1d2433 });
  for (const x of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), eyeMat);
    eye.position.set(x, 0.04, 0.27);
    head.add(eye);
  }
  const avatar = new THREE.Group();
  avatar.add(body, head);
  avatar.traverse((o) => o.isMesh && (o.castShadow = true));
  group.add(avatar);

  // floating "!" while waiting on the user
  const bang = new THREE.Group();
  const bangMat = new THREE.MeshStandardMaterial({ color: 0xff5a4e, emissive: 0xff5a4e, emissiveIntensity: 0.5 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), bangMat);
  bar.position.y = 0.3;
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), bangMat);
  bang.add(bar, dot);
  bang.position.y = 2.0;
  group.add(bang);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.6, 24),
    new THREE.MeshBasicMaterial({ color: STATE_COLOR.idle, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  // subagent orbs
  const orbs = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.11, 0),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.7, 0.7), flatShading: true }),
    );
    orb.visible = false;
    orbs.add(orb);
  }
  group.add(orbs);

  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  const label = new CSS2DObject(labelEl);
  label.position.y = 2.5;
  group.add(label);

  group.traverse((o) => (o.userData.sessionId = session.id));
  scene.add(group);
  return {
    id: session.id,
    group,
    avatar,
    bang,
    ring,
    orbs,
    labelEl,
    session,
    phase: Math.random() * 10,
    zone: null, // where the character currently is: a cwd or PLAZA
    goal: null, // { zone, local | world, look }
    route: [], // waypoints still to walk through before reaching the goal zone
    walking: false,
    heading: 0,
    busySince: null,
  };
}

function renderLabel(c) {
  const s = c.session;
  let doing;
  if (s.status === 'waiting') doing = `<span class="alert">⚠ ${esc(s.waitingMessage)}</span>`;
  else if (s.status === 'busy')
    doing = s.activity ? `${esc(s.activity.tool)} · ${esc(s.activity.detail)}` : '思考中…';
  else doing = `閒置 ${ago(s.statusSince)}`;

  const pct = Math.min(100, s.contextPct ?? 0);
  const ctxClass = ctxLevel(pct);
  const ctxTitle = `context ${Math.round(pct)}%${s.contextExact ? '' : '（估計值，等 statusline 回報後會變精確）'}`;
  const queued = latest.inbox?.queued?.[s.id]?.length ?? 0;
  const conflict = latest.conflicts?.some((k) => k.sessionIds.includes(s.id));
  const badges = [conflict ? '⚡' : '', queued ? `✉${queued}` : ''].join('');
  c.labelEl.className = `label ${s.status}`;
  c.labelEl.innerHTML = `
    <div class="name">${badges ? `<span class="badges">${badges}</span>` : ''}${esc(s.title || s.name)}</div>
    <div class="doing">${doing}</div>
    <div class="ctx ${ctxClass}" title="${ctxTitle}"><i style="width:${pct}%"></i></div>`;
}

// ---------- goals & routing ----------

function setGoal(c, goal) {
  if (!c.zone) {
    // first appearance: spawn in place
    c.zone = goal.zone;
    c.group.position.copy(goalWorld(goal, new THREE.Vector3()));
  } else if (goal.zone !== (c.goal?.zone ?? c.zone)) {
    c.route = planRoute(c.zone, goal.zone);
  }
  c.goal = goal;
}

// Islands only connect to the plaza, so every trip between zones goes over bridges.
function planRoute(from, to) {
  if (from === to) return [];
  const route = [];
  if (from !== PLAZA) route.push({ kind: 'head', zone: from }, { kind: 'foot', zone: from });
  if (to !== PLAZA) route.push({ kind: 'foot', zone: to }, { kind: 'head', zone: to });
  return route;
}

function waypointWorld(wp, out) {
  const island = islands.get(wp.zone);
  if (!island) return null;
  return wp.kind === 'head' ? bridgeHead(island, out) : plazaFoot(island, out);
}

function goalWorld(goal, out) {
  if (goal.zone === PLAZA) return out.copy(goal.world);
  const island = islands.get(goal.zone);
  return island ? island.group.localToWorld(out.copy(goal.local)) : null;
}

function lookWorld(goal, out) {
  if (goal.zone === PLAZA) return out.set(0, ISLAND_TOP, 0);
  const island = islands.get(goal.zone);
  return island ? island.group.localToWorld(out.copy(goal.look)) : null;
}

function assignGoals(sessions) {
  // island spots: group by (cwd, spot) so characters at the same station stand side by side
  const spots = new Map();
  const idle = [];
  for (const s of sessions) {
    if (s.status === 'idle') {
      idle.push(s);
      continue;
    }
    const key = s.status === 'waiting' ? 'front' : stationFor(s.activity?.tool);
    const k = `${s.cwd}\n${key}`;
    if (!spots.has(k)) spots.set(k, { cwd: s.cwd, key, members: [] });
    spots.get(k).members.push(s);
  }
  for (const { cwd, key, members } of spots.values()) {
    const island = islands.get(cwd);
    members.forEach((s, i) => {
      const local = new THREE.Vector3();
      const look = new THREE.Vector3();
      spotLocal(island, key, i, members.length, local, look);
      setGoal(characters.get(s.id), { zone: cwd, local, look });
    });
  }

  // idle characters gather around the campfire
  const r = 3.3 + 0.12 * Math.max(0, idle.length - 8);
  idle.forEach((s, i) => {
    const a = (i / Math.max(idle.length, 1)) * Math.PI * 2 + 0.3;
    const world = new THREE.Vector3(Math.cos(a) * r, ISLAND_TOP, Math.sin(a) * r);
    setGoal(characters.get(s.id), { zone: PLAZA, world });
  });
}

// ---------- sync with server state ----------

let latest = { sessions: [], permissions: [], conflicts: [], inbox: { listening: [], queued: {} } };

// ---------- conflict lightning ----------

const bolts = new Map(); // "idA|idB" -> bolt

function syncBolts(conflicts) {
  const wanted = new Set();
  for (const { sessionIds } of conflicts) {
    // chain the sessions involved: A–B, B–C, …
    for (let i = 0; i + 1 < sessionIds.length; i++) wanted.add(`${sessionIds[i]}|${sessionIds[i + 1]}`);
  }
  for (const [key, bolt] of bolts) {
    if (!wanted.has(key)) {
      bolt.dispose();
      bolts.delete(key);
    }
  }
  for (const key of wanted) if (!bolts.has(key)) bolts.set(key, createLightning(scene));
}

function animateBolts(t) {
  for (const [key, bolt] of bolts) {
    const [a, b] = key.split('|').map((id) => characters.get(id));
    if (a && b) bolt.update(a.group.position, b.group.position, t);
  }
}

function layoutIslands(byCwd) {
  const cwds = [...byCwd.keys()].sort();
  for (const cwd of cwds) {
    const members = byCwd.get(cwd);
    const island = islands.get(cwd) ?? addIsland(cwd, members[0].project);
    resizeIsland(island, 3.8 + 0.5 * Math.max(0, members.length - 2));
    island.label.position.set(-island.radius * 0.95, 0.3, 0);
  }
  const maxR = Math.max(...cwds.map((cwd) => islands.get(cwd).radius), 4);
  const ringR = Math.max(PLAZA_R + maxR + 9, (cwds.length * (2 * maxR + 4)) / (2 * Math.PI));
  cwds.forEach((cwd, i) => {
    const island = islands.get(cwd);
    const a = (i / cwds.length) * Math.PI * 2 - Math.PI / 2;
    island.target.set(Math.cos(a) * ringR, 0, Math.sin(a) * ringR);
    if (!island.placed) {
      island.group.position.copy(island.target);
      island.placed = true;
    }
    orientIsland(island);
    island.group.updateMatrixWorld();
  });
}

function sync(state) {
  const { sessions } = state;
  const prev = latest.sessions;
  latest = state;

  const byCwd = new Map();
  for (const s of sessions) {
    if (!byCwd.has(s.cwd)) byCwd.set(s.cwd, []);
    byCwd.get(s.cwd).push(s);
  }

  for (const [id, c] of characters) {
    if (!sessions.some((s) => s.id === id)) {
      disposeObject(c.group);
      characters.delete(id);
    }
  }
  for (const cwd of islands.keys()) if (!byCwd.has(cwd)) removeIsland(cwd);

  layoutIslands(byCwd);

  const now = Date.now();
  for (const s of sessions) {
    let c = characters.get(s.id);
    if (!c) {
      c = createCharacter(s);
      characters.set(s.id, c);
    }
    const before = prev.find((p) => p.id === s.id)?.status;
    if (s.status === 'busy' && before !== 'busy' && before !== 'waiting') c.busySince = now;
    if (s.status === 'idle' && before && before !== 'idle') {
      if (c.busySince && now - c.busySince > CELEBRATE_AFTER_MS) burstFireworks(scene, c.group.position);
      c.busySince = null;
    }
    c.session = s;
    c.ring.material.color.setHex(STATE_COLOR[s.status]);
    renderLabel(c);
  }
  assignGoals(sessions);
  syncBolts(state.conflicts ?? []);

  renderHud(state);
  renderContextBoard(sessions);
  if (panelId) renderPanel();
}

// ---------- HUD & panel ----------

const $ = (id) => document.getElementById(id);
// Rate limits only refresh when some session gets an API response; flag numbers older than this.
const USAGE_STALE_MS = 10 * 60_000;

function untilText(ms) {
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  if (mins < 60) return `${mins} 分後重置`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} 小時 ${mins % 60} 分後重置`;
  const d = new Date(ms);
  const day = d.toLocaleDateString('zh-TW', { weekday: 'short' });
  const time = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time} 重置`;
}

function renderUsageWindow(prefix, w) {
  const bar = $(`${prefix}-bar`);
  if (!w) {
    bar.style.width = '0%';
    $(`${prefix}-pct`).textContent = '—';
    $(`${prefix}-reset`).textContent = '無資料';
    return;
  }
  const pct = Math.min(100, w.pct);
  bar.style.width = `${pct}%`;
  bar.className = pct >= 80 ? 'full' : pct >= 50 ? 'warn' : '';
  $(`${prefix}-pct`).textContent = `${Math.round(w.pct)}%`;
  $(`${prefix}-reset`).textContent = w.reset ? '已重置' : w.resetsAt ? untilText(w.resetsAt) : '';
}

function renderUsage(usage) {
  $('usage').hidden = !usage;
  $('usage-missing').hidden = !!usage;
  if (!usage) return;
  renderUsageWindow('u5', usage.fiveHour);
  renderUsageWindow('u7', usage.sevenDay);
  const age = Date.now() - usage.updatedAt;
  const updated = $('u-updated');
  updated.textContent = `更新於 ${ago(usage.updatedAt)}前${age > USAGE_STALE_MS ? '（session 都閒置時不會更新）' : ''}`;
  updated.classList.toggle('stale', age > USAGE_STALE_MS);
}
const titleOf = (sessionId) => {
  const s = latest.sessions.find((x) => x.id === sessionId);
  return s ? s.title || s.name : '';
};

function renderHud(state) {
  const { sessions, permissions } = state;
  const count = (st) => sessions.filter((s) => s.status === st).length;
  $('c-waiting').textContent = count('waiting');
  $('c-busy').textContent = count('busy');
  $('c-idle').textContent = count('idle');
  $('hooks-warning').hidden = state.hooksInstalled;
  $('remote-approval').checked = state.remoteApproval;
  renderUsage(state.usage);

  $('permission-list').innerHTML = permissions.map((p) => permissionCard(p, titleOf(p.sessionId))).join('');

  $('conflict-list').innerHTML = (state.conflicts ?? [])
    .map(
      (k) => `<li data-id="${esc(k.sessionIds[0])}" title="${esc(k.file)}">
        <b>⚡ ${esc(k.file.split('/').pop())}</b>${k.sessionIds.map((id) => esc(titleOf(id))).join('、')} 都在改這個檔案（${ago(k.lastAt)}前）</li>`,
    )
    .join('');

  // sessions with an approval card are already shown above
  const withCard = new Set(permissions.map((p) => p.sessionId));
  $('waiting-list').innerHTML = sessions
    .filter((s) => s.status === 'waiting' && !withCard.has(s.id))
    .map(
      (s) => `<li data-id="${esc(s.id)}"><b>${esc(s.project)} · ${esc(s.title || s.name)}</b>${esc(s.waitingMessage)}</li>`,
    )
    .join('');
}

// Top-right list of every session's context usage, fullest first. Estimates (no statusline report yet) get "≈".
function renderContextBoard(sessions) {
  const rows = sessions
    .filter((s) => s.contextPct != null)
    .sort((a, b) => b.contextPct - a.contextPct);
  $('ctx-count').textContent = rows.length ? `${rows.filter((s) => s.contextPct >= 60).length} 個 ≥ 60%` : '';
  $('ctx-list').innerHTML = rows.length
    ? rows
        .map((s) => {
          const pct = Math.min(100, s.contextPct);
          const tip = `${s.project} · ${kTokens(s.contextTokens)} tokens${s.contextExact ? '' : '（估計值，等 statusline 回報後會變精確）'}`;
          return `<li data-id="${esc(s.id)}" title="${esc(tip)}">
            <span class="ctx-name"><span class="status-dot" style="background:var(--${s.status})"></span>${esc(s.title || s.name)}</span>
            <div class="usage-bar"><i class="${ctxLevel(pct)}" style="width:${pct}%"></i></div>
            <b>${s.contextExact ? '' : '≈'}${Math.round(s.contextPct)}%</b>
          </li>`;
        })
        .join('')
    : '<li class="muted">沒有執行中的 session</li>';
}
try {
  $('ctx-board').open = localStorage.getItem('ctx-board') !== 'closed';
} catch {}
$('ctx-board').addEventListener('toggle', () => {
  try {
    localStorage.setItem('ctx-board', $('ctx-board').open ? 'open' : 'closed');
  } catch {}
});

for (const list of ['waiting-list', 'conflict-list', 'ctx-list']) {
  $(list).addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) focusSession(li.dataset.id);
  });
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

const FOCUS_RESULT = {
  ok: null,
  notfound: '找不到對應的 Terminal 分頁（這個 session 可能開在其他終端程式裡）',
  notty: '這個 session 沒有終端（可能是背景或 SDK 啟動的）',
  denied: '沒有控制 Terminal 的權限：到「系統設定 › 隱私權與安全性 › 自動化」允許 node 控制「終端機」',
  error: '切換失敗，請看 hub 的 log',
};

async function focusTerminal(sessionId) {
  const { ok, data } = await postJson('/api/focus', { sessionId });
  const msg = ok ? FOCUS_RESULT[data.result] : '這個 session 已經結束了';
  if (msg) toast(msg);
}

const activityRoot = $('activity');
bindActivity(activityRoot, $('tooltip'));
$('open-activity').onclick = () => openActivity(activityRoot);
bindPermissionActions($('permission-list'), (id) => focusSession(id));
bindPermissionActions($('panel-body'), (id) => focusSession(id));
bindRemoteToggle($('remote-approval'));

let panelId = null;

function renderPanel() {
  const s = latest.sessions.find((x) => x.id === panelId);
  if (!s) {
    closePanel();
    return;
  }
  const color = '#' + STATE_COLOR[s.status].toString(16).padStart(6, '0');
  const statusText = { busy: '工作中', idle: '閒置', waiting: '等你回應' }[s.status];
  const activity = s.activity ? `${s.activity.tool} · ${s.activity.detail} (${ago(s.activity.at)}前)` : '—';
  const cards = latest.permissions
    .filter((p) => p.sessionId === s.id)
    .map((p) => permissionCard(p, s.title || s.name))
    .join('');
  const conflicts = (latest.conflicts ?? []).filter((k) => k.sessionIds.includes(s.id));
  const conflictHtml = conflicts.length
    ? `<div class="panel-conflicts">⚡ 和其他 session 同時在改：${conflicts
        .map((k) => `<div title="${esc(k.file)}"><b>${esc(k.file.split('/').pop())}</b> — ${k.sessionIds
          .filter((id) => id !== s.id)
          .map((id) => esc(titleOf(id)))
          .join('、')}</div>`)
        .join('')}</div>`
    : '';
  const ctxText = s.contextPct == null ? '—' : `${Math.round(s.contextPct)}%${s.contextExact ? '' : '（估計）'}`;
  $('panel-body').innerHTML = `
    <h2>${esc(s.title || s.name)}</h2>
    <div class="sub">${esc(s.name)}</div>
    <div class="panel-actions">
      <button data-action="focus" title="也可以雙擊角色">切到 Terminal</button>
    </div>
    ${cards}
    ${conflictHtml}
    <dl>
      <dt>狀態</dt><dd><span class="status-dot" style="background:${color}"></span>${statusText}${
        s.waitingMessage ? ` — ${esc(s.waitingMessage)}` : ''
      }</dd>
      <dt>目前動作</dt><dd>${esc(activity)}</dd>
      <dt>專案</dt><dd>${esc(s.cwd)}</dd>
      <dt>模型</dt><dd>${esc(s.model ?? '—')}</dd>
      <dt>權限模式</dt><dd>${esc(s.permissionMode ?? '—')}</dd>
      <dt>Context</dt><dd>${ctxText} · ${kTokens(s.contextTokens)} tokens</dd>
      <dt>Subagents</dt><dd>${s.subagents}</dd>
      <dt>已執行</dt><dd>${ago(s.startedAt)}</dd>
      <dt>PID</dt><dd>${s.pid}</dd>
      <dt>Session ID</dt><dd>${esc(s.id)}</dd>
    </dl>
    ${s.lastPrompt ? `<div class="prompt"><b>最後的指令</b>\n${esc(s.lastPrompt)}</div>` : ''}
    <div class="cmd"><code>cd ${esc(s.cwd)} &amp;&amp; claude --resume ${esc(s.id)}</code><button id="copy-resume">複製</button></div>`;
  $('copy-resume').onclick = () =>
    navigator.clipboard.writeText(`cd ${JSON.stringify(s.cwd)} && claude --resume ${s.id}`);
  renderCompose(s);
  $('panel').hidden = false;
}

// Only the hint and queue are live; the textarea is left alone so typing survives updates.
function renderCompose(s) {
  const listening = latest.inbox?.listening?.includes(s.id);
  $('compose-hint').textContent = listening
    ? '閒置中，送出後會立刻喚醒它'
    : s.status === 'idle'
      ? '還沒偵測到傳話 hook（這個 session 需要重開才會載入），訊息會先排隊'
      : '忙碌中，會在這一輪結束後送達';
  const queue = latest.inbox?.queued?.[s.id] ?? [];
  $('compose-queue').innerHTML = queue
    .map(
      (m) => `<li><span>✉ ${esc(m.text)}</span>
        <button type="button" data-drop="${esc(m.id)}" title="取消這則">✕</button></li>`,
    )
    .join('');
}

$('panel-body').addEventListener('click', (e) => {
  const action = e.target.closest('button[data-action]')?.dataset.action;
  if (!panelId || !action) return;
  if (action === 'focus') focusTerminal(panelId);
});

$('compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('compose-text').value.trim();
  if (!panelId || !text) return;
  const { ok } = await postJson('/api/message', { sessionId: panelId, text });
  if (ok) {
    $('compose-text').value = '';
    toast('已送出');
  } else {
    toast('送出失敗（訊息太長，或 session 已經結束）');
  }
});
$('compose-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('compose').requestSubmit();
});
$('compose-queue').addEventListener('click', (e) => {
  const id = e.target.closest('button[data-drop]')?.dataset.drop;
  if (id && panelId) postJson('/api/message/drop', { sessionId: panelId, id });
});

function closePanel() {
  panelId = null;
  $('panel').hidden = true;
}
$('panel-close').onclick = closePanel;

let followId = null; // camera target follows this character while it walks

function focusSession(id) {
  if (!characters.has(id)) return;
  if (id !== panelId) $('compose-text').value = ''; // a draft belongs to the session it was written for
  followId = id;
  panelId = id;
  renderPanel();
}
controls.addEventListener('start', () => (followId = null)); // manual orbit/pan stops following

// ---------- picking ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;

function pick(e) {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects([...characters.values()].map((c) => c.avatar), true)[0];
}

renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  // ignore drags (orbiting)
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const hit = pick(e);
  if (hit) focusSession(hit.object.userData.sessionId);
});
renderer.domElement.addEventListener('dblclick', (e) => {
  const hit = pick(e);
  if (hit) focusTerminal(hit.object.userData.sessionId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  renderer.domElement.style.cursor = pick(e) ? 'pointer' : '';
});

// ---------- animation ----------

const clock = new THREE.Clock();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function turnToward(c, angle, k) {
  let d = angle - c.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way round
  c.heading += d * k;
  c.avatar.rotation.y = c.heading;
}

function walk(c, dt) {
  if (!c.goal) return;
  const wp = c.route[0];
  const target = wp ? waypointWorld(wp, tmpA) : goalWorld(c.goal, tmpA);
  if (!target) {
    if (wp) c.route.shift();
    return;
  }
  const pos = c.group.position;
  const d = tmpB.subVectors(target, pos);
  d.y = 0;
  const dist = d.length();
  if (dist > 0.06) {
    pos.addScaledVector(d.normalize(), Math.min(dist, WALK_SPEED * dt));
    pos.y = target.y;
    c.walking = true;
    turnToward(c, Math.atan2(d.x, d.z), 0.25);
  } else {
    pos.copy(target);
    if (wp) {
      c.route.shift();
    } else {
      c.walking = false;
      c.zone = c.goal.zone;
    }
  }
}

function animateCharacter(c, t, dt) {
  walk(c, dt);
  const s = c.session.status;
  const p = t + c.phase;
  c.bang.visible = s === 'waiting';

  if (c.walking) {
    c.avatar.position.y = Math.abs(Math.sin(p * 12)) * 0.12;
    c.avatar.rotation.z = Math.sin(p * 12) * 0.06;
    c.avatar.scale.setScalar(1);
  } else {
    c.avatar.rotation.z = 0;
    const look = s === 'waiting' ? camera.position : c.goal && lookWorld(c.goal, tmpA);
    if (look) turnToward(c, Math.atan2(look.x - c.group.position.x, look.z - c.group.position.z), 0.12);

    if (s === 'busy') {
      c.avatar.position.y = Math.abs(Math.sin(p * 7)) * 0.06;
      c.avatar.scale.setScalar(1);
    } else if (s === 'waiting') {
      c.avatar.position.y = Math.abs(Math.sin(p * 5)) * 0.5;
      c.avatar.scale.setScalar(1);
    } else {
      // sitting by the fire
      c.avatar.position.y = -0.18;
      c.avatar.scale.set(1, 0.9 + Math.sin(p * 1.5) * 0.02, 1);
    }
  }

  if (s === 'waiting') {
    c.bang.position.y = 2.0 + Math.sin(p * 5) * 0.12;
    c.bang.rotation.y = p * 2;
    c.ring.scale.setScalar(1 + (Math.sin(p * 6) + 1) * 0.35);
    c.ring.material.opacity = 0.9;
  } else {
    c.ring.scale.setScalar(1);
    c.ring.material.opacity = s === 'busy' ? 0.5 + Math.sin(p * 4) * 0.3 : 0.4;
  }

  const n = Math.min(c.session.subagents, c.orbs.children.length);
  c.orbs.children.forEach((orb, i) => {
    orb.visible = i < n;
    if (!orb.visible) return;
    const a = p * 1.6 + (i / n) * Math.PI * 2;
    orb.position.set(Math.cos(a) * 0.9, 1.1 + Math.sin(p * 3 + i) * 0.15, Math.sin(a) * 0.9);
    orb.rotation.x = orb.rotation.y = p * 2;
  });
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  animateOcean(t);
  animateWorld(t);
  animateScenery(t);
  animateFireworks(dt);
  for (const island of islands.values()) {
    island.group.position.lerp(island.target, 0.05);
    island.group.position.y = Math.sin(t * 0.8 + island.target.x) * 0.06;
    orientIsland(island);
    island.group.updateMatrixWorld();
  }
  for (const c of characters.values()) animateCharacter(c, t, dt);
  animateBolts(t);

  keyPan(dt);
  const followed = followId && characters.get(followId);
  if (followed) controls.target.lerp(followed.group.position, 0.08);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// idle durations and reset countdowns are relative to now; refresh them even when no new data arrives
setInterval(() => {
  characters.forEach(renderLabel);
  renderUsage(latest.usage);
}, 5000);

// ---------- live data ----------

const conn = $('conn');
const events = new EventSource('/events');
events.onopen = () => {
  conn.textContent = '即時連線中';
  conn.classList.remove('down');
};
events.onerror = () => {
  conn.textContent = '與 hub 斷線，重新連線中…';
  conn.classList.add('down');
};
events.onmessage = (e) => sync(JSON.parse(e.data));
