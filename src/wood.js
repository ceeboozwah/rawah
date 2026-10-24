import * as THREE from 'three';
import { clamp } from './noise.js';
import { barkTexture } from './fire.js';
import { barkUV } from './trees.js';

// Firewood, from standing tree to the fire.
//
//  1. Face any tree and hold [X]: the axe bites into the foot of the trunk, chips
//     fly and a pale notch opens on your side. When it's through, the trunk creaks,
//     leans and goes over, away from you, with the real tree's own crown, and the
//     ground shakes when it lands.
//  2. The crown comes apart and the bare trunk is left lying along the slope. Hold
//     [X] beside it to saw it into fire-log lengths; each log flies to a neat
//     pyramid stack beside the trunk.
//  3. [R] at a stack takes an armful (up to a pack of sixteen); [R] at camp stacks
//     what you carry in a woodpile beside the tent. [F] at the fire feeds it a log
//     (from your pack, or the camp pile); lighting a new fire takes three.

const SWING = 0.62;                  // seconds per axe swing
const LOG_LEN = 0.5, LOG_R = 0.085;  // a fire log
const SEG = 0.55;                    // trunk is sawn in lengths of this
const R_USABLE = 0.09;               // thinner than this is kindling, left on the trunk
const HITS = { spruce: 9, lodgepole: 8, aspen: 5, snag: 5 };
const LAYERS = [6, 5, 4, 3, 2, 1];   // a pyramid
const PER_STACK = 21;
const PACK = 16;
const LOG_CAP = 700, PILE_CAP = 60;
const Y = new THREE.Vector3(0, 1, 0);
const BARK_OF = { spruce: 'spruce', lodgepole: 'pine', aspen: 'aspen', snag: 'snag' };   // which bark strip of the tree atlas each kind wears

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const ease = (u) => u * u * (3 - 2 * u);

/** Position of the k-th log of a pyramid stack. */
function slot(k, origin, dir, side, gy) {
  const st = Math.floor(k / PER_STACK);
  let i = k % PER_STACK, l = 0;
  while (i >= LAYERS[l]) { i -= LAYERS[l]; l++; }
  const lat = (i - (LAYERS[l] - 1) / 2) * (LOG_R * 2 + 0.006), along = st * (LOG_LEN + 0.25);
  return new THREE.Vector3(origin.x + side.x * lat + dir.x * along, gy + LOG_R + l * LOG_R * 1.74, origin.z + side.z * lat + dir.z * along);
}

/** A handful of particles thrown out and falling: chips, needles. */
class Burst {
  constructor(scene, color, size, cap = 80) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    for (let i = 0; i < cap; i++) this.pos[i * 3 + 1] = -9999;
  }

  emit(x, y, z, n, speed, up = 1.5, spread = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.cap;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = Math.cos(a) * v * spread; this.vel[i * 3 + 1] = up * (0.3 + Math.random()); this.vel[i * 3 + 2] = Math.sin(a) * v * spread;
      this.life[i] = 0.7 + Math.random() * 0.8;
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -9999;
      any = true;
    }
    if (any) this.pts.geometry.attributes.position.needsUpdate = true;
  }
}

