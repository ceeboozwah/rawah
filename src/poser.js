import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { straighten } from './anims.js';
import { Character } from './character.js';
import { buildCanteen, buildBladder, buildPot, buildStraw, buildRadio, buildFilter } from './gear.js';
import { sampleKeys, deltasFromClip } from './posebake.js';

// The pose editor: developer tools, local host only (F3 or Option + P toggles it, or the pose editor item on the quick bar).
//   Pick a character, click one of the dots on its skeleton (or a name in the list) and turn it with the gizmo or the three
//   sliders. Joints are held to human ranges so a pose can't twist the mesh into a candy wrapper: every bone has a swing cone
//   and a limit on how far it may twist about its own length, the elbows and knees only bend the way they do, and a dot turns
//   red while a limit is holding. Mirror makes the other side do the same; Limits can be turned off to see what they save you from.
//   Poses become keyframes on a timeline (smooth or linear, looping), play back, and can start from any frame of a game clip.
//   Save writes data/anims/<name>.json through the dev server (POST /dev/anim); the game plays it as the clip `pose/<name>`
//   (`lib.load(['pose/name'])`, then `hiker.emote = 'pose/name'` or an entry in ACTION_CLIP).
// The pose is stored as how far each bone has turned from its rest in the WORLD (see posebake.js), which is the same for every
// rig, so an animation made on one character fits all five.

const NAMES = ['blaize', 'grant', 'corey', 'taylor', 'trey'];
// what can be put in the right hand: the tools, and the things the game puts there (the same objects, through `Character.setItem`)
const TOOLS = ['fists', 'axe', 'machete', 'fireworks'];
const ITEMS = { canteen: buildCanteen, bladder: buildBladder, pot: buildPot, 'LifeStraw': buildStraw, radio: buildRadio, 'pump filter': buildFilter };
const HELD = [...TOOLS, ...Object.keys(ITEMS)];
const D2R = Math.PI / 180;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, 1);

const short = (n) => n.replace('mixamorig', '').replace(/^(Left|Right)/, '');
const side = (n) => (/^mixamorigLeft/.test(n) ? 'Left' : /^mixamorigRight/.test(n) ? 'Right' : '');
const mirrorName = (n) => (/^mixamorigLeft/.test(n) ? n.replace('mixamorigLeft', 'mixamorigRight') : /^mixamorigRight/.test(n) ? n.replace('mixamorigRight', 'mixamorigLeft') : n);
/** The same turn seen in a mirror across the character's left-right plane. */
const mirrorQ = (q, out) => out.set(q.x, -q.y, -q.z, q.w);

// how far each joint may go, in degrees: `cone` the swing away from rest, `tw` the twist about the bone's own length (either way),
// `hinge` [lo, hi] a joint that only bends about one axis (elbow, knee) with `slop` of sideways give
const LIMITS = {
  Hips: null,
  Spine: { cone: 25, tw: 18 }, Spine1: { cone: 22, tw: 16 }, Spine2: { cone: 22, tw: 16 },
  Neck: { cone: 40, tw: 40 }, Head: { cone: 45, tw: 55 }, HeadTop_End: { cone: 2, tw: 2 },
  Shoulder: { cone: 20, tw: 8 }, Arm: { cone: 165, tw: 75 },
  ForeArm: { hinge: [-5, 150], slop: 10, tw: 40 }, Hand: { cone: 75, tw: 28 },
  UpLeg: { cone: 125, tw: 38 }, Leg: { hinge: [-3, 150], slop: 8, tw: 12 }, Foot: { cone: 55, tw: 18 },
  ToeBase: { cone: 50, tw: 6 }, Toe_End: { cone: 2, tw: 2 },
};
const limitOf = (name) => {
  const s = short(name);
  if (s in LIMITS) return LIMITS[s];
  if (/^HandThumb1$/.test(s)) return { cone: 70, tw: 35 };
  if (/^HandThumb/.test(s)) return { cone: 80, tw: 15 };
  if (/^Hand(Index|Middle|Ring|Pinky)\d$/.test(s)) return { cone: 100, tw: 8 };
  if (/_End$/.test(s)) return { cone: 2, tw: 2 };
  return { cone: 60, tw: 30 };
};

