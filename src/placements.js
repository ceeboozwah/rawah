import * as THREE from 'three';

// The ledger of hand-placed assets (data/placements.json), made with the world editor (src/editor.js) and read by the game at
// boot, so a placement needs no code change: it is data. Each entry is
//   { id, asset: 'spruce:2', x, z, dy, yaw, pitch, roll, s, note }
// where y = the ground at (x, z) + dy (so a placement follows the terrain when the lidar or the stream channels change), the
// angles are radians (Euler order YXZ) and s is the uniform scale in the units flora uses (1 = a 18 m spruce). `removed` lists
// procedural trees and rocks to take out of the world (the keys flora.js uses: 'spruce:123.45:678.90').
//
// Assets are the flora meshes: every variant of every tree species, the rocks and the log, drawn here as instanced meshes
// that share flora's geometry and materials (so they look exactly like the procedural ones), out to `RANGE` metres, and they
// are solid: a trunk or a boulder pushes the hiker aside, through a wrap round `flora.collide`.

const RANGE = { tree: 900, rock: 600 };
const SINK = { tree: 0.15, rock: 0, log: -0.12 };
const TREE_KINDS = ['spruce', 'fir', 'lodgepole', 'aspen', 'snag', 'krumm', 'willow'];
const ROCK_KINDS = ['boulder', 'slab', 'tooth'];
const DIM = { spruce: [18, 3.4], fir: [22, 3], lodgepole: [20, 3], aspen: [12, 3], snag: [19, 1.5], krumm: [3, 2], willow: [3, 2], boulder: [2.5, 2.5], slab: [2.5, 3], tooth: [4, 1.2], log: [1, 3.2] };
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Placements {
  constructor(world, flora, scene) {
    this.world = world; this.flora = flora;
    this.items = [];                 // ledger entries
    this.removed = [];               // keys of procedural things taken out
    this.revision = 0;               // bumps on every change (the editor and the renderer watch it)
    this.group = new THREE.Group();
    scene.add(this.group);
    this.meshes = new Map();         // asset id -> InstancedMesh
    this.at = new THREE.Vector3(1e9, 0, 1e9);
    this.drawn = 0;
    this.nextId = 1;
    this.assets = [];                // the palette: { id, kind, variant, name, group, h, r }
    for (const kind of [...TREE_KINDS, ...ROCK_KINDS, 'log']) {
      (flora.meshes[kind] || []).forEach((m, variant) => {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox;
        const group = TREE_KINDS.includes(kind) ? 'Trees' : kind === 'log' ? 'Wood' : 'Rocks';
        this.assets.push({ id: `${kind}:${variant}`, kind, variant, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${variant + 1}`, group, h: b.max.y - b.min.y, r: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2, geometry: m.geometry, material: m.material });
      });
    }
    this.byId = new Map(this.assets.map((a) => [a.id, a]));
    this.solids = [];                // [x, z, radius] rebuilt with the items
    this.#wrapCollide();
  }

  /** Read data/placements.json (a missing file is an empty ledger) and take its `removed` things out of the procedural world. */
  async load(url = './data/placements.json') {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) this.set(await r.json());
    } catch { /* no ledger yet */ }
  }

  set(d) {
    this.items = (d.items || []).filter((it) => this.byId.has(it.asset));
    this.removed = [...(d.removed || [])];
    this.nextId = 1 + Math.max(0, ...this.items.map((it) => parseInt(String(it.id).replace(/\D/g, ''), 10) || 0));
    for (const k of this.removed) this.flora.removed.add(k);
    this.flora.sweep?.();
    this.#changed();
  }

  toJSON() {
    const r = (v, n = 3) => +v.toFixed(n);
    return { version: 1, items: this.items.map((it) => ({ id: it.id, asset: it.asset, x: r(it.x, 2), z: r(it.z, 2), dy: r(it.dy, 2), yaw: r(it.yaw), pitch: r(it.pitch), roll: r(it.roll), s: r(it.s), ...(it.note ? { note: it.note } : {}) })), removed: this.removed };
  }

  #changed() {
    this.revision++;
    this.dirty = true;
    this.solids = [];
    for (const it of this.items) {
      const a = this.byId.get(it.asset);
      if (!a || a.kind === 'log' || a.kind === 'willow' || a.kind === 'krumm') continue;
      const rock = ROCK_KINDS.includes(a.kind);
      this.solids.push([it.x, it.z, rock ? DIM[a.kind][1] * it.s * 0.8 : 0.24 * it.s * (a.kind === 'snag' ? 0.8 : 1)]);
    }
  }

  add(asset, x, z, props = {}) {
    const it = { id: `p${this.nextId++}`, asset, x, z, dy: 0, yaw: Math.random() * Math.PI * 2, pitch: 0, roll: 0, s: 1, note: '', ...props };
    this.items.push(it);
    this.#changed();
    return it;
  }

  remove(id) {
    const i = this.items.findIndex((it) => it.id === id);
    if (i >= 0) { this.items.splice(i, 1); this.#changed(); }
  }

  get(id) { return this.items.find((it) => it.id === id) || null; }
  touch() { this.#changed(); }
  snapshot() { return JSON.stringify(this.toJSON()); }
  restore(s) { this.set(JSON.parse(s)); }

  /** World position of an entry (ground plus its offset). */
  pos(it, out = _p) {
    const a = this.byId.get(it.asset);
    return out.set(it.x, this.world.height(it.x, it.z) + it.dy - (a ? (SINK[a.kind === 'log' ? 'log' : ROCK_KINDS.includes(a.kind) ? 'rock' : 'tree']) : 0), it.z);
  }

  matrix(it, m = _m) {
    this.pos(it, _p);
    _q.setFromEuler(_e.set(it.pitch, it.yaw, it.roll, 'YXZ'));
    return m.compose(_p, _q, _s.setScalar(it.s));
  }

  /** The nearest entry the ray hits (a sphere round each), or null. */
  pick(ray, maxD = 3000) {
    let best = null, bd = maxD;
    for (const it of this.items) {
      const a = this.byId.get(it.asset);
      const c = this.pos(it, new THREE.Vector3()); c.y += a.h * it.s * 0.5;
      const rad = Math.max(a.h * 0.5, a.r) * it.s * (a.kind === 'spruce' || a.kind === 'fir' ? 0.45 : 0.7);
      const oc = c.clone().sub(ray.origin), t = oc.dot(ray.direction);
      if (t < 0 || t > bd) continue;
      const d2 = oc.lengthSq() - t * t;
      if (d2 > rad * rad) continue;
      bd = t - Math.sqrt(Math.max(0, rad * rad - d2));
      best = it;
    }
    return best;
  }

  /** Rebuild the instanced meshes for what is near the camera. */
  update(camera) {
    const moved = camera.position.distanceTo(this.at) > 40;
    if (!this.dirty && !moved) return;
    this.dirty = false;
    this.at.copy(camera.position);
    const lists = new Map();
    for (const it of this.items) {
      const a = this.byId.get(it.asset);
      const range = RANGE[ROCK_KINDS.includes(a.kind) || a.kind === 'log' ? 'rock' : 'tree'];
      if (Math.hypot(it.x - camera.position.x, it.z - camera.position.z) > range) continue;
      let l = lists.get(it.asset);
      if (!l) lists.set(it.asset, l = []);
      l.push(it);
    }
    let drawn = 0;
    for (const m of this.meshes.values()) m.count = 0;
    for (const [id, l] of lists) {
      let mesh = this.meshes.get(id);
      if (!mesh || mesh.instanceMatrix.count < l.length) {
        if (mesh) { this.group.remove(mesh); mesh.dispose(); }
        const a = this.byId.get(id);
        mesh = new THREE.InstancedMesh(a.geometry, a.material, Math.max(64, l.length * 2));
        mesh.setColorAt(0, new THREE.Color());
        mesh.frustumCulled = false;
        mesh.castShadow = a.kind !== 'willow'; mesh.receiveShadow = true;
        if (TREE_KINDS.includes(a.kind) && this.flora.depth) mesh.customDepthMaterial = this.flora.depth;
        this.group.add(mesh);
        this.meshes.set(id, mesh);
      }
      l.forEach((it, i) => {
        this.matrix(it, _m);
        mesh.setMatrixAt(i, _m);
        const v = 0.9 + ((parseInt(String(it.id).replace(/\D/g, ''), 10) * 0.618) % 1) * 0.2;
        mesh.setColorAt(i, _c.setRGB(v, v * 0.99, v * 0.96));
      });
      mesh.count = l.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      drawn += l.length;
    }
    this.drawn = drawn;
  }

  /** Push a circle out of the placed trunks and boulders. */
  push(p, r) {
    for (const [x, z, rad] of this.solids) {
      const dx = p.x - x, dz = p.z - z, rr = rad + r;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-3;
      p.x = x + (dx / d) * rr; p.z = z + (dz / d) * rr;
    }
  }

  #wrapCollide() {
    const f = this.flora, orig = f.collide.bind(f);
    f.collide = (p, r, feetY) => { const g = orig(p, r, feetY); if (this.solids.length) this.push(p, r); return g; };
  }
}
