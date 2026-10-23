import * as THREE from 'three';

export const ISLAND_TOP = 0.6;
export const PLAZA_R = 6;

// Island-local layout: +x always points at the plaza (the bridge side); stations fan out around the rest.
const DEG = Math.PI / 180;
export const STATIONS = {
  forge: { angle: 60 * DEG, tools: ['Bash', 'BashOutput', 'KillShell'] },
  books: { angle: 120 * DEG, tools: ['Read', 'Grep', 'Glob', 'LSP'] },
  bench: { angle: 180 * DEG, tools: ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'] },
  scope: { angle: 240 * DEG, tools: ['WebFetch', 'WebSearch'] },
  portal: { angle: 300 * DEG, tools: ['Agent', 'Task', 'Skill'] },
};
const TOOL_STATION = Object.fromEntries(
  Object.entries(STATIONS).flatMap(([key, s]) => s.tools.map((t) => [t, key])),
);
export const stationFor = (tool) => TOOL_STATION[tool] ?? (tool?.startsWith('mcp__') ? 'scope' : 'desk');

const STATION_DIST = 0.62; // fraction of island radius
const animated = [];

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---------- plaza ----------

export function createPlaza(scene) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(PLAZA_R, PLAZA_R * 1.15, 1.4, 12), mat(0xb9a58a), 0, -0.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(PLAZA_R * 0.98, PLAZA_R, 0.3, 12), mat(0xd8c7a6), 0, ISLAND_TOP - 0.15, 0));

  const fire = new THREE.Group();
  fire.position.y = ISLAND_TOP;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    fire.add(mesh(new THREE.DodecahedronGeometry(0.22, 0), mat(0x8d8a86), Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7));
  }
  for (const r of [0, Math.PI / 2]) {
    const log = mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), mat(0x6b4226), 0, 0.15, 0);
    log.rotation.set(Math.PI / 2, r, 0);
    fire.add(log);
  }
  const flameMat = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2, flatShading: true });
  const flames = [
    [0xff7a1a, 0.38, 1.0],
    [0xffb238, 0.26, 0.8],
    [0xffe27a, 0.15, 0.55],
  ].map(([c, r, h]) => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), flameMat(c));
    f.position.y = 0.2 + h / 2;
    fire.add(f);
    return f;
  });
  const light = new THREE.PointLight(0xff9a3c, 12, 14, 1.6);
  light.position.y = 1.2;
  fire.add(light);
  g.add(fire);
  animated.push((t) => {
    flames.forEach((f, i) => {
      const s = 1 + Math.sin(t * (9 + i * 3)) * 0.12 + Math.random() * 0.06;
      f.scale.set(1 / s, s, 1 / s);
      f.rotation.y = t * (1 + i);
    });
    light.intensity = 10 + Math.sin(t * 13) * 1.5 + Math.random() * 1.5;
  });

  // seat logs around the fire
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const seat = mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 6), mat(0x7a5232), Math.cos(a) * 4.1, ISLAND_TOP + 0.15, Math.sin(a) * 4.1);
    seat.rotation.set(Math.PI / 2, -a, 0, 'YXZ'); // lie down, tangent to the circle
    g.add(seat);
  }
  scene.add(g);
  return g;
}

// ---------- stations ----------

function forge() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.7, 0.7), mat(0x4a4f5a), 0, 0.35, 0));
  const emberMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff6a1a, emissiveIntensity: 1 });
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.4), emberMat, 0, 0.74, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.1, 6), mat(0x3a3f4b), 0.3, 1.05, -0.2));
  animated.push((t) => (emberMat.emissiveIntensity = 0.7 + Math.sin(t * 5) * 0.3));
  return g;
}

function books() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.2, 1.6, 0.4), mat(0x8a5a3b), 0, 0.8, 0));
  const colors = [0xd9534f, 0x5b8def, 0xf5c242, 0x4fb07a, 0x9b6bd6, 0xe48a3c];
  colors.forEach((c, i) => {
    const row = Math.floor(i / 3);
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.42, 0.3), mat(c), -0.35 + (i % 3) * 0.33, 0.45 + row * 0.6, 0.08));
  });
  return g;
}

function bench() {
  const g = new THREE.Group();
  const wood = mat(0xa8774f);
  g.add(mesh(new THREE.BoxGeometry(1.3, 0.1, 0.7), wood, 0, 0.7, 0));
  for (const [x, z] of [[-0.55, -0.28], [0.55, -0.28], [-0.55, 0.28], [0.55, 0.28]]) {
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), wood, x, 0.35, z));
  }
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.02, 0.3), mat(0xfaf6ee), -0.2, 0.76, 0));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), mat(0x6c7a89), 0.35, 0.85, 0));
  return g;
}