const GROUPS = [
  ['Body', ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']],
  ['Left arm', ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']],
  ['Right arm', ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand']],
  ['Left leg', ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase']],
  ['Right leg', ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']],
  ['Left fingers', ['Thumb1', 'Thumb2', 'Thumb3', 'Index1', 'Index2', 'Index3', 'Middle1', 'Middle2', 'Middle3', 'Ring1', 'Ring2', 'Ring3', 'Pinky1', 'Pinky2', 'Pinky3'].map((f) => `LeftHand${f}`)],
  ['Right fingers', ['Thumb1', 'Thumb2', 'Thumb3', 'Index1', 'Index2', 'Index3', 'Middle1', 'Middle2', 'Middle3', 'Ring1', 'Ring2', 'Ring3', 'Pinky1', 'Pinky2', 'Pinky3'].map((f) => `RightHand${f}`)],
];


/** A joint turn split into the swing (as a rotation vector) and the twist angle about axis u. */
function splitTwist(rel, u) {
  const q = rel.clone().normalize();
  if (q.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
  const d = q.x * u.x + q.y * u.y + q.z * u.z, tl = Math.hypot(d, q.w) || 1;
  const twist = new THREE.Quaternion(u.x * d / tl, u.y * d / tl, u.z * d / tl, q.w / tl);
  const tAng = 2 * Math.atan2(d / tl, q.w / tl);
  const swing = q.clone().multiply(twist.clone().invert());
  if (swing.w < 0) { swing.x = -swing.x; swing.y = -swing.y; swing.z = -swing.z; swing.w = -swing.w; }
  const sa = 2 * Math.acos(Math.min(1, swing.w)), sl = Math.hypot(swing.x, swing.y, swing.z);
  const rv = sl < 1e-9 ? new THREE.Vector3() : new THREE.Vector3(swing.x, swing.y, swing.z).multiplyScalar(sa / sl);
  return { rv, tAng };
}

/** The reverse: a swing vector and a twist angle about u back into one turn. */
function joinTwist(rv, tAng, u) {
  const ang = rv.length();
  const swing = ang < 1e-9 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(rv.clone().normalize(), ang);
  return swing.multiply(new THREE.Quaternion().setFromAxisAngle(u, tAng));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Poser {
  constructor({ renderer, camera, scene, world, hiker, lib, keys, toast }) {
    Object.assign(this, { renderer, camera, scene, world, hiker, lib, keys, toast });
    this.active = false;
    this.focus = new THREE.Vector3();
    this.name = 'blaize';
    this.char = null; this.model = null; this.built = false;
    this.tb = new Map();           // bone name -> { name, parent, children, wq, wp, restLocal, axis, hinge }
    this.order = [];               // bone names, parents first
    this.D = new Map();            // the live pose: bone -> world delta from rest
    this.hipsDy = 0;
    this.world_ = new Map();       // bone -> world orientation of the posed bone
    this.sel = null;
    this.frames = [];              // keyframes in the saved format
    this.t = 0; this.duration = 1; this.loop = true; this.smooth = true; this.playing = false; this.speed = 1;
    this.opts = { mirror: false, limits: true, auto: true, local: true };
    this.cam = { yaw: 0.35, pitch: 0.12, dist: 3.2, target: new THREE.Vector3() };
    this.held = null;                   // where the thing in the hand sits against the grip: { p: metres in hand space, q }
    this.itemSel = null;                // the gizmo is on the held item ('translate' or 'rotate'), not a bone
    this.first = false;                 // the view from the character's own eyes
    this.look = { yaw: 0, pitch: -0.4 };
    this.eye = { fwd: 8, up: 10, near: 4 };   // first person: eye offset from the head bone (cm) and the near clip distance (cm)
    this.stage = new THREE.Vector3();
    this.clamped = new Set();
    this.drag = null;
    this.dirty = true;
    this.savedName = '';

    this.markers = new THREE.Group();
    this.markers.visible = false;
    scene.add(this.markers);
    this.proxy = new THREE.Object3D();
    scene.add(this.proxy);
    this.controls = new TransformControls(camera, renderer.domElement);
    this.controls.setMode('rotate');
    this.controls.setSize(0.8);
    this.controls.visible = false; this.controls.enabled = false;
    this.controls.addEventListener('dragging-changed', (e) => { this.dragging = e.value; if (!e.value) this.dragEnd = performance.now(); });
    this.controls.addEventListener('objectChange', () => this.#fromGizmo());
    scene.add(this.controls);
    this.ray = new THREE.Raycaster();
    this.#ui();

    const el = renderer.domElement;
    el.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    el.addEventListener('pointerdown', (e) => this.#down(e));
    window.addEventListener('pointermove', (e) => this.#move(e));
    window.addEventListener('pointerup', (e) => this.#up(e));
    el.addEventListener('wheel', (e) => { if (!this.active) return; e.preventDefault(); this.cam.dist = Math.min(12, Math.max(0.6, this.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  }

  // ------------------------------------------------------------------ on and off
  toggle(on = !this.active) {
    if (on === this.active) return;
    this.active = on;
    document.body.classList.toggle('editing', on);
    this.panel.classList.toggle('hidden', !on);
    this.bar.classList.toggle('hidden', !on);
    this.markers.visible = on;
    if (on) {
      document.exitPointerLock?.();
      // the stage: a few metres in front of where the hiker stands
      const h = this.hiker;
      this.stage.set(h.pos.x - Math.sin(h.yaw) * 3, 0, h.pos.z - Math.cos(h.yaw) * 3);
      this.stage.y = this.world.height(this.stage.x, this.stage.z);
      this.cam.yaw = 0.35;
      this.cam.target.set(this.stage.x, this.stage.y + 0.95, this.stage.z);
      this.#load(this.name);
      this.#refreshLists();
      try { const d = JSON.parse(localStorage.getItem('rawah-pose-draft') || 'null'); if (d?.keys?.length) this.toast?.(`A draft of "${d.name}" is kept in this browser: press Restore draft in the Save row to bring it back.`); } catch { /* none */ }
    } else {
      this.playing = false;
      if (this.first) this.#firstPerson(false);
      this.camera.clearViewOffset(); this.shift = undefined;
      this.controls.enabled = false; this.controls.visible = false;
      if (this.char?.group) this.char.group.visible = false;
    }
    this.#status();
  }

  onKey(code) {
    if (!this.active) return false;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return false;
    if (code === 'F3') { this.toggle(false); return true; }
    if (code === 'Space') { this.#play(!this.playing); return true; }
    if (code === 'KeyV') { this.#firstPerson(!this.first); return true; }
    if (code === 'Delete' || code === 'Backspace') { this.#delKey(); return true; }
    if (code === 'KeyK') { this.#key(); return true; }
    if (code === 'KeyX') { this.#reset(this.sel); return true; }
    return false;
  }

  // ------------------------------------------------------------------ the character
  #load(name) {
    this.name = name;
    if (this.char?.group) { this.scene.remove(this.char.group); this.char.group.visible = false; }
    this.tb.clear(); this.order = []; this.markers.clear();
    this.char = new Character(this.scene, name, { lib: this.lib, placeholder: false, firstPerson: false });
    this.first = false; this.built = false; this.tool = this.tool || 'fists';
    this.#status();
  }

  /** Once the model is up: its bones, rest orientations (arms straightened as the game does) and joint axes. */
  #build() {
    const c = this.char, t = c.target;
    if (!c.ready || !t || !this.lib.srcRest) return false;
    this.model = c.group.children[0];
    c.group.position.copy(this.stage);
    c.group.rotation.set(0, 0, 0);
    c.group.visible = true;
    const aligned = straighten(this.lib.srcRest, t);
    this.tb.clear(); this.order = [];
    for (const b of t.bones) {
      const rest = (aligned.get(b.name) || b.wq).clone();
      this.tb.set(b.name, { name: b.name, parent: b.parent, children: [], wq: b.wq, wp: b.wp, rest, obj: this.model.getObjectByName(b.name) });
      this.order.push(b.name);
    }
    for (const e of this.tb.values()) {
      if (e.parent) this.tb.get(e.parent).children.push(e.name);
      const pr = e.parent ? this.tb.get(e.parent).rest : t.rootQ;
      e.restLocal = pr.clone().invert().multiply(e.rest);
    }
    this.rootQ = t.rootQ.clone();
    this.hipsScale = t.hips / 54.2;
    this.hipsRest = this.tb.get('mixamorigHips').obj.position.clone();
    for (const e of this.tb.values()) {
      // the bone's long axis in its own rest frame: toward its first child, or away from its parent at the tips
      const kid = e.children[0] && this.tb.get(e.children[0]);
      const dir = kid ? _v.copy(kid.wp).sub(e.wp) : _v.copy(e.wp).sub(this.tb.get(e.parent)?.wp || e.wp);
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
      e.axis = dir.clone().normalize().applyQuaternion(_q.copy(e.wq).invert()).normalize();
      // elbows bend the forearm forward, knees bend the shin back: the hinge axis is the way the limb points crossed with that
      const s = short(e.name);
      if (s === 'ForeArm' || s === 'Leg') {
        const hand = this.tb.get(s === 'ForeArm' ? e.name.replace('ForeArm', 'Hand') : e.name.replace('Leg', 'Foot'));
        if (hand) {
          const d = _v.copy(hand.wp).sub(e.wp).normalize();
          const w = _v2.crossVectors(d, s === 'ForeArm' ? FWD : _v2.copy(FWD).negate()).normalize();
          e.hingeAxis = w.clone().applyQuaternion(_q.copy(e.wq).invert()).normalize();
        }
      }
    }
    // dots on the joints
    this.markers.clear();
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (const e of this.tb.values()) {
      if (/_End$/.test(e.name)) continue;
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85 }));
      m.renderOrder = 60; m.userData.bone = e.name;
      const finger = /Hand(Thumb|Index|Middle|Ring|Pinky)/.test(e.name);
      m.scale.setScalar(finger ? 0.011 : /Hips|Spine/.test(e.name) ? 0.03 : 0.022);
      this.markers.add(m);
      e.marker = m;
    }
    this.#hold_();
    this.#fresh();
    this.built = true;
    this.#refreshBones();
    this.#status();
    return true;
  }

  /** Look through the character's eyes (its head is hidden so it is not in the way), or back out to the orbit view. */
  #firstPerson(on) {
    this.first = on;
    if (!on) { this.camera.near = this.nearWas ?? this.camera.near; this.camera.updateProjectionMatrix(); } else if (this.nearWas === undefined || this.camera.near > 0.2) this.nearWas = this.camera.near;
    const head = this.tb.get('mixamorigHead')?.obj;
    if (head) {
      if (!head.userData.fpScale) head.userData.fpScale = head.scale.clone();
      if (on) head.scale.setScalar(0.001); else head.scale.copy(head.userData.fpScale);
    }
    for (const e of this.tb.values()) if (e.marker && /Head|Neck/.test(e.name)) e.marker.visible = !on;
    if (this.fpBtn) this.fpBtn.textContent = on ? 'Back to orbit view' : 'First person view';
    this.#status();
  }

  /** Put the chosen thing in the character's hand: a tool, or one of the game's props. */
  #hold_() {
    const c = this.char;
    if (!c?.ready) return;
    const make = ITEMS[this.tool];
    c.setTool?.(make ? 'fists' : this.tool);
    c.setItem?.(make ? make() : null);
    if (this.itemSel && !this.#heldObj()) this.#select(null);
    this.held = null; this.#applyHeld(); this.#syncHeld();
  }

  // ------------------------------------------------------------------ the pose
  #fresh() { this.D.clear(); this.hipsDy = 0; this.dirty = true; this.#poses(); }

  /** Every bone's world orientation from the deltas. */
  #poses() {
    for (const name of this.order) {
      const e = this.tb.get(name), d = this.D.get(name);
      const q = this.world_.get(name) || this.world_.set(name, new THREE.Quaternion()).get(name);
      if (d) q.copy(d).multiply(e.rest); else q.copy(e.rest);
    }
  }

  /** Turn the model's bones to the pose. */
  #apply() {
    for (const name of this.order) {
      const e = this.tb.get(name);
      const parent = e.parent ? this.world_.get(e.parent) : this.rootQ;
      _q.copy(parent).invert().multiply(this.world_.get(name));
      e.obj?.quaternion.copy(_q);
    }
    const h = this.tb.get('mixamorigHips');
    h.obj.position.copy(this.hipsRest).add(_v.set(0, this.hipsDy * this.hipsScale, 0).applyQuaternion(_q.copy(this.rootQ).invert()));
    this.model.updateMatrixWorld(true);
    this.dirty = false;
  }

  /** The joint turn of a bone in its own rest frame: what the limits are about. */
  #relOf(name) {
    const e = this.tb.get(name), parent = e.parent ? this.world_.get(e.parent) : this.rootQ;
    return new THREE.Quaternion().copy(e.restLocal).invert().multiply(_q.copy(parent).invert().multiply(this.world_.get(name)));
  }

  /** Hold a joint turn to what the joint allows. Returns the held turn and whether it had to be held. */
  #hold(name, rel) {
    const lim = this.opts.limits ? limitOf(name) : null;
    if (!lim) return { q: rel, hit: false };
    const e = this.tb.get(name), u = e.axis;
    const { rv, tAng: t0 } = splitTwist(rel, u);
    let tAng = t0, hit = false;
    const maxT = lim.tw * D2R;
    if (Math.abs(tAng) > maxT) { tAng = Math.sign(tAng) * maxT; hit = true; }
    if (lim.hinge && e.hingeAxis) {
      const h = e.hingeAxis, along = rv.dot(h), off = _v2.copy(rv).addScaledVector(h, -along);
      const a = Math.min(lim.hinge[1] * D2R, Math.max(lim.hinge[0] * D2R, along));
      const slop = lim.slop * D2R;
      if (a !== along) hit = true;
      if (off.length() > slop) { off.setLength(slop); hit = true; }
      rv.copy(h).multiplyScalar(a).add(off);
    } else if (lim.cone !== undefined) {
      const maxS = lim.cone * D2R, l = rv.length();
      if (l > maxS) { rv.multiplyScalar(maxS / l); hit = true; }
    }
    return hit ? { q: joinTwist(rv, tAng, u), hit: true } : { q: rel, hit: false };
  }

  /** The three axes a joint's sliders turn about: bend (the hinge, if it has one), side, and twist along its length. */
  #basis(e) {
    if (e.basis) return e.basis;
    const u = e.axis;
    let h = e.hingeAxis ? e.hingeAxis.clone() : new THREE.Vector3().crossVectors(Math.abs(u.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), u);
    h.addScaledVector(u, -h.dot(u)).normalize();
    e.basis = { u, h, s: new THREE.Vector3().crossVectors(u, h).normalize() };
    return e.basis;
  }

  /** Put a bone at this world orientation (held to its limits), turning everything below it along with it. */
  #setWorld(name, Q, quiet = false) {
    const e = this.tb.get(name), parent = e.parent ? this.world_.get(e.parent) : this.rootQ;
    const rel = new THREE.Quaternion().copy(e.restLocal).invert().multiply(_q.copy(parent).invert().multiply(Q));
    const held = this.#hold(name, rel);
    const want = new THREE.Quaternion().copy(parent).multiply(e.restLocal).multiply(held.q);
    const dR = new THREE.Quaternion().copy(want).multiply(_q2.copy(this.world_.get(name)).invert());
    this.#turnBelow(name, dR);
    if (held.hit) this.clamped.add(name); else this.clamped.delete(name);
    if (!quiet && this.opts.mirror && mirrorName(name) !== name) this.#mirrorFrom(name);
    this.#poses(); this.dirty = true;
    return want;
  }

  /** Turn a bone and all its descendants by a world rotation (they keep their shape, like a limb moving as one). */
  #turnBelow(name, dR) {
    const todo = [name];
    while (todo.length) {
      const n = todo.pop(), e = this.tb.get(n);
      const cur = this.D.get(n) || new THREE.Quaternion();
      this.D.set(n, new THREE.Quaternion().copy(dR).multiply(cur).normalize());
      todo.push(...e.children);
    }
  }

  /** Copy the pose of a bone and everything below it onto the other side of the body, mirrored. */
  #mirrorFrom(name) {
    const todo = [name];
    while (todo.length) {
      const n = todo.pop(), e = this.tb.get(n), m = mirrorName(n);
      if (m !== n && this.tb.has(m)) {
        const d = this.D.get(n);
        if (d) this.D.set(m, mirrorQ(d, new THREE.Quaternion()).normalize()); else this.D.delete(m);
        if (this.clamped.has(n)) this.clamped.add(m); else this.clamped.delete(m);
      }
      todo.push(...e.children);
    }
  }

  #reset(name) {
    if (!this.built) return;
    if (!name) { this.#fresh(); this.clamped.clear(); this.#after(); return; }
    const todo = [name];
    while (todo.length) { const n = todo.pop(); this.D.delete(n); this.clamped.delete(n); todo.push(...this.tb.get(n).children); }
    if (this.opts.mirror) this.#mirrorFrom(name);
    this.#poses(); this.dirty = true; this.#after();
  }

  // ------------------------------------------------------------------ picking and the gizmo
  #select(name) {
    this.sel = name; this.itemSel = null;
    this.controls.setMode('rotate');
    const on = !!name && this.active;
    this.controls.enabled = on && !this.playing; this.controls.visible = on && !this.playing;
    if (name) { this.controls.attach(this.proxy); this.#toProxy(); }
    else this.controls.detach();
    this.#refreshSel();
    this.#refreshBones();
  }

  /** Put the gizmo on the thing in the hand: it moves or turns in the hand's space, and goes where the hand goes. */
  #selectItem(mode) {
    if (!this.#heldObj()) { this.toast?.('Put something in the hand first (In hand).'); return; }
    this.sel = null; this.itemSel = mode;
    this.controls.setMode(mode);
    this.controls.enabled = this.controls.visible = this.active && !this.playing;
    this.controls.attach(this.proxy);
    this.#toProxy();
    this.#refreshSel(); this.#refreshBones();
  }

  #heldObj() { return this.char?.itemObj || this.char?.toolObj || null; }

  /** Seat the held thing at the grip plus the adjustment (the adjustment is in the hand bone's space, so it follows the hand). */
  #applyHeld() {
    const o = this.#heldObj(), g = this.char?.grip;
    if (!o || !g) return;
    const h = this.held || { p: [0, 0, 0], q: [0, 0, 0, 1] };
    o.position.copy(g.pos).add(_v.set(h.p[0], h.p[1], h.p[2]).multiplyScalar(g.scale));
    o.quaternion.fromArray(h.q).multiply(g.q);
  }

  #itemFromProxy() {
    const hand = this.char.hand, g = this.char.grip;
    hand.updateWorldMatrix(true, false);
    _v.copy(this.proxy.position); hand.worldToLocal(_v);
    hand.getWorldQuaternion(_q2);
    _q.copy(_q2).invert().multiply(this.proxy.quaternion);
    const off = _q.multiply(_q3.copy(g.q).invert());
    this.held = { p: [..._v.sub(g.pos).divideScalar(g.scale).toArray()].map((v) => +v.toFixed(4)), q: off.toArray().map((v) => +v.toFixed(5)) };
    this.#applyHeld(); this.#syncHeld();
  }

  #toProxy() {
    if (this.itemSel) {
      const o = this.#heldObj();
      if (!o) return;
      o.getWorldPosition(this.proxy.position); o.getWorldQuaternion(this.proxy.quaternion);
      this.controls.setSpace(this.itemSel === 'translate' ? 'world' : 'local');
      return;
    }
    const e = this.tb.get(this.sel);
    if (!e || !e.obj) return;
    e.obj.getWorldPosition(this.proxy.position);
    this.proxy.quaternion.copy(this.world_.get(this.sel));
    this.controls.setSpace(this.opts.local ? 'local' : 'world');
  }

  #fromGizmo() {
    if (this.itemSel) { this.#itemFromProxy(); return; }
    if (!this.sel) return;
    const want = this.#setWorld(this.sel, this.proxy.quaternion.clone());
    this.proxy.quaternion.copy(want);
    this.#apply();
    this.#after();
  }

  #down(e) {
    if (!this.active) return;
    if (e.button === 2) { this.drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey }; return; }
    if (e.button !== 0 || this.dragging || this.controls.axis) return;
    if (performance.now() - (this.dragEnd || 0) < 150) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, this.camera);
    const hit = this.ray.intersectObjects(this.markers.children, false)[0];
    if (hit) { this.#select(hit.object.userData.bone); return; }
    // empty space: dragging turns the view round the character (a click without a drag lets go of the bone)
    this.drag = { x: e.clientX, y: e.clientY, pan: false, left: true, moved: 0 };
  }

  #move(e) {
    if (!this.drag || !this.active) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.moved = (this.drag.moved || 0) + Math.abs(dx) + Math.abs(dy);
    this.drag.x = e.clientX; this.drag.y = e.clientY;
    if (this.drag.pan) {
      const k = this.cam.dist * 0.0014;
      this.cam.target.addScaledVector(_v.setFromMatrixColumn(this.camera.matrix, 0), -dx * k).addScaledVector(_v2.setFromMatrixColumn(this.camera.matrix, 1), dy * k);
    } else if (this.first) {
      this.look.yaw -= dx * 0.004;
      this.look.pitch = Math.min(1.4, Math.max(-1.4, this.look.pitch - dy * 0.004));
    } else {
      this.cam.yaw -= dx * 0.006;
      this.cam.pitch = Math.min(1.4, Math.max(-0.6, this.cam.pitch + dy * 0.005));
    }
  }

  #up() {
    if (this.drag?.left && this.drag.moved < 4) this.#select(null);
    this.drag = null;
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    if (!this.built && !this.#build()) { this.#orbit(); return; }
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.t > this.duration) { if (this.loop) this.t %= this.duration; else { this.t = this.duration; this.#play(false); } }
      this.#sample(this.t);
      this.#syncTime();
    }
    if (this.dirty) this.#apply();
    // the arrow keys (or A and D) turn the view round, up and down tilt it, and W and S come closer or back off
    if (!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
      const k = this.keys, turn = ((k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0)) * dt * 2, tilt = ((k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0)) * dt * 1.2, zoom = ((k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0)) * dt * 1.5;
      if (this.first) { this.look.yaw += turn; this.look.pitch = Math.min(1.4, Math.max(-1.4, this.look.pitch + tilt)); }
      else { this.cam.yaw += turn; this.cam.pitch = Math.min(1.4, Math.max(-0.6, this.cam.pitch + tilt)); this.cam.dist = Math.min(12, Math.max(0.6, this.cam.dist * (1 + zoom))); }
    }
    this.#orbit();
    for (const e of this.tb.values()) {
      if (!e.marker) continue;
      e.obj.getWorldPosition(e.marker.position);
      e.marker.material.color.set(e.name === this.sel ? 0xf6d3bd : this.clamped.has(e.name) ? 0xff4a3a : 0xffffff);
    }
    if ((this.sel || this.itemSel) && !this.dragging && !this.playing) this.#toProxy();
    this.focus.copy(this.stage);
  }

  #orbit() {
    const c = this.cam, t = c.target, cp = Math.cos(c.pitch);
    const head = this.first && this.built ? this.tb.get('mixamorigHead')?.obj : null;
    if (head) {
      // from the character's eyes, looking the way it faces (drag to look about)
      head.getWorldPosition(this.camera.position);
      this.camera.position.y += this.eye.up / 100; this.camera.position.z += this.eye.fwd / 100;
      if (this.camera.near !== this.eye.near / 100) { this.camera.near = this.eye.near / 100; this.camera.updateProjectionMatrix(); }
      const lp = Math.cos(this.look.pitch);
      this.camera.lookAt(_v.set(this.camera.position.x + Math.sin(this.look.yaw) * lp, this.camera.position.y + Math.sin(this.look.pitch), this.camera.position.z + Math.cos(this.look.yaw) * lp));
    } else {
      this.camera.position.set(t.x + Math.sin(c.yaw) * cp * c.dist, t.y + Math.sin(c.pitch) * c.dist, t.z + Math.cos(c.yaw) * cp * c.dist);
      this.camera.lookAt(t);
    }
    // the character sits in the clear part of the screen, right of the panel
    const w = innerWidth, h = innerHeight, sh = Math.min(150, w * 0.12);
    if (this.shift !== sh || this.vw !== w || this.vh !== h) { this.shift = sh; this.vw = w; this.vh = h; this.camera.setViewOffset(w, h, -sh, 0, w, h); }
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ keyframes
  #sample(t) {
    const out = new Map();
    const dy = sampleKeys(this.frames, t, this.duration, this.loop, this.smooth, out);
    this.D = out; this.hipsDy = dy; this.#poses(); this.dirty = true;
  }

  #poseKey() {
    const rot = {};
    for (const [n, q] of this.D) if (Math.abs(q.w) < 0.999995) rot[n] = [q.x, q.y, q.z, q.w].map((v) => +v.toFixed(5));
    return { t: +this.t.toFixed(3), hips: +this.hipsDy.toFixed(2), rot };
  }

  #key() {
    if (!this.built) return;
    const k = this.#poseKey();
    const i = this.frames.findIndex((f) => Math.abs(f.t - k.t) < 0.02);
    if (i >= 0) this.frames[i] = k; else { this.frames.push(k); this.frames.sort((a, b) => a.t - b.t); }
    this.#refreshKeys();
  }

  #delKey() {
    const i = this.frames.findIndex((f) => Math.abs(f.t - this.t) < 0.02);
    if (i >= 0) { this.frames.splice(i, 1); this.#refreshKeys(); }
  }

  #play(on) {
    this.playing = on && this.frames.length > 0;
    this.controls.enabled = this.controls.visible = !!this.sel && !this.playing;
    this.pbtn.textContent = this.playing ? 'Pause' : 'Play';
    if (on && !this.frames.length) this.toast?.('Add a keyframe or two first.');
  }

  /** After any edit: write it into the key under the playhead if auto-key is on. */
  #after() {
    if (this.opts.auto && this.frames.some((f) => Math.abs(f.t - this.t) < 0.02)) this.#key();
    this.#refreshSel();
  }

  #goto(t) {
    this.t = Math.min(this.duration, Math.max(0, t));
    if (this.frames.length) this.#sample(this.t);
    this.#syncTime();
    this.#refreshKeys();
    this.#refreshSel();
  }

  // ------------------------------------------------------------------ the game's own clips
  #fromClip(name, t) {
    const clip = this.lib.get(name);
    if (!clip || !this.lib.srcRest) { this.toast?.('That clip is not loaded yet.'); return; }
    const out = new Map();
    this.hipsDy = deltasFromClip(clip, this.lib.srcRest, t, out);
    this.D = new Map([...out].filter(([n, q]) => this.tb.has(n) && Math.abs(q.w) < 0.999995));
    this.clamped.clear();
    this.#poses(); this.dirty = true;
    this.#after();
  }

  #importClip(name, step) {
    const clip = this.lib.get(name);
    if (!clip || !this.lib.srcRest) { this.toast?.('That clip is not loaded yet.'); return; }
    this.frames = []; this.duration = +clip.duration.toFixed(2); this.loop = true;
    const old = this.t;
    for (let t = 0; t < clip.duration - 0.01; t += step) { this.t = +t.toFixed(3); this.#fromClip(name, t); this.#key(); }
    this.t = old;
    this.#goto(0);
    this.#syncUi();
  }

  // ------------------------------------------------------------------ saving
  #payload() {
    const name = this.nameInput.value.trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    return { version: 1, name, duration: this.duration, loop: this.loop, smooth: this.smooth, keys: this.frames, ...(this.held ? { held: this.held } : {}) };
  }

  /** A copy of the animation as a file in the browser's Downloads, independent of the dev server. */
  #download() {
    const data = this.#payload();
    if (!data.name || !data.keys.length) { this.toast?.('Nothing to download yet.', 'warn'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `${data.name}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /** Every couple of seconds the work in progress is kept in this browser, so a closed tab or a failed save never loses it. */
  #autosave() {
    const data = this.#payload();
    if (!data.keys.length) return;
    const text = JSON.stringify(data);
    if (text === this.lastDraft) return;
    this.lastDraft = text;
    try { localStorage.setItem('rawah-pose-draft', text); localStorage.setItem('rawah-pose-draft-at', String(Date.now())); } catch { /* storage full or blocked */ }
  }

  #restoreDraft() {
    try {
      const d = JSON.parse(localStorage.getItem('rawah-pose-draft') || 'null');
      if (!d?.keys?.length) { this.toast?.('No draft kept in this browser.', 'warn'); return; }
      this.held = d.held || null; this.#applyHeld(); this.#syncHeld();
      this.frames = d.keys; this.duration = d.duration || 1; this.loop = d.loop !== false; this.smooth = d.smooth !== false;
      this.nameInput.value = d.name || 'draft';
      this.#goto(0); this.#syncUi();
      this.toast?.(`Restored the draft "${d.name}" (${d.keys.length} keys). Save it to put it on disk.`);
    } catch { this.toast?.('Could not read the draft.', 'warn'); }
  }

  async #save() {
    const data = this.#payload(), name = data.name;
    if (!name) { this.toast?.('Give the animation a name first.', 'warn'); return; }
    this.#autosave();
    this.#download();   // always leave a copy in Downloads too
    try {
      const r = await fetch('/dev/anim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error(r.status);
      // read it back: only say saved once the file on disk really holds these keys
      const back = await (await fetch(`data/anims/${encodeURIComponent(name)}.json`, { cache: 'no-store' })).json();
      if (!back.keys || back.keys.length !== data.keys.length) throw new Error('the file on disk does not match');
      this.savedName = name;
      this.toast?.(`Saved and checked: data/anims/${name}.json (${back.keys.length} keys). A copy is in your Downloads too.`);
      this.#refreshLists();
    } catch (err) { this.toast?.(`NOT saved to the project: ${err.message}. A copy went to your Downloads and the draft is kept in this browser. Is the dev server running?`, 'warn'); }
  }

  async #loadSaved(name) {
    try {
      const d = await (await fetch(`data/anims/${encodeURIComponent(name)}.json`, { cache: 'no-store' })).json();
      this.held = d.held || null; this.#applyHeld(); this.#syncHeld();
      this.frames = d.keys || []; this.duration = d.duration || 1; this.loop = d.loop !== false; this.smooth = d.smooth !== false;
      this.nameInput.value = d.name || name;
      this.#goto(0); this.#syncUi();
    } catch { this.toast?.('Could not read that animation.', 'warn'); }
  }

  async #refreshLists() {
    const clips = [...this.lib.clips.keys()].filter((n) => !n.startsWith('pose/')).sort();
    this.clipSel.innerHTML = clips.map((n) => `<option>${esc(n)}</option>`).join('');
    try {
      const idx = await (await fetch('data/anims/index.json', { cache: 'no-store' })).json();
      this.savedSel.innerHTML = idx.map((n) => `<option>${esc(n)}</option>`).join('') || '<option value="">(none yet)</option>';
    } catch { this.savedSel.innerHTML = '<option value="">(none yet)</option>'; }
  }

  // ------------------------------------------------------------------ the panel
  #ui() {
    const bar = document.createElement('div');
    bar.className = 'ed-bar hidden';
    bar.innerHTML = '<b>Pose editor</b><span id="pz-status"></span><span class="sep"></span><button id="pz-close">Close <kbd>⌥P</kbd></button>';
    document.body.appendChild(bar);
    this.bar = bar;
    const panel = document.createElement('div');
    panel.className = 'ed-panel pz-panel hidden';
    panel.innerHTML = `
      <details class="ed-sec" open><summary>Character</summary>
        <div class="ed-grid">
          <label class="ed-note">Who<select id="pz-char">${NAMES.map((n) => `<option>${n}</option>`).join('')}</select></label>
          <label class="ed-note">In hand<select id="pz-tool">${HELD.map((n) => `<option>${n}</option>`).join('')}</select></label>
        </div>
        <div class="ed-opts">
          <label><input type="checkbox" id="pz-mirror"> Mirror sides</label>
          <label><input type="checkbox" id="pz-limits" checked> Joint limits</label>
          <label><input type="checkbox" id="pz-local" checked> Gizmo follows bone</label>
        </div>
        <div class="pz-row"><button id="pz-fp">First person view <kbd>V</kbd></button></div>
        <small>First person: move the eye if the body gets in the way, and lower the near clip to stop it cutting off close parts.</small>
        <div class="pz-sl"><span>Eye fwd</span><input type="range" id="pz-efwd" min="-10" max="30" step="1" value="8"><output id="pz-efwdo"></output></div>
        <div class="pz-sl"><span>Eye up</span><input type="range" id="pz-eup" min="-10" max="25" step="1" value="10"><output id="pz-eupo"></output></div>
        <div class="pz-sl"><span>Near clip</span><input type="range" id="pz-enear" min="1" max="40" step="1" value="4"><output id="pz-enearo"></output></div>
        <div class="pz-row"><button id="pz-resetall">Reset pose</button><button id="pz-resetbone">Reset bone <kbd>X</kbd></button></div>
      </details>
      <details class="ed-sec" open><summary>Selected bone</summary>
        <h4 id="pz-sel">Click a dot on the skeleton</h4><small id="pz-limit"></small>
        <div class="pz-sl"><span>Bend</span><input type="range" id="pz-x" min="-180" max="180" step="1"><output id="pz-xo"></output></div>
        <div class="pz-sl"><span>Side</span><input type="range" id="pz-y" min="-180" max="180" step="1"><output id="pz-yo"></output></div>
        <div class="pz-sl"><span>Twist</span><input type="range" id="pz-z" min="-180" max="180" step="1"><output id="pz-zo"></output></div>
        <div class="pz-sl"><span>Hips up</span><input type="range" id="pz-hips" min="-30" max="15" step="0.5"><output id="pz-hipso"></output></div>
      </details>
      <details class="ed-sec" open><summary>Held item</summary>
        <small>Where it sits in the hand. It stays in the hand wherever the hand goes.</small>
        <div class="pz-row"><button id="pz-imove">Move with gizmo</button><button id="pz-iturn">Turn with gizmo</button><button id="pz-ireset">Reset grip</button></div>
        <div class="pz-sl"><span>Right</span><input type="range" id="pz-hx" min="-25" max="25" step="0.5"><output id="pz-hxo"></output></div>
        <div class="pz-sl"><span>Up</span><input type="range" id="pz-hy" min="-25" max="25" step="0.5"><output id="pz-hyo"></output></div>
        <div class="pz-sl"><span>Forward</span><input type="range" id="pz-hz" min="-25" max="25" step="0.5"><output id="pz-hzo"></output></div>
        <div class="pz-sl"><span>Tilt</span><input type="range" id="pz-hrx" min="-180" max="180" step="1"><output id="pz-hrxo"></output></div>
        <div class="pz-sl"><span>Turn</span><input type="range" id="pz-hry" min="-180" max="180" step="1"><output id="pz-hryo"></output></div>
        <div class="pz-sl"><span>Roll</span><input type="range" id="pz-hrz" min="-180" max="180" step="1"><output id="pz-hrzo"></output></div>
      </details>
      <details class="ed-sec"><summary>Bones</summary><div id="pz-bones"></div></details>
      <details class="ed-sec" open><summary>Timeline</summary>
        <div class="pz-sl"><span>Time</span><input type="range" id="pz-t" min="0" max="1" step="0.01"><output id="pz-to"></output></div>
        <div class="pz-row"><button id="pz-play">Play</button><button id="pz-key">Key here <kbd>K</kbd></button><button id="pz-del">Delete key</button></div>
        <div id="pz-keys" class="pz-keys"></div>
        <div class="ed-grid">
          <label class="ed-note">Length (s)<input type="number" id="pz-dur" min="0.2" max="20" step="0.1" value="1"></label>
          <label class="ed-note">Speed<input type="number" id="pz-speed" min="0.1" max="3" step="0.1" value="1"></label>
        </div>
        <div class="ed-opts"><label><input type="checkbox" id="pz-loop" checked> Loop</label><label><input type="checkbox" id="pz-smooth" checked> Smooth</label><label><input type="checkbox" id="pz-auto" checked> Auto-key</label></div>
      </details>
      <details class="ed-sec"><summary>Start from a game clip</summary>
        <select id="pz-clip"></select>
        <div class="ed-grid"><label class="ed-note">At (s)<input type="number" id="pz-clipt" min="0" step="0.1" value="0"></label><label class="ed-note">Every (s)<input type="number" id="pz-clips" min="0.05" step="0.05" value="0.15"></label></div>
        <div class="pz-row"><button id="pz-pose">Take this pose</button><button id="pz-import">Import as keys</button></div>
      </details>
      <details class="ed-sec" open><summary>Save</summary>
        <input type="text" id="pz-name" placeholder="name, e.g. axe_chop">
        <div class="pz-row"><button id="pz-save" class="ed-save">Save</button><button id="pz-dl">Download .json</button><button id="pz-draft">Restore draft</button></div>
        <select id="pz-saved"></select>
        <div class="pz-row"><button id="pz-load">Open</button></div>
        <p class="ed-help">Saved to data/anims/. The game plays it as <b>pose/name</b>. Drag on empty space (or right-drag) to turn all the way round the character, Shift + right-drag pans, scroll or W/S zooms, arrow keys or A/D turn the view, click a dot to pick a bone.</p>
      </details>`;
    document.body.appendChild(panel);
    this.panel = panel;
    const $ = (id) => panel.querySelector(`#pz-${id}`);
    this.pbtn = $('play'); this.nameInput = $('name'); this.clipSel = $('clip'); this.savedSel = $('saved');
    bar.querySelector('#pz-close').onclick = () => this.toggle(false);
    $('char').onchange = (e) => { this.name = e.target.value; this.#load(this.name); };
    $('tool').onchange = (e) => { this.tool = e.target.value; this.#hold_(); };
    $('mirror').onchange = (e) => { this.opts.mirror = e.target.checked; if (this.opts.mirror && this.sel) { this.#mirrorFrom(this.sel); this.#poses(); this.dirty = true; } };
    $('limits').onchange = (e) => { this.opts.limits = e.target.checked; if (!this.opts.limits) this.clamped.clear(); };
    $('local').onchange = (e) => { this.opts.local = e.target.checked; this.controls.setSpace(this.opts.local ? 'local' : 'world'); };
    this.fpBtn = $('fp'); $('fp').onclick = () => this.#firstPerson(!this.first);
    for (const [id, key] of [['efwd', 'fwd'], ['eup', 'up'], ['enear', 'near']]) {
      const f = () => { this.eye[key] = +$(id).value; $(id + 'o').textContent = `${$(id).value} cm`; };
      $(id).oninput = f; f();
    }
    $('resetall').onclick = () => this.#reset(null);
    $('imove').onclick = () => this.#selectItem('translate');
    $('iturn').onclick = () => this.#selectItem('rotate');
    $('ireset').onclick = () => { this.held = null; this.#applyHeld(); this.#syncHeld(); };
    // the sliders: centimetres along the hand's axes and degrees about them
    const fromHeld = () => {
      const e = new THREE.Euler($('hrx').value * D2R, $('hry').value * D2R, $('hrz').value * D2R, 'XYZ');
      this.held = { p: [$('hx').value / 100, $('hy').value / 100, $('hz').value / 100], q: new THREE.Quaternion().setFromEuler(e).toArray().map((v) => +v.toFixed(5)) };
      this.#applyHeld(); this.#syncHeld(true);
    };
    for (const a of ['hx', 'hy', 'hz', 'hrx', 'hry', 'hrz']) $(a).oninput = fromHeld;
    $('resetbone').onclick = () => this.#reset(this.sel);
    // the three sliders turn the bone about its own axes: bend (about its hinge), side, and twist along its length
    const fromSliders = () => {
      if (!this.sel || !this.built) return;
      const e = this.tb.get(this.sel), B = this.#basis(e), parent = e.parent ? this.world_.get(e.parent) : this.rootQ;
      const rv = new THREE.Vector3().addScaledVector(B.h, $('x').value * D2R).addScaledVector(B.s, $('y').value * D2R);
      const Q = new THREE.Quaternion().copy(parent).multiply(e.restLocal).multiply(joinTwist(rv, $('z').value * D2R, B.u));
      this.#setWorld(this.sel, Q);
      this.#apply();
      this.#after();
    };
    for (const a of ['x', 'y', 'z']) $(a).oninput = fromSliders;
    $('hips').oninput = (e) => { this.hipsDy = +e.target.value; this.dirty = true; $('hipso').textContent = `${this.hipsDy}`; this.#after(); };
    $('t').oninput = (e) => { this.#play(false); this.#goto(+e.target.value); };
    $('play').onclick = () => this.#play(!this.playing);
    $('key').onclick = () => this.#key();
    $('del').onclick = () => this.#delKey();
    $('dur').onchange = (e) => { this.duration = Math.max(0.2, +e.target.value || 1); this.#syncTime(); };
    $('speed').onchange = (e) => { this.speed = Math.max(0.1, +e.target.value || 1); };
    $('loop').onchange = (e) => { this.loop = e.target.checked; };
    $('smooth').onchange = (e) => { this.smooth = e.target.checked; };
    $('auto').onchange = (e) => { this.opts.auto = e.target.checked; };
    $('pose').onclick = () => this.#fromClip(this.clipSel.value, +$('clipt').value || 0);
    $('import').onclick = () => this.#importClip(this.clipSel.value, Math.max(0.05, +$('clips').value || 0.15));
    $('save').onclick = () => this.#ask();
    $('dl').onclick = () => this.#download();
    $('draft').onclick = () => this.#restoreDraft();
    setInterval(() => { if (this.active) this.#autosave(); }, 2000);
    $('load').onclick = () => this.savedSel.value && this.#loadSaved(this.savedSel.value);
    this.ui = $;
    this.keysEl = $('keys');
    this.keysEl.onclick = (e) => { const b = e.target.closest('button[data-t]'); if (b) { this.#play(false); this.#goto(+b.dataset.t); } };
    this.bonesEl = $('bones');
    this.bonesEl.onclick = (e) => { const b = e.target.closest('button[data-b]'); if (b) this.#select(b.dataset.b); };
  }

  #ask() {
    const name = this.nameInput.value.trim();
    if (!name) { this.toast?.('Give the animation a name first.', 'warn'); return; }
    if (!this.frames.length) { this.toast?.('Nothing to save: add a keyframe first.', 'warn'); return; }
    const m = document.createElement('div');
    m.className = 'ed-modal';
    m.innerHTML = `<div class="ed-modal-card"><h3>Are you sure you want to save?</h3><p class="ed-help">This writes <b>data/anims/${esc(name)}.json</b> with ${this.frames.length} keyframe${this.frames.length > 1 ? 's' : ''} over ${this.duration} s, replacing a file of that name.</p><div class="pz-row"><button data-y>Yes, save</button><button data-n>Cancel</button></div></div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('[data-n]').onclick = close;
    m.querySelector('[data-y]').onclick = () => { close(); this.#save(); };
    m.onclick = (e) => { if (e.target === m) close(); };
  }

  #refreshBones() {
    if (!this.built) return;
    this.bonesEl.innerHTML = GROUPS.map(([title, list]) => `<details class="ed-group"${title === 'Body' || title.includes('arm') ? ' open' : ''}><summary>${title}</summary><div class="pz-bl">${list.map((n) => {
      const full = `mixamorig${n}`;
      return this.tb.has(full) ? `<button data-b="${full}" class="${full === this.sel ? 'on' : ''}${this.clamped.has(full) ? ' hot' : ''}">${esc(n.replace(/^(Left|Right)/, '').replace('Hand', ''))}</button>` : '';
    }).join('')}</div></details>`).join('');
  }

  #refreshKeys() {
    this.#status();
    this.keysEl.innerHTML = this.frames.map((f) => `<button data-t="${f.t}" class="${Math.abs(f.t - this.t) < 0.02 ? 'on' : ''}">${f.t.toFixed(2)}</button>`).join('') || '<small>no keys yet</small>';
  }

  #refreshSel() {
    const U = this.ui;
    if (!this.sel || !this.built) { U('sel').textContent = 'Click a dot on the skeleton'; U('limit').textContent = ''; return; }
    const lim = limitOf(this.sel), e = this.tb.get(this.sel), B = this.#basis(e);
    const { rv, tAng } = splitTwist(this.#relOf(this.sel), B.u);
    // the sliders only reach as far as the joint does (a hair under half a turn when the limits are off)
    const on = this.opts.limits && lim, c = on ? (lim.cone ?? lim.slop ?? 179) : 179, bend = on && lim.hinge ? lim.hinge : [-c, c], tw = on ? lim.tw : 179;
    U('x').min = bend[0]; U('x').max = bend[1]; U('y').min = -c; U('y').max = c; U('z').min = -tw; U('z').max = tw;
    for (const [a, v] of [['x', rv.dot(B.h)], ['y', rv.dot(B.s)], ['z', tAng]]) { const d = Math.round(v / D2R); U(a).value = d; U(`${a}o`).textContent = `${d}°`; }
    U('sel').textContent = short(this.sel).replace(/([A-Z])/g, ' $1').trim() + (side(this.sel) ? ` (${side(this.sel).toLowerCase()})` : '');
    U('limit').textContent = lim ? (lim.hinge ? `hinge ${lim.hinge[0]}° to ${lim.hinge[1]}°, twist ±${lim.tw}°` : `swing up to ${lim.cone}°, twist ±${lim.tw}°`) : 'free';
    U('hips').value = this.hipsDy; U('hipso').textContent = `${this.hipsDy}`;
    this.#refreshBones();
  }

  /** Show the held item's adjustment on its sliders. */
  #syncHeld(fromSliders = false) {
    const U = this.ui;
    if (!U) return;
    const h = this.held || { p: [0, 0, 0], q: [0, 0, 0, 1] };
    const e = new THREE.Euler().setFromQuaternion(_q.fromArray(h.q), 'XYZ');
    const vals = { hx: h.p[0] * 100, hy: h.p[1] * 100, hz: h.p[2] * 100, hrx: e.x / D2R, hry: e.y / D2R, hrz: e.z / D2R };
    for (const [k, v] of Object.entries(vals)) {
      if (!fromSliders) U(k).value = v;
      U(`${k}o`).textContent = k.startsWith('hr') ? `${Math.round(v)}°` : `${v.toFixed(1)} cm`;
    }
  }

  #syncTime() {
    const U = this.ui;
    U('t').max = this.duration; U('t').value = this.t; U('to').textContent = `${this.t.toFixed(2)} s`;
    U('dur').value = this.duration;
  }

  #syncUi() {
    const U = this.ui;
    U('loop').checked = this.loop; U('smooth').checked = this.smooth;
    this.#syncTime(); this.#refreshKeys();
  }

  #status() {
    const el = document.getElementById('pz-status');
    if (!el) return;
    el.textContent = !this.active ? '' : this.built ? `${this.name} · ${this.first ? 'first person · ' : ''}${this.frames.length} key${this.frames.length === 1 ? '' : 's'}` : 'loading the model…';
  }
}
