import * as THREE from 'three';

// The canteen and the water filter: the two things you carry to stay hydrated, built in code, and what you do with them.
//
//  CANTEEN  a one-quart (0.95 L) stainless steel canteen with a canvas cover, a black screw cap on a chain and a sling loop,
//           the shape every hiker knows. [Y] takes a few swallows from it. It holds raw or clean water; topping a clean
//           canteen up from a stream makes all of it raw.
//  FILL     facing a lake or stream within reach, [U] kneels and dunks it (about 0.2 L/s). The water is raw: it carries a
//           risk of infection per litre (lake water more than a fast stream, and more the siltier it is: the water boxels'
//           turbidity at the spot, which your own dunking stirs up).
//  FILTER   a pump filter (a ceramic element behind a pump handle, intake hose with a float and strainer, output hose). With raw
//           water in the canteen and nothing else to do, [U] sets the canteen on the ground, runs the intake hose into it
//           and pumps the water through the ceramic into a clean cup, which is poured back into the canteen: about 1 L a
//           minute when the element is clean, slowing as silt clogs it (turbid water clogs it five times faster). A clogged element
//           can be scrubbed (hold still and press [U] with nothing left to filter), which wears it a little. A 0.2 micron
//           ceramic removes protozoa and bacteria but not viruses, so filtered water keeps a tiny residual risk (viruses are
//           rare in the backcountry); boiling would be the full fix.
//
// Keep your hands busy to be thirsty: moving cancels a fill or a pump (what was done stays done).

export const CANTEEN_L = 0.95;
const PROP = 1.35;                        // props on the ground are drawn a third larger than life so they read from a few metres away
const SIP_L = 0.18;                       // a few swallows
const FILL_LS = 0.21;                     // litres a second dunking a narrow-necked canteen
const PUMP_LMIN = 1.0;                    // litres a minute through a clean ceramic element
const RISK = { lake: 0.34, stream: 0.17, clean: 0.002 };   // chance of infection per litre drunk: raw lake, raw stream, filtered (viruses)

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ the models

function mats() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0xb4b9be, metalness: 0.4, roughness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x7e848a, metalness: 0.45, roughness: 0.5 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x5d6446, metalness: 0, roughness: 0.96 }),
    stitch: new THREE.MeshStandardMaterial({ color: 0x3f442f, metalness: 0, roughness: 1 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, metalness: 0, roughness: 0.62 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2f6c9c, metalness: 0, roughness: 0.5 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xe9dfcc, metalness: 0, roughness: 0.9 }),
    hose: new THREE.MeshStandardMaterial({ color: 0xcfe4ec, metalness: 0, roughness: 0.25, transparent: true, opacity: 0.55 }),
    silicone: new THREE.MeshStandardMaterial({ color: 0x2d5f86, metalness: 0, roughness: 0.4 }),
    foam: new THREE.MeshStandardMaterial({ color: 0xe0b83a, metalness: 0, roughness: 0.8 }),
    mesh: new THREE.MeshStandardMaterial({ color: 0x23272b, metalness: 0.2, roughness: 0.7 }),
    water: new THREE.MeshStandardMaterial({ color: 0x9fc6d6, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.8 }),
  };
}

const lathe = (pts, seg = 32) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

