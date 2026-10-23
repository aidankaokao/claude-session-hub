import * as THREE from 'three';

// Distant low-poly backdrop: a ring of coast, hills and mountains around the archipelago,
// with a gap to the open sea behind the default camera (+z).

const INNER_R = 100; // shoreline
const OUTER_R = 280;
const SEA_LEVEL = -0.2;

// ---------- deterministic value noise ----------

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2;
  }
  return sum; // ~0..1
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 0 toward +z (open sea behind the default camera), 1 elsewhere; tallest straight ahead (-z).
function landMask(x, z) {
  const angleFromFront = Math.acos(z / Math.hypot(x, z));
  return smoothstep(0.22 * Math.PI, 0.5 * Math.PI, angleFromFront);
}

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const mask = landMask(x, z);
  const behind = smoothstep(0.4 * Math.PI, Math.PI, Math.acos(z / r)); // 1 straight ahead
  const shore = smoothstep(INNER_R, INNER_R + 14, r) * mask;
  let h = -1.2 + shore * 2.2; // starts under water so the coastline meets the sea
  h += fbm(x * 0.03, z * 0.03) * 5 * shore;
  // ridged noise gives sharp peaks
  const ridge = 1 - Math.abs(fbm(x * 0.012 + 7, z * 0.012 - 3) * 2 - 1);
  const mountains = smoothstep(INNER_R + 25, INNER_R + 85, r) * mask;
  h += mountains * ridge * ridge * (22 + 38 * behind);
  return h;
}

// ---------- terrain ----------

const BANDS = [
  [0.5, 0xdcc9a0], // sand
  [4, 0x8cc27a], // grass
  [11, 0x6a9c5c], // forest
  [26, 0x8a8580], // rock
  [Infinity, 0xf4f1ea], // snow
].map(([max, c]) => [max, new THREE.Color(c)]);

function bandColor(h, jitter, out) {
  const [, c] = BANDS.find(([max]) => h < max);
  return out.copy(c).offsetHSL(0, 0, (jitter - 0.5) * 0.06);
}

function createTerrain() {
  let geo = new THREE.RingGeometry(INNER_R - 6, OUTER_R, 120, 26);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }
  // flat colour per triangle for a crisp low-poly look
  geo = geo.toNonIndexed();
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const h = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    bandColor(h, hash(p.getX(i), p.getZ(i)), c);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
}

// ---------- trees ----------

function createTrees(count = 260) {
  const geo = new THREE.ConeGeometry(1.1, 3.2, 6);
  geo.translate(0, 1.6, 0);
  const trees = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ flatShading: true }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  const color = new THREE.Color();
  let placed = 0;
  for (let attempt = 0; placed < count && attempt < count * 30; attempt++) {
    const a = hash(attempt, 1) * Math.PI * 2;
    const r = INNER_R + 8 + hash(attempt, 2) * 70;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < 1 || h > 10) continue; // grass and forest bands only
    const size = 0.7 + hash(attempt, 3) * 0.8;
    m.compose(v.set(x, h - 0.2, z), q, s.set(size, size, size));
    trees.setMatrixAt(placed, m);
    trees.setColorAt(placed, color.setHSL(0.3 + hash(attempt, 4) * 0.06, 0.4, 0.3 + hash(attempt, 5) * 0.1));
    placed++;
  }
  trees.count = placed;
  return trees;
}

// ---------- clouds ----------

function createClouds(count = 9) {
  const clouds = [];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92 });
  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(hash(i, 9) * 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + hash(i, j) * 3, 0), mat);
      puff.position.set(j * 4 - puffs * 2, hash(j, i) * 2, (hash(i + j, 3) - 0.5) * 4);
      puff.scale.y = 0.6;
      cloud.add(puff);
    }
    const r = 60 + hash(i, 7) * 110;
    cloud.userData = { angle: hash(i, 8) * Math.PI * 2, r, speed: 0.004 + hash(i, 6) * 0.006 };
    cloud.position.y = 38 + hash(i, 5) * 20;
    clouds.push(cloud);
  }
  return clouds;
}

// ---------- assembly ----------

export function createScenery(scene) {
  // Static far sea under the animated near ocean, so the water reaches the horizon.
  const farSea = new THREE.Mesh(
    new THREE.CircleGeometry(900, 48),
    new THREE.MeshStandardMaterial({ color: 0x3b8ea5, roughness: 0.6 }),
  );
  farSea.rotation.x = -Math.PI / 2;
  farSea.position.y = SEA_LEVEL - 0.25;
  scene.add(farSea);

  scene.add(createTerrain());
  scene.add(createTrees());
  const clouds = createClouds();
  clouds.forEach((c) => scene.add(c));

  return function animateScenery(t) {
    for (const c of clouds) {
      const { angle, r, speed } = c.userData;
      const a = angle + t * speed;
      c.position.x = Math.cos(a) * r;
      c.position.z = Math.sin(a) * r;
      c.rotation.y = -a;
    }
  };
}