export class Wood {
  constructor(world, flora, scene) {
    this.world = world;
    this.flora = flora;
    this.scene = scene;
    this.felledCount = 0;
    this.carried = 0;        // logs in your pack
    this.campCount = 0;      // logs in the woodpile at camp
    this.cutTotal = 0;       // logs you have ever made
    this.hint = '';
    this.events = [];
    this.fallers = [];
    this.trunks = [];
    this.ground = [];        // logs lying in stacks beside trunks
    this.flying = [];        // logs on their way to a stack
    this.dropStacks = [];    // stacks you made by dropping your pack
    this.session = null;     // the tree being chopped
    this.trunkFar = Infinity;
    this.swingT = 0; this.struck = false; this.axeShow = 0; this.mode = null;
    this.pile = null;        // { origin, dir, side, gy } the camp woodpile

    const bark = barkTexture();
    this.barkMat = new THREE.MeshLambertMaterial({ map: bark });
    this.cutMat = new THREE.MeshLambertMaterial({ color: 0xd2a96e });
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10);
    const inst = (cap) => {
      const m = new THREE.InstancedMesh(geo, [this.barkMat, this.cutMat, this.cutMat], cap);
      m.setColorAt(0, _c.setScalar(1));
      m.count = 0; m.frustumCulled = false; m.castShadow = m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    this.logs = inst(LOG_CAP);
    this.carry = inst(PACK);
    this.pileMesh = inst(PILE_CAP);

    // the axe
    this.axe = new THREE.Group();
    this.axe.rotation.order = 'YXZ';
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a6a46 }), steel = new THREE.MeshLambertMaterial({ color: 0x8e9499 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.85, 7), wood);
    handle.rotation.x = Math.PI / 2; handle.position.z = -0.42;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.2), steel);
    head.position.set(0, 0.04, -0.82);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.06), steel);
    blade.position.set(0, 0.03, -0.94);
    this.axe.add(handle, head, blade);
    this.axe.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.axe.visible = false;
    scene.add(this.axe);

    // the pale notch cut into the foot of the tree you are chopping
    this.notch = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xe9cf9c, emissive: 0x1a1208 }));
    this.notch.visible = false;
    scene.add(this.notch);

    this.chips = new Burst(scene, 0xe3c185, 0.075);
    this.leaves = new Burst(scene, 0x4f6b3a, 0.11, 160);
  }

  // ---------------------------------------------------------------- the camp woodpile
  /** Where the camp woodpile goes: beside the tent. */
  setCamp(tent) {
    if (!tent) { this.pile = null; this.#drawPile(); return; }
    const dir = new THREE.Vector3(Math.sin(tent.yaw), 0, Math.cos(tent.yaw)), side = new THREE.Vector3(Math.cos(tent.yaw), 0, -Math.sin(tent.yaw));
    const origin = new THREE.Vector3(tent.x + side.x * 2.4 + dir.x * 0.4, 0, tent.z + side.z * 2.4 + dir.z * 0.4);
    this.pile = { origin, dir, side, gy: this.world.height(origin.x, origin.z) };
    this.#drawPile();
  }

  pileDist(p) { return this.pile ? Math.hypot(this.pile.origin.x - p.x, this.pile.origin.z - p.z) : Infinity; }

  #drawPile() {
    const m = this.pileMesh;
    m.count = this.pile ? Math.min(this.campCount, PILE_CAP) : 0;
    if (!this.pile) { m.instanceMatrix.needsUpdate = true; return; }
    _q.setFromUnitVectors(Y, this.pile.dir);
    for (let k = 0; k < m.count; k++) {
      const at = slot(k, this.pile.origin, this.pile.dir, this.pile.side, this.pile.gy);
      m.setMatrixAt(k, _m.compose(at, _q, _s.set(LOG_R, LOG_LEN, LOG_R)));
      m.setColorAt(k, _c.setScalar(0.82 + ((k * 37) % 17) / 17 * 0.2));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the pack and the fire
  available(p) { return this.carried + (this.pileDist(p) < 10 ? this.campCount : 0); }

  /** Spend logs from the pack, then the camp pile (if you're at camp). False if there aren't enough. */
  consume(p, n = 1) {
    if (this.available(p) < n) return false;
    const fromPack = Math.min(this.carried, n);
    this.carried -= fromPack;
    this.campCount -= n - fromPack;
    this.#drawPile();
    return true;
  }

  // ---------------------------------------------------------------- trunks
  /** The point t metres along the trunk from its butt. */
  #at(trunk, t) { return trunk.base.clone().addScaledVector(trunk.axis, t); }
  #radius(trunk, t) { return trunk.r0 + (0.02 - trunk.r0) * (t / trunk.L); }

  /** The tree is down: it stays whole, crown and all, lying along its fall until you start sawing. */
  #makeTrunk(f, dir, group, theta, y0, settle) {
    const L = f.geo.boundingBox.max.y * f.s * 0.97, r0 = f.rad * 0.98;
    const useful = r0 > R_USABLE ? ((r0 - R_USABLE) / (r0 - 0.02)) * L : SEG;
    const n = Math.max(1, Math.floor(useful / SEG));
    const axis = new THREE.Vector3(dir.x * Math.sin(theta), Math.cos(theta), dir.z * Math.sin(theta)).normalize();
    const trunk = { dir: dir.clone(), L, r0, n, cutCount: 0, prog: 0, axis, base: new THREE.Vector3(f.x, y0, f.z), group, intact: true, mesh: null, stack: null, count: 0, bark: barkUV(BARK_OF[f.kind] || 'spruce'), settle };
    this.trunks.push(trunk);
    return trunk;
  }

  /** The bare trunk as one piece, from the cut end to the tip, wearing the tree's own bark. */
  #buildTrunkMesh(t) {
    if (t.mesh) { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; }
    const t0 = t.cutCount * SEG;
    if (t0 >= t.L - 0.05) return;
    const len = t.L - t0;
    const geo = new THREE.CylinderGeometry(this.#radius(t, t.L), this.#radius(t, t0), len, 8, 1);
    // the same strip of the same atlas as the standing tree, stretched once along the whole trunk: a cut leaves the bark where it was
    const [u0, v0, du, dv] = t.bark, tb = t0 / t.L, uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + du * uv.getX(i), v0 + dv * (tb + uv.getY(i) * (1 - tb)));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(uv.count * 3).fill(0.9), 3));
    const mesh = new THREE.Mesh(geo, [this.flora.foliage, this.cutMat, this.cutMat]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.copy(this.#at(t, t0 + len / 2));
    mesh.quaternion.setFromUnitVectors(Y, t.axis);
    this.scene.add(mesh);
    t.mesh = mesh;
  }

  // ---------------------------------------------------------------- lying on the ground
  /** Ground heights along the line a tree falls: at horizontal distances 0..L. */
  #profile(x, z, dir, L, n = 60) {
    const d = [], g = [];
    for (let i = 0; i <= n; i++) {
      const t = (L * i) / n;
      d.push(t); g.push(this.world.height(x + dir.x * t, z + dir.z * t));
    }
    return { d, g };
  }

  /** Underside clearance the trunk needs `s` metres along it. */
  #under(rad, s, L) { return (rad * (1 - s / L) + 0.02) * 0.9; }

  /** The angle above horizontal at which a tree hinged on its stump first touches the ground as it falls. */
  #contact(f, dir, L, y0) {
    const { d, g } = this.#profile(f.x, f.z, dir, L);
    for (let deg = 89; deg > 0; deg -= 0.4) {
      const phi = (deg * Math.PI) / 180, c = Math.cos(phi), tn = Math.tan(phi), reach = L * c;
      for (let i = 0; i < d.length; i++) {
        if (d[i] > reach) break;
        if (y0 + tn * d[i] < g[i] + this.#under(f.rad, d[i] / c, L)) return phi;
      }
    }
    return 0.05;
  }

  /**
   * Where a rigid trunk comes to rest on uneven ground: on the highest points under it. Its underside
   * must clear every bump along its length, and it settles on the two supports either side of its
   * centre of mass, so it bridges dips and follows the slope like a real log.
   */
  #rest(f, dir, L) {
    const { d, g } = this.#profile(f.x, f.z, dir, L);
    let phi = 0, base = g[0];
    for (let pass = 0; pass < 4; pass++) {
      const c = Math.cos(phi), reach = L * c, hull = [];
      for (let i = 0; i < d.length; i++) {
        if (d[i] > reach) break;
        const p = [d[i], g[i] + this.#under(f.rad, d[i] / c, L)];
        while (hull.length >= 2) {
          const a = hull[hull.length - 2], b = hull[hull.length - 1];
          if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0) hull.pop(); else break;
        }
        hull.push(p);
      }
      if (hull.length < 2) break;
      const dcm = reach * 0.45;
      let k = 0;
      while (k < hull.length - 2 && hull[k + 1][0] < dcm) k++;
      const a = hull[k], b = hull[k + 1], m = (b[1] - a[1]) / (b[0] - a[0]);
      phi = Math.atan(m);
      base = a[1] - m * a[0];
    }
    return { phi, y0: base + f.rad * 0.05 };
  }

  /** The first cut: the branches come off, leaving the trunk. */
  #limb(t) {
    t.intact = false;
    if (t.group) { this.scene.remove(t.group); t.group = null; }
    const c = this.#at(t, t.L * 0.62);
    this.leaves.emit(c.x, c.y + 0.4, c.z, 90, 3, 3, 1.6);
    this.chips.emit(c.x, c.y, c.z, 20, 2.2, 2, 1.4);
    this.#buildTrunkMesh(t);
    this.#toast('Branches off. Keep sawing from the thick end: each cut makes a log.');
  }

  #drawGround() {
    const m = this.logs;
    let k = 0;
    for (const l of this.ground) {
      if (l.taken || k >= LOG_CAP) continue;
      m.setMatrixAt(k, _m.compose(l.pos, l.q, _s.set(LOG_R, LOG_LEN, LOG_R)));
      m.setColorAt(k, _c.setScalar(l.shade));
      k++;
    }
    for (const f of this.flying) {
      if (k >= LOG_CAP) break;
      m.setMatrixAt(k, _m.compose(f.cur, f.curQ, _s.set(LOG_R, LOG_LEN, LOG_R)));
      m.setColorAt(k, _c.setScalar(f.log.shade));
      k++;
    }
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** The fallen trunk whose cut end is within the saw's reach. */
  #trunkNear(p) {
    let best = null, bd = 2.6, far = Infinity;
    for (const t of this.trunks) {
      if (t.cutCount >= t.n || t.settle) continue;
      const mid = this.#at(t, (t.cutCount + 0.5) * SEG);
      const d = Math.hypot(mid.x - p.x, mid.z - p.z) - this.#radius(t, (t.cutCount + 0.5) * SEG);
      far = Math.min(far, d);
      if (d < bd) { bd = d; best = { t }; }
    }
    this.trunkFar = far;
    return best;
  }

  /** The butt-most length of the trunk comes off as a log and flies to the stack. */
  #cutSegment(t, view) {
    const i = t.cutCount;
    t.cutCount++; t.prog = 0;
    this.cutTotal++;
    const mid = this.#at(t, (i + 0.5) * SEG);
    if (!t.stack) {
      // the stack goes beside the thick end, on your side of the trunk
      const sx = -t.dir.z, sz = t.dir.x;
      const sign = Math.sign((view.pos.x - mid.x) * sx + (view.pos.z - mid.z) * sz) || 1;
      const o = this.#at(t, 1.4);
      const origin = new THREE.Vector3(o.x + sx * sign * 1.5, 0, o.z + sz * sign * 1.5);
      t.stack = { origin, side: new THREE.Vector3(sx, 0, sz), gy: this.world.height(origin.x, origin.z) };
    }
    const to = slot(t.count++, t.stack.origin, t.dir, t.stack.side, t.stack.gy);
    const log = { pos: to, q: new THREE.Quaternion().setFromUnitVectors(Y, t.dir), taken: false, shade: 0.8 + Math.random() * 0.22 };
    const q0 = new THREE.Quaternion().setFromUnitVectors(Y, t.axis);
    this.flying.push({ log, from: mid.clone(), q0, t: 0, dur: 0.55, cur: mid.clone(), curQ: q0.clone() });
    this.#buildTrunkMesh(t);
    this.chips.emit(mid.x, mid.y + 0.1, mid.z, 8, 1.6);
    this.#sound('saw');
  }

  // ---------------------------------------------------------------- felling
  #startFall(ref, view) {
    const f = this.flora.fell(ref);
    if (!f) return;
    const dx = ref.x - view.pos.x, dz = ref.z - view.pos.z, d = Math.hypot(dx, dz) || 1;
    const dir = new THREE.Vector3(dx / d, 0, dz / d);
    const mesh = new THREE.Mesh(f.geo, this.flora.foliage);
    mesh.rotation.y = f.rot; mesh.scale.setScalar(f.s); mesh.castShadow = true;
    const group = new THREE.Group();
    group.position.set(f.x, f.e, f.z);
    group.add(mesh);
    this.scene.add(group);
    const L = f.geo.boundingBox.max.y * f.s;
    const y0 = this.world.height(f.x, f.z) + f.rad * 0.95;
    const phiC = this.#contact(f, dir, L, y0);
    this.fallers.push({ group, dir, f, L, t: 0, theta: 0.02, omega: 0, max: Math.max(0.25, Math.PI / 2 - phiC), y0, called: false });
    this.felledCount++;
    this.session = null; this.notch.visible = false;
    this.#sound('creak');
    this.#toast('It\'s going…');
  }

  #land(fl) {
    // it hits the ground where the crown first touches...
    fl.group.position.y = fl.y0;
    _p.set(fl.dir.z, 0, -fl.dir.x);
    fl.group.quaternion.setFromAxisAngle(_p, fl.max);
    // ...and then settles onto the high spots under it, wherever the ground is uneven
    const rest = this.#rest(fl.f, fl.dir, fl.L);
    const th1 = Math.PI / 2 - rest.phi;
    const c = _p.set(fl.f.x + fl.dir.x * fl.L * 0.7, 0, fl.f.z + fl.dir.z * fl.L * 0.7);
    c.y = this.world.height(c.x, c.z) + 0.5;
    this.leaves.emit(c.x, c.y, c.z, 45, 2.4, 2.5, 1.3);
    this.chips.emit(fl.f.x + fl.dir.x * fl.L * 0.4, c.y, fl.f.z + fl.dir.z * fl.L * 0.4, 8, 1.8, 2, 1);
    this.#makeTrunk(fl.f, fl.dir, fl.group, th1, rest.y0, { t: 0, dur: 0.9, th0: fl.max, th1, y0: fl.y0, y1: rest.y0 });
    this.#sound('crash');
    this.#toast('Timber! Go to the thick end and hold [X] to saw it up.');
    this.events.push({ type: 'shake', amount: clamp(fl.L / 14, 0.4, 1.2), x: fl.f.x, z: fl.f.z });
  }

  #toast(text, warn = false) { this.events.push({ type: 'toast', text, warn }); }
  #sound(name) { this.events.push({ type: 'sound', name }); }

  // ---------------------------------------------------------------- taking logs
  /** Distance to the nearest log lying in a stack (for choosing what [R] does). */
  stackDist(p) {
    let bd = Infinity;
    for (const l of this.ground) if (!l.taken) bd = Math.min(bd, Math.hypot(l.pos.x - p.x, l.pos.z - p.z));
    return bd;
  }

  /** [R] at a stack, or at the camp pile: take an armful, or put your armful down. Returns what it did. */
  interact(p) {
    const room = PACK - this.carried;
    const dPile = this.pileDist(p), dStack = this.stackDist(p);
    if (dPile < 3.2 && (dPile <= dStack) && (this.carried > 0 || this.campCount > 0)) {
      if (this.carried > 0) {
        const n = Math.min(this.carried, PILE_CAP - this.campCount);
        if (n <= 0) { this.#toast('The woodpile is full.'); return 'full'; }
        this.carried -= n; this.campCount += n;
        this.#drawPile(); this.#sound('clunk');
        this.#toast(`Stacked ${n} log${n > 1 ? 's' : ''} by the tent · ${this.campCount} in the pile`);
        return 'stacked';
      }
      const n = Math.min(4, this.campCount, room);
      this.campCount -= n; this.carried += n;
      this.#drawPile(); this.#sound('clunk');
      this.#toast(`Took ${n} from the pile · carrying ${this.carried}`);
      return 'took';
    }
    if (dStack < 3.0) {
      if (room <= 0) { this.#toast('Your pack is full. Stack them at camp: [R] at the woodpile.', true); return 'full'; }
      // the top of the stack nearest you first
      const near = this.ground.filter((l) => !l.taken && Math.hypot(l.pos.x - p.x, l.pos.z - p.z) < 3.0)
        .sort((a, b) => (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - a.pos.y * 0.5) - (Math.hypot(b.pos.x - p.x, b.pos.z - p.z) - b.pos.y * 0.5));
      const n = Math.min(4, room, near.length);
      for (let i = 0; i < n; i++) near[i].taken = true;
      this.carried += n;
      this.#drawGround(); this.#sound('clunk');
      this.#toast(`Took ${n} log${n > 1 ? 's' : ''} · carrying ${this.carried} · [B] to drop them`);
      return 'took';
    }
    return null;
  }

  // ---------------------------------------------------------------- per frame
  /** view: { pos, yaw }, ctl: { chop: X held, free: nothing else has your hands }. Returns events. */
  update(dt, view, ctl) {
    this.events.length = 0;
    this.chips.update(dt);
    this.leaves.update(dt);

    // trees coming down
    for (let i = this.fallers.length - 1; i >= 0; i--) {
      const fl = this.fallers[i];
      fl.t += dt;
      if (fl.t < 1.0) fl.theta = 0.02 + 0.03 * (fl.t / 1.0) ** 2;          // the trunk groans and starts to lean
      else {
        if (!fl.called) { fl.called = true; this.#toast('Timber!'); }
        fl.omega += (2.6 + 8 / Math.max(fl.L, 5)) * (Math.sin(fl.theta) + 0.18) * dt * 1.6;
        fl.theta += fl.omega * dt;
      }
      _p.set(fl.dir.z, 0, -fl.dir.x);
      fl.group.quaternion.setFromAxisAngle(_p, Math.min(fl.theta, fl.max));
      fl.group.position.y = fl.f.e + (0.15 + fl.f.rad * 0.95) * Math.pow(Math.min(1, fl.theta / fl.max), 3);   // settles onto its own thickness
      if (fl.theta >= fl.max) { this.#land(fl); this.fallers.splice(i, 1); }
    }

    // a landed tree settling onto its supports
    for (const t of this.trunks) {
      const S = t.settle;
      if (!S || !t.group) { t.settle = null; continue; }
      S.t += dt;
      const e = ease(clamp(S.t / S.dur, 0, 1));
      t.group.quaternion.setFromAxisAngle(_p.set(t.dir.z, 0, -t.dir.x), S.th0 + (S.th1 - S.th0) * e);
      t.group.position.y = S.y0 + (S.y1 - S.y0) * e;
      if (S.t >= S.dur) { t.settle = null; this.#sound('clunk'); }
    }

    // logs flying to their stack
    if (this.flying.length) {
      for (let i = this.flying.length - 1; i >= 0; i--) {
        const f = this.flying[i];
        f.t += dt;
        if (f.t < 0) { f.cur.copy(f.from); continue; }
        const u = clamp(f.t / f.dur, 0, 1), e = ease(u);
        f.cur.lerpVectors(f.from, f.log.pos, e); f.cur.y += Math.sin(Math.PI * u) * 0.7;
        f.curQ.slerpQuaternions(f.q0, f.log.q, e);
        if (u >= 1) { this.ground.push(f.log); this.flying.splice(i, 1); this.#sound('clunk'); }
      }
      this.#drawGround();
    }

    // working: chop a tree or saw a trunk
    const held = ctl.chop && ctl.free;
    this.working = false;
    const tree = ctl.free ? this.flora.treeAt(view.pos, view.yaw) : null;
    const trunk = ctl.free && !tree ? this.#trunkNear(view.pos) : (this.trunkFar = Infinity, null);
    this.mode = tree ? 'tree' : trunk ? 'saw' : null;
    if (held && this.mode) { this.axeShow = 2.2; this.working = true; }
    this.axeShow = Math.max(0, this.axeShow - dt);
    if ((held && this.mode) || this.swingT > 0) {
      this.swingT += dt;
      const ph = this.swingT / SWING;
      if (!this.struck && ph >= 0.46) { this.struck = true; this.#strike(view, tree, trunk); }
      if (ph >= 1) { this.swingT = held && this.mode ? 0.0001 : 0; this.struck = false; }
    }
    this.#pose(view, tree);
    this.#carryBundle(view, ctl);

    // what to tell you: a stack or the woodpile within reach comes first, unless you are mid-swing
    const dPile = this.pileDist(view.pos), dStack = this.stackDist(view.pos);
    let near = '';
    if (dPile < 3.2 && this.carried > 0) near = `[R] stack your ${this.carried} log${this.carried > 1 ? 's' : ''} in the woodpile`;
    else if (dPile < 3.2 && this.campCount > 0) near = `[R] take firewood from the pile (${this.campCount})`;
    else if (dStack < 3.0) near = `[R] take firewood (carrying ${this.carried}/${PACK})`;
    if (this.fallers.length) this.hint = '';
    else if (held && this.mode === 'tree') this.hint = 'Chopping…  keep holding [X]';
    else if (held && this.mode === 'saw') this.hint = 'Sawing…  keep holding [X]';
    else if (near) this.hint = near;
    else if (this.mode === 'tree') this.hint = this.felledCount < 2 ? 'Hold [X] to chop this tree down' : '';
    else if (this.mode === 'saw') this.hint = this.trunks.some((t) => t.intact && t.cutCount === 0) ? 'Hold [X] to saw off the branches and cut it into firewood' : 'Hold [X] to saw firewood off the end';
    else if (this.trunkFar < 9) this.hint = 'Step along to the cut end of the trunk to keep sawing';
    else this.hint = '';
    return this.events;
  }

  /** One axe stroke has landed. */
  #strike(view, tree, trunk) {
    this.#sound('chop');
    if (tree) {
      const key = `${tree.x},${tree.z}`;
      if (!this.session || this.session.key !== key) this.session = { key, hits: 0, need: Math.round(HITS[tree.kind] * (0.7 + 0.5 * tree.s)), ref: tree };
      const S = this.session;
      S.ref = tree;
      S.hits++;
      const dx = view.pos.x - tree.x, dz = view.pos.z - tree.z, d = Math.hypot(dx, dz) || 1;
      this.chips.emit(tree.x + (dx / d) * 0.25, tree.e + 0.7, tree.z + (dz / d) * 0.25, 9, 1.8);
      if (S.hits >= S.need) this.#startFall(tree, view);
    } else if (trunk) {
      const t = trunk.t;
      if (t.intact) this.#limb(t);
      t.prog++;
      const m = this.#at(t, (t.cutCount + 0.5) * SEG);
      this.chips.emit(m.x, m.y + 0.1, m.z, 4, 1.2);
      if (t.prog >= 2) this.#cutSegment(t, view);
    }
  }

  #pose(view, tree) {
    const a = this.axe;
    const active = this.axeShow > 0 || this.swingT > 0;
    a.visible = active;
    // the notch grows with the cuts
    const S = this.session;
    const showNotch = S && tree && `${tree.x},${tree.z}` === S.key && S.hits > 0;
    this.notch.visible = !!showNotch;
    if (showNotch) {
      const dx = view.pos.x - tree.x, dz = view.pos.z - tree.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
      const prog = S.hits / S.need, rad = Math.max(0.12, 0.26 * tree.s);
      this.notch.position.set(tree.x + ux * rad * 0.95, tree.e + 0.55, tree.z + uz * rad * 0.95);
      this.notch.rotation.set(0, Math.atan2(ux, uz), 0);
      this.notch.scale.set(0.12 + 0.34 * prog * (rad / 0.26), 0.1 + 0.2 * prog, 0.07 + 0.1 * prog);
    }
    if (!active) return;
    const sy = Math.sin(view.yaw), cy = Math.cos(view.yaw);
    a.position.set(view.pos.x + cy * 0.26 - sy * 0.3, view.pos.y + 1.0, view.pos.z - sy * 0.26 - cy * 0.3);
    const ph = this.swingT / SWING;
    const th = ph <= 0 ? 0.55 : ph < 0.46 ? 0.55 + ease(ph / 0.46) * 0.8 : ph < 0.6 ? 1.35 - ease((ph - 0.46) / 0.14) * 1.85 : -0.5 + ease((ph - 0.6) / 0.4) * 1.05;
    a.rotation.set(th, view.yaw, 0);
  }

  /** The armful you are carrying: across your chest from outside, or low in front of you in first person. */
  #carryBundle(view, ctl) {
    const m = this.carry, n = ctl.carryVisible === false ? 0 : Math.min(this.carried, PACK);
    m.count = n;
    if (!n) return;
    const yaw = ctl.first ? view.yaw : (ctl.heading ?? view.yaw);     // the body faces where it walks, the camera where you look
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const rx = cy, rz = -sy, fx = -sy, fz = -cy;
    const h = ctl.first ? 1.2 : 1.1, ahead = ctl.first ? 0.5 : 0.34, across = ctl.first ? 0.06 : 0;
    _q.setFromUnitVectors(Y, _p.set(rx, 0, rz));       // logs lie across you
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 4), col = i % 4;
      const at = new THREE.Vector3(view.pos.x + fx * ahead + rx * across, view.pos.y + h + row * 0.075, view.pos.z + fz * ahead + rz * across);
      at.x += fx * (col - 1.5) * 0.07; at.z += fz * (col - 1.5) * 0.07;
      m.setMatrixAt(i, _m.compose(at, _q, _s.set(0.034, LOG_LEN * 0.9, 0.034)));
      m.setColorAt(i, _c.setScalar(0.85));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Put what you are carrying down in a neat stack in front of you. */
  drop(view, heading) {
    if (this.carried <= 0) { this.#toast('You are not carrying any firewood.'); return false; }
    const yaw = heading ?? view.yaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    const spot = new THREE.Vector3(view.pos.x + fx * 1.3, 0, view.pos.z + fz * 1.3);
    // add to a stack you already started here, if there is one
    let st = this.dropStacks.find((d) => Math.hypot(d.origin.x - spot.x, d.origin.z - spot.z) < 1.4 && d.count < PER_STACK * 2 - this.carried);
    if (!st) {
      st = { origin: spot, dir: new THREE.Vector3(rx, 0, rz), side: new THREE.Vector3(fx, 0, fz), gy: this.world.height(spot.x, spot.z), count: 0 };
      this.dropStacks.push(st);
    }
    const n = this.carried, q = new THREE.Quaternion().setFromUnitVectors(Y, st.dir);
    for (let i = 0; i < n; i++) {
      const to = slot(st.count++, st.origin, st.dir, st.side, st.gy);
      const log = { pos: to, q: q.clone(), taken: false, shade: 0.8 + Math.random() * 0.22 };
      const from = new THREE.Vector3(view.pos.x + fx * 0.4, view.pos.y + 1.0 + (i % 4) * 0.05, view.pos.z + fz * 0.4);
      this.flying.push({ log, from, q0: q.clone(), t: -i * 0.04, dur: 0.5, cur: from.clone(), curQ: q.clone() });
    }
    this.carried = 0;
    this.#sound('clunk');
    this.#toast(`Dropped ${n} log${n > 1 ? 's' : ''} in a stack. [R] picks them up again.`);
    return true;
  }

  /** Striking camp: the woodpile goes into your pack as far as it fits. */
  packUpCamp() {
    const n = Math.min(this.campCount, PACK - this.carried);
    this.carried += n; this.campCount = 0;
    this.setCamp(null);
    return n;
  }

  /** Bare ground for the grass to stay off: a strip a foot wide either side of the fallen trunk, and under its stack. */
  clearings(p) {
    let best = null, bd = 80;
    for (const t of this.trunks) {
      const d = Math.hypot(t.base.x - p.x, t.base.z - p.z);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return [];
    const t = best, out = [[t.base.x, t.base.z, t.base.x + t.axis.x * t.L, t.base.z + t.axis.z * t.L, t.r0 + 0.32]];
    if (t.stack) out.push([t.stack.origin.x, t.stack.origin.z, 1.1]);
    return out;
  }

  save() { return { carried: this.carried, camp: this.campCount, cut: this.cutTotal, felled: this.flora.felledList() }; }
  load(s) {
    if (!s) return;
    this.carried = s.carried || 0; this.campCount = s.camp || 0; this.cutTotal = s.cut || 0;
    this.flora.applyFelled(s.felled);
    this.#drawPile();
  }
}