/** A 1-quart stainless canteen, 0.22 m tall, standing on y = 0 (flat sides face +-z), canvas cover, cap on a chain. */
export function buildCanteen() {
  const m = mats(), g = new THREE.Group();
  const add = (geo, mat, y = 0, sz = 1) => { const o = new THREE.Mesh(geo, mat); o.position.y = y; o.scale.z = sz; o.castShadow = true; g.add(o); return o; };
  const body = lathe([[0, 0], [0.05, 0], [0.066, 0.006], [0.072, 0.022], [0.0735, 0.05], [0.0735, 0.13], [0.07, 0.158], [0.056, 0.178], [0.034, 0.192], [0.02, 0.198], [0.0165, 0.206], [0.0165, 0.222]]);
  add(body, m.steel, 0, 0.47);
  // the crimped seam round the middle, and a rolled foot rim
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.0738, 0.0032, 8, 40), m.dark);
  seam.rotation.x = Math.PI / 2; seam.position.y = 0.092; seam.scale.set(1, 0.47, 1);
  seam.scale.set(1, 1, 1);
  g.add(seam);
  seam.scale.y = 0.47; seam.scale.x = 1; seam.scale.z = 1;
  // the olive canvas cover, open at the shoulder, with its stitched seam up each narrow side
  const cover = lathe([[0.001, 0.003], [0.05, 0.003], [0.069, 0.009], [0.0765, 0.024], [0.0775, 0.05], [0.0775, 0.128], [0.0745, 0.15], [0.0705, 0.162]]);
  add(cover, m.canvas, 0, 0.5);
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.152, 0.006), m.stitch);
    s.position.set(sx * 0.0775, 0.084, 0); g.add(s);
  }
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.0715, 0.0024, 6, 40), m.stitch);
  hem.rotation.x = Math.PI / 2; hem.position.y = 0.162; hem.scale.set(1, 1, 1); hem.scale.y = 0.5; g.add(hem);
  // cap: black, knurled, with a gasket under it
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 0.028, 28), m.plastic);
  cap.position.y = 0.236; cap.castShadow = true; g.add(cap);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.026, 0.004), m.plastic);
    r.position.set(Math.cos(a) * 0.0232, 0.236, Math.sin(a) * 0.0232); r.rotation.y = -a; g.add(r);
  }
  const gasket = new THREE.Mesh(new THREE.CylinderGeometry(0.0185, 0.0185, 0.005, 20), m.dark);
  gasket.position.y = 0.221; g.add(gasket);
  // the chain from the cap to the neck: a few links
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0011, 6, 12), m.steel);
    l.position.set(0.022 + i * 0.0035, 0.222 - i * 0.004, 0.0); l.rotation.set(i % 2 ? 0 : Math.PI / 2, 0, 0); g.add(l);
  }
  // the sling loop at the shoulder
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0028, 8, 18), m.dark);
  loop.position.set(0.0, 0.205, 0.03); loop.rotation.y = Math.PI / 2; g.add(loop);
  g.position.y = -0.11;
  const root = new THREE.Group(); root.add(g);
  root.userData.mouth = new THREE.Vector3(0, 0.124, 0);          // where the cap sits, in the root's frame
  return root;
}

/** A pump water filter: housing, ceramic element, pump handle that slides, intake hose with float and strainer, output hose. */
export function buildFilter() {
  const m = mats(), g = new THREE.Group();
  const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  // the ceramic element under a blue-grey housing
  add(new THREE.CylinderGeometry(0.0235, 0.0235, 0.056, 28), m.ceramic, 0, 0.028, 0);
  add(new THREE.CylinderGeometry(0.0255, 0.0255, 0.006, 28), m.silicone, 0, 0.058, 0);
  add(new THREE.CylinderGeometry(0.031, 0.031, 0.118, 32), m.blue, 0, 0.12, 0);
  for (const y of [0.075, 0.165]) add(new THREE.CylinderGeometry(0.0325, 0.0325, 0.006, 32), m.plastic, 0, y, 0);
  add(new THREE.CylinderGeometry(0.0335, 0.031, 0.02, 32), m.plastic, 0, 0.19, 0);       // top cap
  // ports: intake low on one side, output on the other
  const port = (side, y) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.03, 12), m.plastic);
    p.rotation.z = Math.PI / 2; p.position.set(side * 0.04, y, 0); g.add(p);
    return new THREE.Vector3(side * 0.056, y, 0);
  };
  const intakePort = port(-1, 0.1), outPort = port(1, 0.1);
  // the pump handle: a shaft that slides through the cap, with a T grip
  const handle = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.15, 12), m.steel); shaft.position.y = 0.075; handle.add(shaft);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.016, 0.018), m.plastic); grip.position.y = 0.158; grip.castShadow = true; handle.add(grip);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 10, 8), m.plastic); e.position.set(sx * 0.0425, 0.158, 0); handle.add(e); }
  handle.position.y = 0.2;
  g.add(handle);
  g.userData.handle = handle;
  g.userData.intakePort = intakePort;
  g.userData.outPort = outPort;
  g.userData.hoses = new THREE.Group();
  g.add(g.userData.hoses);
  return g;
}