function scope() {
  const g = new THREE.Group();
  const metal = mat(0x5a6170);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 4), metal, Math.cos(a) * 0.2, 0.45, Math.sin(a) * 0.2);
    leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    g.add(leg);
  }
  const tube = mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.0, 8), mat(0xc9a227, { metalness: 0.4 }), 0, 1.05, -0.15);
  tube.rotation.x = -0.8;
  g.add(tube);
  return g;
}

function portal() {
  const g = new THREE.Group();
  const ring = mesh(
    new THREE.TorusGeometry(0.6, 0.1, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.6, flatShading: true }),
    0,
    0.75,
    0,
  );
  const veil = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 16),
    new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
  );
  veil.position.y = 0.75;
  g.add(ring, veil);
  animated.push((t) => {
    ring.rotation.z = t * 0.8;
    veil.material.opacity = 0.35 + Math.sin(t * 2) * 0.15;
  });
  return g;
}

function desk() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.12, 8), mat(0xa8774f), 0, 0.65, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6), mat(0x7a5232), 0, 0.3, 0));
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.03, 0.28), mat(0x3a3f4b), 0, 0.73, 0));
  return g;
}

const BUILDERS = { forge, books, bench, scope, portal };

// ---------- islands ----------

export function createIsland(scene, project) {
  const group = new THREE.Group();
  const terrain = new THREE.Group();
  terrain.add(mesh(new THREE.CylinderGeometry(1, 1.2, 1.4, 9), mat(0xc89b6d), 0, -0.2, 0));
  terrain.add(mesh(new THREE.CylinderGeometry(0.98, 1, 0.3, 9), mat(0x8cc27a), 0, ISLAND_TOP - 0.15, 0));
  group.add(terrain);

  const stations = {};
  for (const [key, build] of Object.entries(BUILDERS)) {
    stations[key] = build();
    stations[key].position.y = ISLAND_TOP;
    group.add(stations[key]);
  }
  const deskObj = desk();
  deskObj.position.y = ISLAND_TOP;
  group.add(deskObj);

  const tree = new THREE.Group();
  tree.add(mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 5), mat(0x8a5a3b), 0, 0.6, 0));
  tree.add(mesh(new THREE.ConeGeometry(0.6, 1.3, 6), mat(0x4f9a5a), 0, 1.6, 0));
  group.add(tree);

  const bridge = new THREE.Group();
  const plankMat = mat(0x9c6b43);
  bridge.add(mesh(new THREE.BoxGeometry(1, 0.12, 1.1), plankMat));
  for (const z of [-0.55, 0.55]) bridge.add(mesh(new THREE.BoxGeometry(1, 0.06, 0.06), plankMat, 0, 0.4, z));
  scene.add(bridge);
  scene.add(group);

  const labelEl = document.createElement('div');
  labelEl.className = 'island-label';
  labelEl.textContent = project;

  return { group, terrain, stations, tree, bridge, labelEl, radius: 4, target: new THREE.Vector3() };
}

export function resizeIsland(island, radius) {
  island.radius = radius;
  island.terrain.scale.set(radius, 1, radius);
  for (const [key, obj] of Object.entries(island.stations)) {
    const a = STATIONS[key].angle;
    obj.position.set(Math.cos(a) * radius * STATION_DIST, ISLAND_TOP, Math.sin(a) * radius * STATION_DIST);
    obj.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)); // face the island centre
  }
  island.tree.position.set(Math.cos(25 * DEG) * radius * 0.8, ISLAND_TOP, Math.sin(25 * DEG) * radius * 0.8);
}

// Where a character stands for a spot on an island (island-local), plus what it should look at.
export function spotLocal(island, key, idx, count, out, look) {
  const R = island.radius;
  const spread = (idx - (count - 1) / 2) * 0.75;
  if (key === 'front') {
    out.set(R * 0.55, ISLAND_TOP, spread);
    look.set(R * 2, ISLAND_TOP, spread); // looking out toward the plaza
  } else if (key === 'desk') {
    out.set(-0.95, ISLAND_TOP, spread);
    look.set(0, ISLAND_TOP, spread * 0.3);
  } else {
    const a = STATIONS[key].angle;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const d = R * STATION_DIST - 1.0;
    out.set(dx * d - dz * spread, ISLAND_TOP, dz * d + dx * spread);
    look.set(dx * R * STATION_DIST, ISLAND_TOP, dz * R * STATION_DIST);
  }
}