function hose(points, radius, mat) {
  const curve = new THREE.CatmullRomCurve3(points);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, radius, 8, false), mat);
  mesh.castShadow = true;
  return mesh;
}

/** The intake float and strainer on the end of the intake hose. */
function strainer(m) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.04, 12), m.mesh); s.rotation.z = Math.PI / 2; g.add(s);
  const f = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.024, 14), m.foam); f.rotation.z = Math.PI / 2; f.position.x = 0.03; g.add(f);
  return g;
}

/** A stainless cup (the clean side), with water you can raise and lower. */
function buildCup(m) {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.039, 0.075, 28, 1, true), m.steel); wall.position.y = 0.0375; wall.material = wall.material.clone(); wall.material.side = THREE.DoubleSide; wall.castShadow = true; g.add(wall);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.003, 24), m.dark); base.position.y = 0.0015; g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.0023, 8, 28), m.dark); rim.rotation.x = Math.PI / 2; rim.position.y = 0.075; g.add(rim);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0028, 8, 16, Math.PI), m.dark); handle.position.set(0.047, 0.04, 0); handle.rotation.set(0, 0, -Math.PI / 2); g.add(handle);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.0395, 0.002, 24), m.water); water.position.y = 0.006; g.add(water);
  g.userData.water = water;
  return g;
}

// ------------------------------------------------------------------ what you carry and do

export class Gear {
  constructor({ scene, camera, avatar, world }) {
    this.scene = scene; this.camera = camera; this.avatar = avatar; this.world = world;
    this.m = mats();
    this.reset();
    // held: first person hangs off the camera (beyond the near plane), third person sits in the hand
    this.held = buildCanteen();
    this.heldFp = buildCanteen();
    this.heldFp.visible = false;
    camera.add(this.heldFp);
    // the station: what you set on the ground to fill and filter
    this.station = new THREE.Group();
    this.station.visible = false;
    this.groundCanteen = buildCanteen();
    this.filterObj = buildFilter();
    this.cup = buildCup(this.m);
    this.strainer = strainer(this.m);
    this.station.add(this.groundCanteen, this.filterObj, this.cup, this.strainer);
    scene.add(this.station);
    this.act = null;
    this.events = [];
    this.lastSips = 0;
    this.pumped = 0;
  }

  reset() {
    this.canteen = { water: CANTEEN_L, clean: true, turb: 0, risk: RISK.clean, from: 'home' };
    this.filter = { owned: true, clog: 0.05, litres: 0, scrubs: 0 };
    this.act = null;
    this.warnedRaw = false;
  }

  /** Ground the grass should leave bare: the station while it is set out. */
  clearings() { return this.station.visible && this.act?.bx !== undefined ? [[this.act.bx, this.act.bz, 0.85]] : (this.station.visible && this.act?.target ? [[this.act.target.x, this.act.target.z, 0.6]] : []); }

  get busy() { return !!this.act && this.act.kind !== 'drink'; }
  get drinking() { return this.act?.kind === 'drink'; }

  save() { return { c: { w: +this.canteen.water.toFixed(3), cl: this.canteen.clean, t: +this.canteen.turb.toFixed(2), r: this.canteen.risk, f: this.canteen.from }, f: { o: this.filter.owned, k: +this.filter.clog.toFixed(3), l: +this.filter.litres.toFixed(1), s: this.filter.scrubs } }; }
  load(s) {
    this.reset();
    if (!s) return;
    if (s.c) this.canteen = { water: s.c.w, clean: s.c.cl, turb: s.c.t || 0, risk: s.c.r ?? RISK.clean, from: s.c.f || 'home' };
    if (s.f) this.filter = { owned: s.f.o !== false, clog: s.f.k ?? 0.05, litres: s.f.l || 0, scrubs: s.f.s || 0 };
  }

  /** Water within reach ahead of (or under) the player: { x, z, kind: 'lake' | 'stream', level }, or null. */
  findWater(p, yaw, waterAt, lakeAt, level) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const d of [0, 0.7, 1.2, 1.7, 2.2, 2.7]) {
      for (const turn of d === 0 ? [0] : [0, 0.45, -0.45]) {
        const c = Math.cos(turn), s = Math.sin(turn);
        const x = p.x + (fx * c - fz * s) * d, z = p.z + (fx * s + fz * c) * d;
        if (waterAt(x, z)) { const lk = lakeAt(x, z); return { x, z, kind: lk ? 'lake' : 'stream', level: level(x, z) }; }
      }
    }
    return null;
  }

  // ---- actions (each returns a reason string if it cannot start)
  drink() {
    if (this.act) return this.act.kind === 'drink' ? 'busy' : 'busy';
    if (this.canteen.water <= 0.005) return 'Your canteen is empty. Fill it at a stream or a lake.';
    this.act = { kind: 'drink', t: 0, dur: 1.7, took: false };
    return null;
  }

  fill(target) {
    if (this.act) return 'busy';
    if (this.canteen.water >= CANTEEN_L - 0.02) return 'The canteen is full.';
    this.act = { kind: 'fill', t: 0, target, from: this.canteen.water, noted: false, stir: 0 };
    return null;
  }

  pump() {
    if (this.act) return 'busy';
    if (!this.filter.owned) return 'You have no filter.';
    if (this.canteen.clean || this.canteen.water < 0.02) return 'Nothing to filter.';
    if (this.filter.clog > 0.97) return 'The filter is clogged solid. Scrub the element first.';
    this.act = { kind: 'pump', t: 0, done: 0, batch: 0, pour: 0, phase: 0 };
    return null;
  }

  scrub() {
    if (this.act) return 'busy';
    if (this.filter.clog < 0.2) return 'The element is clean.';
    this.act = { kind: 'scrub', t: 0, dur: 6 };
    return null;
  }

  cancel() {
    if (!this.act || this.act.kind === 'drink') return;
    const a = this.act;
    if (a.kind === 'pump' && this.pumped > 0) this.#finishPump(a);
    this.act = null;
    this.#hide();
  }

  // ---- frame
  /**
   * ctx: { p (feet), yaw, first, hiker, hydration, turbAt(x,z), lakeAt, groundY(x,z) }.
   * Returns the events to act on: { type: 'toast'|'sound'|'ripple'|'stir'|'emote', ... }.
   */
  update(dt, ctx) {
    this.events.length = 0;
    const a = this.act;
    this.ctx = ctx;
    // the first-person canteen is only there while drinking
    this.heldFp.visible = !!a && a.kind === 'drink' && ctx.first;
    if (!a) { ctx.hiker.emote = ctx.hiker.emote === 'Crouch Idle 01' || ctx.hiker.emote === 'Wiping Sweat' ? '' : ctx.hiker.emote; this.#itemInHand(false); return this.events; }
    a.t += dt;
    if (a.kind === 'drink') this.#drink(dt, a, ctx);
    else if (a.kind === 'fill') this.#fill(dt, a, ctx);
    else if (a.kind === 'pump') this.#pump(dt, a, ctx);
    else if (a.kind === 'scrub') this.#scrub(dt, a, ctx);
    return this.events;
  }

  emit(e) { this.events.push(e); }

  #itemInHand(on) {
    if (this.avatar.setItem) this.avatar.setItem(on ? this.held : null);
  }

  #hide() { this.station.visible = false; this.ctx?.hiker && (this.ctx.hiker.emote = ''); this.pumped = 0; }

  // the swallows: lift, tip, a gulp, lower
  #drink(dt, a, ctx) {
    const u = a.t / a.dur;
    if (ctx.first) {
      const lift = smooth(0, 0.3, u) * (1 - smooth(0.8, 1, u)), tip = smooth(0.22, 0.52, u) * (1 - smooth(0.62, 0.82, u));
      const h = this.heldFp;
      h.position.set(THREE.MathUtils.lerp(0.2, 0.03, lift), THREE.MathUtils.lerp(-0.34, -0.16 + 0.015 * Math.sin(a.t * 14) * tip, lift), THREE.MathUtils.lerp(-0.56, -0.5, lift));
      h.rotation.set(THREE.MathUtils.lerp(0.18, 1.55, tip), THREE.MathUtils.lerp(-0.45, 0, lift), THREE.MathUtils.lerp(0.05, 0, lift));
      h.scale.setScalar(1.05);
      this.#itemInHand(false);
    } else {
      this.#itemInHand(true);
      ctx.hiker.emote = 'Wiping Sweat';
    }
    if (!a.took && u > 0.5) {
      a.took = true;
      const c = this.canteen;
      const want = Math.min(SIP_L, c.water);
      const went = ctx.hydration.drink(want);
      c.water = Math.max(0, c.water - went);
      this.emit({ type: 'sound', name: 'gulp' });
      if (went < want - 0.01) this.emit({ type: 'toast', text: 'Your stomach is full. Give it a few minutes.' });
      else if (!c.clean && went > 0) {
        // raw water: it might carry something
        if (!this.warnedRaw) { this.warnedRaw = true; this.emit({ type: 'toast', text: 'That water is untreated. Filter it first next time.', warn: true }); }
        if (ctx.hydration.swallowRaw(went, c.risk * (1 + 2 * c.turb))) this.emit({ type: 'sick' });
      }
      this.lastSips++;
    }
    if (a.t >= a.dur) { this.act = null; this.heldFp.visible = false; this.#itemInHand(false); ctx.hiker.emote = ''; }
  }

  #setStation(ctx, a) {
    const p = ctx.p, yaw = ctx.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    a.fx = fx; a.fz = fz; a.rx = rx; a.rz = rz;
    // set it on dry ground: ahead if there is any, else to a side or behind (at a shore the first metre ahead is water)
    a.bx = p.x + fx * 0.95; a.bz = p.z + fz * 0.95;
    const dry = ctx.dry || (() => true);
    for (const [f, s] of [[0.95, 0], [0.85, 0.55], [0.85, -0.55], [0.4, 0.95], [0.4, -0.95], [-0.7, 0.4], [-0.7, -0.4], [-1.1, 0]]) {
      const x = p.x + fx * f + rx * s, z = p.z + fz * f + rz * s;
      if (dry(x, z) && dry(x + rx * 0.35, z + rz * 0.35) && dry(x - rx * 0.35, z - rz * 0.35)) { a.bx = x; a.bz = z; break; }
    }
    return a;
  }

  #ground(x, z) { return this.ctx.groundY(x, z); }

  // dunk the canteen at the water's edge
  #fill(dt, a, ctx) {
    if (!a.set) { this.#setStation(ctx, a); a.set = true; this.emit({ type: 'sound', name: 'plop' }); }
    const T = a.target, c = this.canteen;
    ctx.hiker.emote = 'Crouch Idle 01';
    this.#itemInHand(false);
    this.filterObj.visible = false; this.cup.visible = false; this.strainer.visible = false;
    this.station.visible = true;
    // the canteen lies tilted in the water, neck up and out
    const g = this.groundCanteen;
    g.scale.setScalar(PROP);
    g.position.set(T.x, T.level - 0.035, T.z);
    g.rotation.set(0, Math.atan2(a.fx, a.fz), 1.15 + 0.08 * Math.sin(a.t * 3));
    // it fills; the water's turbidity at the spot (and what we stir up) is what goes in
    if (!a.noted) {
      a.noted = true;
      a.turb0 = ctx.turbAt(T.x, T.z);
      if (c.clean && c.water > 0.02) this.emit({ type: 'toast', text: 'Topping up a clean canteen from the stream makes all of it untreated.', warn: true });
      a.srcRisk = T.kind === 'lake' ? RISK.lake : RISK.stream;
      a.rawBefore = !c.clean && c.water > 0.02;
      c.clean = false;
    }
    a.stir += dt;
    if (a.stir > 0.35) { a.stir = 0; this.emit({ type: 'stir', x: T.x, z: T.z, a: 0.01 }); this.emit({ type: 'ripple', x: T.x, z: T.z, amp: 0.35 }); }
    const rate = FILL_LS * dt;
    const add = Math.min(rate, CANTEEN_L - c.water);
    const turb = a.turb0 + 0.25 * Math.min(1, a.t / 3);                 // dunking stirs the bottom up a little
    const old = c.water;
    c.turb = old + add > 0 ? (c.turb * old + turb * add) / (old + add) : turb;
    c.risk = a.rawBefore ? Math.max(c.risk, a.srcRisk) : a.srcRisk;
    c.water += add;
    c.from = T.kind;
    if (c.water >= CANTEEN_L - 0.005) {
      this.emit({ type: 'toast', text: `Canteen full (${c.water.toFixed(2)} L). It is untreated${c.turb > 0.25 ? ' and silty' : ''}: filter it before you drink.` });
      this.emit({ type: 'sound', name: 'lid' });
      this.act = null; this.#hide();
    }
  }

  // set the canteen down, run the intake hose into it, pump through the ceramic into the clean cup, pour it back
  #pump(dt, a, ctx) {
    const c = this.canteen, f = this.filter;
    if (!a.set) {
      this.#setStation(ctx, a);
      a.set = true; this.pumped = 0; a.batch = 0; a.pour = 0;
      this.#layoutStation(a, ctx);
      this.emit({ type: 'sound', name: 'lid' });
    }
    ctx.hiker.emote = 'Crouch Idle 01';
    this.#itemInHand(false);
    this.station.visible = true;
    this.filterObj.visible = true; this.cup.visible = true; this.strainer.visible = true;
    // flow slows as the element clogs; silty water clogs it faster
    const flow = PUMP_LMIN / 60 * Math.max(0.12, 1 - 0.88 * f.clog) * (1 - 0.35 * c.turb);
    const left = c.water - this.pumped;
    // the pour: the cup tips into the canteen, then pumping starts again
    if (a.pour > 0) {
      a.pour -= dt;
      const k = 1 - Math.max(0, a.pour) / 0.8;
      this.cup.position.copy(a.cupPos).lerp(a.mouth, Math.sin(Math.min(1, k * 1.2) * Math.PI) * 0.9);
      this.cup.rotation.z = -Math.sin(Math.min(1, k) * Math.PI) * 1.6;
      this.cup.userData.water.scale.set(1, 1, 1); this.cup.userData.water.visible = k < 0.4;
      if (a.pour <= 0) { this.cup.position.copy(a.cupPos); this.cup.rotation.set(0, 0, 0); a.batch = 0; this.cup.userData.water.visible = true; if (left <= 0.004) { this.#finishPump(a); return; } }
      return;
    }
    const add = Math.min(flow * dt, left);
    a.phase += dt * 2 * Math.PI * 1.5;
    this.pumped += add; a.batch += add;
    f.clog = Math.min(1, f.clog + add * (0.012 + 0.07 * c.turb)); f.litres += add;
    this.filterObj.userData.handle.position.y = 0.2 + 0.035 * (0.5 + 0.5 * Math.sin(a.phase)) - 0.0;
    this.filterObj.rotation.z = 0.01 * Math.sin(a.phase * 2);
    this.cup.userData.water.scale.y = 1; this.cup.userData.water.position.y = 0.006 + Math.min(0.06, (a.batch / 0.32) * 0.06);
    this.cup.userData.water.scale.set(1, 1, 1);
    if (Math.floor(a.phase / (2 * Math.PI)) !== Math.floor((a.phase - dt * 2 * Math.PI * 1.5) / (2 * Math.PI))) this.emit({ type: 'sound', name: 'pump' });
    if (a.batch >= 0.32 || left - add <= 0.004) a.pour = 0.8;
    if (f.clog > 0.97) { this.emit({ type: 'toast', text: 'The element is clogged. Scrub it with [U] when you stop pumping.', warn: true }); this.#finishPump(a); }
  }

  #layoutStation(a, ctx) {
    const { bx, bz, rx, rz, fx, fz } = a;
    const y = (x, z) => this.#ground(x, z);
    const place = (obj, x, z, yaw = 0) => { obj.position.set(x, y(x, z), z); obj.rotation.set(0, yaw, 0); };
    for (const o of [this.groundCanteen, this.filterObj, this.cup]) o.scale.setScalar(PROP);
    const cx = bx - rx * 0.2, cz = bz - rz * 0.2;
    place(this.groundCanteen, cx, cz, Math.atan2(fx, fz));
    this.groundCanteen.position.y += 0.11 * PROP;
    this.groundCanteen.rotation.z = 0;
    place(this.filterObj, bx + rx * 0.06, bz + rz * 0.06, Math.atan2(rx, rz) + Math.PI / 2);
    place(this.cup, bx + rx * 0.3, bz + rz * 0.3, 0);
    a.cupPos = this.cup.position.clone();
    a.mouth = new THREE.Vector3(cx, this.groundCanteen.position.y + 0.12 * PROP, cz);
    // hoses: intake from the filter's side port into the canteen's mouth; output from the other port into the cup
    const hoses = this.filterObj.userData.hoses;
    while (hoses.children.length) { const o = hoses.children[0]; hoses.remove(o); o.geometry?.dispose(); }
    this.filterObj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.filterObj.matrixWorld).invert();
    const L = (v) => v.clone().applyMatrix4(inv);
    const ip = this.filterObj.userData.intakePort.clone(), op = this.filterObj.userData.outPort.clone();
    const canMouth = L(new THREE.Vector3(cx, this.groundCanteen.position.y + 0.115 * PROP, cz));
    const cupTop = L(new THREE.Vector3(this.cup.position.x, this.cup.position.y + 0.1 * PROP, this.cup.position.z));
    hoses.add(hose([ip, ip.clone().add(new THREE.Vector3(-0.05, -0.04, 0.03)), canMouth.clone().add(new THREE.Vector3(0.06, 0.07, 0.03)), canMouth.clone().add(new THREE.Vector3(0, 0.02, 0))], 0.0045, this.m.hose));
    hoses.add(hose([op, op.clone().add(new THREE.Vector3(0.05, -0.03, 0.0)), cupTop.clone().add(new THREE.Vector3(-0.02, 0.07, 0.0)), cupTop], 0.0045, this.m.silicone));
    this.strainer.position.set(cx, this.groundCanteen.position.y + 0.02, cz + 0.0);
    this.strainer.visible = false;                                         // the strainer is inside the canteen
    this.cup.rotation.set(0, 0, 0);
    this.cup.userData.water.position.y = 0.006;
  }

  #finishPump(a) {
    const c = this.canteen;
    const done = this.pumped || 0;
    if (done > 0) {
      c.clean = c.water - done < 0.02;                                    // the part not yet pumped stays raw
      if (c.clean) { c.risk = RISK.clean; c.turb = 0; c.from = 'filtered'; this.emit({ type: 'toast', text: `Filtered: ${c.water.toFixed(2)} L of clean water${this.filter.clog > 0.6 ? '. The element is clogging.' : '.'}` }); this.emit({ type: 'sound', name: 'ready' }); }
      else this.emit({ type: 'toast', text: `${done.toFixed(2)} L filtered; the rest is still untreated.`, warn: true });
    }
    this.pumped = 0;
    this.act = null;
    this.#hide();
  }

  #scrub(dt, a, ctx) {
    const f = this.filter;
    if (!a.set) { this.#setStation(ctx, a); a.set = true; this.#layoutStation(a, ctx); this.filterObj.updateMatrixWorld(true); this.emit({ type: 'sound', name: 'creak' }); }
    ctx.hiker.emote = 'Crouch Idle 01';
    this.station.visible = true;
    this.filterObj.visible = true; this.cup.visible = true; this.strainer.visible = false;
    this.filterObj.rotation.z = 0.05 * Math.sin(a.t * 18);
    this.filterObj.userData.handle.position.y = 0.2;
    f.clog = Math.max(0.12, f.clog - dt * (f.clog - 0.1) * 0.5);
    if (a.t >= a.dur) {
      f.scrubs++;
      this.emit({ type: 'toast', text: `Element scrubbed${f.scrubs > 6 ? '. It is wearing thin.' : '.'}` });
      this.act = null; this.#hide();
    }
  }
}