// Island +x faces the plaza; the bridge spans from the island edge to the plaza edge.
export function orientIsland(island) {
  const p = island.group.position;
  island.group.rotation.y = -Math.atan2(-p.z, -p.x);
  const dist = Math.hypot(p.x, p.z);
  const len = Math.max(0.1, dist - island.radius * 0.92 - PLAZA_R * 0.92);
  const mid = PLAZA_R * 0.92 + len / 2;
  island.bridge.position.set((p.x / dist) * mid, ISLAND_TOP - 0.08, (p.z / dist) * mid);
  island.bridge.rotation.y = -Math.atan2(p.z, p.x);
  island.bridge.scale.x = len;
}

export function bridgeHead(island, out) {
  return island.group.localToWorld(out.set(island.radius * 0.9, ISLAND_TOP, 0));
}

export function plazaFoot(island, out) {
  const p = island.group.position;
  const dist = Math.hypot(p.x, p.z) || 1;
  return out.set((p.x / dist) * PLAZA_R * 0.9, ISLAND_TOP, (p.z / dist) * PLAZA_R * 0.9);
}

export function animateWorld(t) {
  for (const fn of animated) fn(t);
}

// ---------- lightning (file conflicts) ----------

const BOLT_SEGMENTS = 12;

// A jagged bolt between two points that re-strikes every few frames.
export function createLightning(scene) {
  const make = (color, opacity) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((BOLT_SEGMENTS + 1) * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    line.renderOrder = 10;
    line.frustumCulled = false;
    scene.add(line);
    return line;
  };
  const lines = [make(0xffd23f, 0.95), make(0xfff7c2, 0.7)];
  let nextStrike = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  return {
    update(from, to, t) {
      a.copy(from).setY(from.y + 2.3);
      b.copy(to).setY(to.y + 2.3);
      if (t >= nextStrike) {
        nextStrike = t + 0.07 + Math.random() * 0.08;
        const jitter = Math.min(1.2, a.distanceTo(b) * 0.08);
        for (const line of lines) {
          const pos = line.geometry.attributes.position;
          for (let i = 0; i <= BOLT_SEGMENTS; i++) {
            const k = i / BOLT_SEGMENTS;
            const j = i === 0 || i === BOLT_SEGMENTS ? 0 : jitter;
            pos.setXYZ(
              i,
              a.x + (b.x - a.x) * k + (Math.random() - 0.5) * j,
              a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * 1.5 + (Math.random() - 0.5) * j,
              a.z + (b.z - a.z) * k + (Math.random() - 0.5) * j,
            );
          }
          pos.needsUpdate = true;
          line.material.opacity = 0.5 + Math.random() * 0.5;
        }
      }
    },
    dispose() {
      for (const line of lines) {
        line.removeFromParent();
        line.geometry.dispose();
        line.material.dispose();
      }
    },
  };
}

// ---------- fireworks ----------

const bursts = [];
const COLORS = [0xff5a4e, 0xffd23f, 0x2fb67c, 0x5b8def, 0xc084fc].map((c) => new THREE.Color(c));

export function burstFireworks(scene, at) {
  const n = 90;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const velocities = [];
  for (let i = 0; i < n; i++) {
    positions.set([at.x, at.y + 2.6, at.z], i * 3);
    const c = COLORS[i % COLORS.length];
    colors.set([c.r, c.g, c.b], i * 3);
    const v = new THREE.Vector3().randomDirection().multiplyScalar(2.5 + Math.random() * 2);
    v.y += 2;
    velocities.push(v);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, depthWrite: false }),
  );
  scene.add(points);
  bursts.push({ points, velocities, age: 0 });
}

export function animateFireworks(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.age += dt;
    const pos = b.points.geometry.attributes.position;
    b.velocities.forEach((v, j) => {
      v.y -= 4 * dt;
      v.multiplyScalar(0.985);
      pos.array[j * 3] += v.x * dt;
      pos.array[j * 3 + 1] += v.y * dt;
      pos.array[j * 3 + 2] += v.z * dt;
    });
    pos.needsUpdate = true;
    b.points.material.opacity = Math.max(0, 1 - b.age / 1.8);
    if (b.age > 1.8) {
      b.points.removeFromParent();
      b.points.geometry.dispose();
      b.points.material.dispose();
      bursts.splice(i, 1);
    }
  }
}
