import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { renderIcons } from './icons.js';
import { itemKey } from './flora.js';

// The world editor: developer tools, local host only (F2 toggles it).
//   fly      WASD to move, Space or E up, Q down, Shift faster, scroll sets the speed; hold the right mouse button and drag to look.
//   palette  every placeable asset (trees, rocks, logs) in a panel; [2] place mode puts the chosen one where the cursor meets the
//            ground; [1] select mode picks a placed asset and gives it a gizmo (T move, R rotate, Y scale) and a number panel;
//            [3] erase mode deletes a placed asset, or takes a procedural tree or rock out of the world for good.
//   ledger   everything lives in data/placements.json (src/placements.js). Ctrl+S saves it through the dev server
//            (POST /dev/placements); Ctrl+Z undoes; Delete deletes; Ctrl+D duplicates; X drops the selection onto the ground.
// The game reads the ledger at boot, so a saved placement is in the game on the next load with no code change.

const FLY = 28;
const MODES = { select: '1', place: '2', erase: '3', sculpt: '4' };

export class Editor {
  constructor({ renderer, camera, scene, world, flora, placements, keys, toast, mind }) {
    Object.assign(this, { renderer, camera, scene, world, flora, placements, keys, toast, mind });
    this.pressed = false;               // the left button, for the sculpt brush
    this.active = false;
    this.mode = 'select';
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.speed = 1;
    this.focus = new THREE.Vector3();
    this.asset = null;                 // the palette choice
    this.sel = null;                   // selected ledger entry
    this.ndc = new THREE.Vector2();
    this.ray = new THREE.Raycaster();
    this.look = false;
    this.undo = [];
    this.hit = new THREE.Vector3();
    this.hasHit = false;
    this.nextYaw = Math.random() * Math.PI * 2; this.nextScale = 1;
    this.opts = { randYaw: true, randScale: true, snap: false };
    this.proxy = new THREE.Object3D();
    scene.add(this.proxy);          // the gizmo wants what it moves to be in the scene
    this.controls = new TransformControls(camera, renderer.domElement);
    this.controls.setSize(0.85);
    this.controls.visible = false; this.controls.enabled = false;
    this.controls.addEventListener('dragging-changed', (e) => { this.dragging = e.value; if (!e.value) this.dragEnd = performance.now(); });
    this.controls.addEventListener('mouseDown', () => this.#push());
    this.controls.addEventListener('objectChange', () => this.#fromProxy());
    scene.add(this.controls);
    this.ghost = null;
    this.#ui();
    const el = renderer.domElement;
    el.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    el.addEventListener('pointerdown', (e) => this.#down(e));
    window.addEventListener('pointermove', (e) => this.#move(e));
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === renderer.domElement; document.body.classList.toggle('ed-locked', this.locked && this.active); if (this.locked) this.ndc.set(0, 0); });
    window.addEventListener('pointerup', (e) => this.#up(e));
    el.addEventListener('wheel', (e) => { if (!this.active) return; e.preventDefault(); this.speed = Math.min(16, Math.max(0.1, this.speed * (e.deltaY > 0 ? 0.85 : 1.18))); this.#status(); }, { passive: false });
    this.#status();
  }

  // ------------------------------------------------------------------ on and off
  toggle(on = !this.active) {
    if (on === this.active) return;
    this.active = on;
    document.body.classList.toggle('editing', on);
    this.panel.classList.toggle('hidden', !on);
    this.bar.classList.toggle('hidden', !on);
    if (on) {
      this.lock(true);                         // look with the mouse straight away; F or Esc gives the cursor back for the panel
      this.pos.copy(this.camera.position).y += 6;
      this.yaw = this.camera.rotation.y; this.pitch = 0;
      this.#iconsOnce();
    } else {
      this.lock(false);
      this.#select(null);
      this.#ghostOff();
    }
    this.controls.enabled = on && !!this.sel;
    this.controls.visible = on && !!this.sel;
    this.#status();
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    const k = this.keys;
    if (!typing) {
      const sp = FLY * this.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1) * dt;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const mv = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), st = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      this.pos.x += (fx * mv + -fz * st) * sp; this.pos.z += (fz * mv + fx * st) * sp;
      // look-direction flight on the forward axis: W goes where the camera points
      this.pos.y += (Math.sin(this.pitch) * mv) * sp + ((k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)) * sp;
    }
    const g = this.world.height(this.pos.x, this.pos.z);
    if (this.pos.y < g + 1) this.pos.y = g + 1;
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    this.focus.set(this.pos.x, g, this.pos.z);
    // what the cursor is over
    this.ray.setFromCamera(this.ndc, this.camera);
    this.hasHit = this.#ground(this.ray.ray, this.hit);
    this.#ghostUpdate();
    if (this.sel) this.#toProxy();
    this.placements.update(this.camera);
    this.#fields();
    if (this.rev !== this.placements.revision) { this.rev = this.placements.revision; this.#status(); }
  }

  /** Where the ray meets the ground: march, then bisect. */
  #ground(ray, out) {
    const w = this.world;
    let t0 = 0, t = 1.5;
    for (; t < 5000; t += Math.max(1.2, t * 0.012)) {
      const x = ray.origin.x + ray.direction.x * t, y = ray.origin.y + ray.direction.y * t, z = ray.origin.z + ray.direction.z * t;
      if (y < w.height(x, z)) {
        let a = t0, b = t;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2;
          const mx = ray.origin.x + ray.direction.x * m, my = ray.origin.y + ray.direction.y * m, mz = ray.origin.z + ray.direction.z * m;
          if (my < w.height(mx, mz)) b = m; else a = m;
        }
        out.set(ray.origin.x + ray.direction.x * b, 0, ray.origin.z + ray.direction.z * b);
        out.y = w.height(out.x, out.z);
        return true;
      }
      t0 = t;
    }
    return false;
  }

  // ------------------------------------------------------------------ mouse
  #ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  #down(e) {
    if (!this.active) return;
    if (!this.locked) this.#ndc(e);
    if (e.button === 2 && !this.locked) { this.look = true; this.lx = e.clientX; this.ly = e.clientY; e.preventDefault(); }
    if (e.button === 0 && this.mode === 'sculpt' && e.target === this.renderer.domElement) this.pressed = true;
  }

  /** Mouse-look with the pointer locked (the crosshair is the cursor); false returns the cursor. */
  lock(on = !this.locked) {
    if (on) { try { this.renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch { /* no gesture */ } }
    else if (document.pointerLockElement) document.exitPointerLock();
  }

  #move(e) {
    if (!this.active) return;
    if (this.locked) {
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0022));
      this.ndc.set(0, 0);
      return;
    }
    this.#ndc(e);
    if (this.look) {
      this.yaw -= (e.clientX - this.lx) * 0.0026;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - (e.clientY - this.ly) * 0.0026));
      this.lx = e.clientX; this.ly = e.clientY;
    }
  }

  #up(e) {
    if (!this.active) return;
    if (e.button === 2) { this.look = false; return; }
    if (e.button === 0) this.pressed = false;
    if (this.mode === 'sculpt') return;
    if (e.button !== 0 || e.target !== this.renderer.domElement) return;
    if (this.dragging || performance.now() - (this.dragEnd || 0) < 150 || this.controls.axis) return;      // that click was the gizmo's
    if (this.locked) this.ndc.set(0, 0); else this.#ndc(e);
    this.ray.setFromCamera(this.ndc, this.camera);
    if (this.mode === 'place') this.#place();
    else if (this.mode === 'erase') this.#erase();
    else this.#select(this.placements.pick(this.ray.ray));
  }

  // ------------------------------------------------------------------ actions
  #place() {
    if (!this.asset || !this.hasHit) { this.toast?.('Choose an asset in the palette first.'); return; }
    this.#push();
    const it = this.placements.add(this.asset.id, this.hit.x, this.hit.z, { yaw: this.nextYaw, s: this.nextScale });
    this.nextYaw = this.opts.randYaw ? Math.random() * Math.PI * 2 : this.nextYaw;
    this.nextScale = this.opts.randScale ? 0.85 + Math.random() * 0.35 : 1;
    this.#select(it, true);
  }

  #erase() {
    const it = this.placements.pick(this.ray.ray);
    if (it) { this.#push(); this.placements.remove(it.id); if (this.sel === it) this.#select(null); this.toast?.(`Deleted ${it.asset}.`); return; }
    if (!this.hasHit) return;
    const kinds = ['spruce', 'fir', 'lodgepole', 'aspen', 'snag', 'krumm', 'willow', 'boulder', 'slab', 'tooth', 'log'];
    const h = this.flora.find(this.hit.x, this.hit.z, 3.2, kinds);
    if (!h) { this.toast?.('Nothing to remove there.'); return; }
    this.#push();
    this.flora.take(h);
    this.placements.removed.push(itemKey(h.kind, h.x, h.z));
    this.placements.touch();
    this.toast?.(`Removed a ${h.kind} from the world (saved with the ledger).`);
  }

  #select(it, fresh = false) {
    this.sel = it;
    this.controls.enabled = this.active && !!it;
    this.controls.visible = this.active && !!it;
    if (it) { this.#toProxy(); this.controls.attach(this.proxy); if (fresh) this.controls.setMode('translate'); }
    else this.controls.detach();
    this.#fields(true);
  }

  #toProxy() {
    if (this.dragging) return;
    const it = this.sel, p = this.placements;
    p.pos(it, this.proxy.position);
    this.proxy.rotation.set(it.pitch, it.yaw, it.roll, 'YXZ');
    this.proxy.scale.setScalar(it.s);
  }

  #fromProxy() {
    const it = this.sel, pr = this.proxy, a = this.placements.byId.get(it.asset);
    const s = (pr.scale.x + pr.scale.y + pr.scale.z) / 3;
    pr.scale.setScalar(Math.max(0.05, s));
    it.x = pr.position.x; it.z = pr.position.z;
    const sink = a.kind === 'log' ? -0.12 : ['boulder', 'slab', 'tooth'].includes(a.kind) ? 0 : 0.15;
    it.dy = pr.position.y + sink - this.world.height(it.x, it.z);
    pr.rotation.order = 'YXZ';
    it.pitch = pr.rotation.x; it.yaw = pr.rotation.y; it.roll = pr.rotation.z;
    it.s = pr.scale.x;
    this.placements.touch();
    this.#fields();
  }

  #push() {
    this.undo.push(this.placements.snapshot());
    if (this.undo.length > 60) this.undo.shift();
  }

  #undo() {
    const s = this.undo.pop();
    if (!s) return;
    const before = new Set(this.placements.removed);
    const was = this.sel?.id;
    this.placements.restore(s);
    // a procedural thing that was removed and is back in the ledger-less state returns: forget its key and rebuild the tiles
    for (const k of before) if (!this.placements.removed.includes(k)) {
      this.flora.removed.delete(k);
      const [, x, z] = k.split(':').map(Number);
      this.flora.reground({ x0: x - 40, z0: z - 40, x1: x + 40, z1: z + 40 });
    }
    this.#select(was ? this.placements.get(was) : null);
  }

  async save() {
    const ledger = this.placements.toJSON();
    ledger.sculpt = this.world.sculpt.save();                     // the terrain edits (telekinesis) ride in the same file
    this.placements.sculpt = ledger.sculpt;
    const body = JSON.stringify(ledger);
    try { localStorage.setItem('rawah-placements-draft', body); } catch { /* private window */ }
    try {
      const r = await fetch('/dev/placements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      this.toast?.(r.ok ? `Saved ${this.placements.items.length} placements and ${this.placements.removed.length} removals to data/placements.json.` : `Could not save (${r.status}). The draft is kept in this browser.`, r.ok ? '' : 'warn');
    } catch { this.toast?.('Could not reach the dev server. The draft is kept in this browser.', 'warn'); }
  }

  /** Keys the editor takes; returns true when it used one. */
  onKey(code) {
    if (!this.active) return false;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return code === 'Escape' ? (document.activeElement.blur(), true) : false;
    const meta = this.keys.has('MetaLeft') || this.keys.has('MetaRight') || this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    if (meta && code === 'KeyS') { this.save(); return true; }
    if (meta && code === 'KeyZ') { this.#undo(); return true; }
    if (meta && code === 'KeyD' && this.sel) { this.#push(); const c = { ...this.sel }; delete c.id; this.#select(this.placements.add(c.asset, c.x + 2, c.z + 2, c), true); return true; }
    for (const [m, key] of Object.entries(MODES)) if (code === `Digit${key}`) { this.setMode(m); return true; }
    if (this.mode === 'sculpt' && (code === 'BracketLeft' || code === 'BracketRight')) { this.mind.radius = Math.min(40, Math.max(1.5, this.mind.radius * (code === 'BracketRight' ? 1.25 : 0.8))); return true; }
    if (code === 'KeyF') { this.lock(); return true; }
    if (code === 'KeyT') { this.controls.setMode('translate'); this.#status(); return true; }
    if (code === 'KeyR') { this.controls.setMode('rotate'); this.#status(); return true; }
    if (code === 'KeyY') { this.controls.setMode('scale'); this.#status(); return true; }
    if ((code === 'Delete' || code === 'Backspace') && this.sel) { this.#push(); this.placements.remove(this.sel.id); this.#select(null); return true; }
    if (code === 'KeyX' && this.sel) { this.#push(); this.sel.dy = 0; this.sel.pitch = this.sel.roll = 0; this.placements.touch(); return true; }
    if (code === 'Escape') { this.#select(null); this.setMode('select'); return true; }
    return code.startsWith('Key') || code === 'Space' || code.startsWith('Digit') || code === 'Tab';      // the game's own keys stay quiet while editing
  }

  setMode(m) {
    this.mode = m;
    if (m !== 'place') this.#ghostOff();
    if ((m === 'place' || m === 'sculpt') && this.sel) this.#select(null);
    this.pressed = false;
    for (const b of this.bar.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === m);
    this.#status();
  }

  /** What the telekinesis brush should do this frame (src/mind.js drives it): lift with the left button, sink with Alt held,
   *  level with L held; [ and ] size the brush. `aim` is where the cursor meets the ground, or null outside sculpt mode. */
  sculptInput() {
    const sc = this.mode === 'sculpt' && this.hasHit;
    const k = this.keys;
    const down = sc && this.pressed && !this.dragging;
    return { aim: sc ? this.hit : null, keys: { lift: down && !k.has('AltLeft') && !k.has('AltRight') && !k.has('KeyL'), sink: down && (k.has('AltLeft') || k.has('AltRight')), level: down && k.has('KeyL') } };
  }

  // ------------------------------------------------------------------ the ghost under the cursor
  #ghostOff() { if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; } }

  #ghostUpdate() {
    if (this.mode !== 'place' || !this.asset || !this.hasHit) { if (this.ghost) this.ghost.visible = false; return; }
    if (!this.ghost || this.ghost.userData.id !== this.asset.id) {
      this.#ghostOff();
      this.ghost = this.asset.obj ? this.asset.make() : new THREE.Mesh(this.asset.geometry, this.asset.material);
      this.ghost.userData.id = this.asset.id;
      this.ghost.frustumCulled = false;
      this.scene.add(this.ghost);
    }
    this.ghost.visible = true;
    this.ghost.position.copy(this.hit);
    this.ghost.rotation.set(0, this.nextYaw, 0);
    this.ghost.scale.setScalar(this.nextScale);
  }

  // ------------------------------------------------------------------ the panel
  #ui() {
    const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    this.bar = el('div', 'ed-bar glass hidden');
    this.bar.innerHTML = `<b>Editor</b>
      <button data-mode="select" class="on">Select <kbd>1</kbd></button><button data-mode="place">Place <kbd>2</kbd></button><button data-mode="erase">Erase <kbd>3</kbd></button><button data-mode="sculpt">Sculpt <kbd>4</kbd></button>
      <span class="sep"></span><button data-g="translate">Move <kbd>T</kbd></button><button data-g="rotate">Rotate <kbd>R</kbd></button><button data-g="scale">Scale <kbd>Y</kbd></button>
      <span class="sep"></span><button data-act="look">Look <kbd>F</kbd></button><button data-act="save">Save <kbd>⌘S</kbd></button><button data-act="undo">Undo <kbd>⌘Z</kbd></button>
      <span id="ed-status"></span>`;
    this.bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.mode) this.setMode(b.dataset.mode);
      else if (b.dataset.g) { this.controls.setMode(b.dataset.g); this.#status(); }
      else if (b.dataset.act === 'look') this.lock();
      else if (b.dataset.act === 'save') this.save();
      else if (b.dataset.act === 'undo') this.#undo();
    });
    this.panel = el('div', 'ed-panel glass hidden');
    this.panel.innerHTML = `<input id="ed-search" type="search" placeholder="Search assets" autocomplete="off">
      <div id="ed-list"></div>
      <div class="ed-opts"><label><input type="checkbox" data-o="randYaw" checked> random turn</label><label><input type="checkbox" data-o="randScale" checked> random size</label><label><input type="checkbox" data-o="snap"> snap</label></div>
      <div id="ed-sel"></div>
      <p class="ed-help">Mouse looks while the cursor is locked (F or Esc frees it for the panel) · right-drag looks when it is free · WASD fly · Space/E up · Q down · Shift fast · scroll speed · click to place or select · Del delete · Sculpt: hold left to lift, Alt to sink, L to level, [ ] brush size</p>`;
    document.body.append(this.bar, this.panel);
    this.list = this.panel.querySelector('#ed-list');
    this.search = this.panel.querySelector('#ed-search');
    this.search.addEventListener('input', () => this.#fillList());
    this.panel.querySelector('.ed-opts').addEventListener('change', (e) => {
      this.opts[e.target.dataset.o] = e.target.checked;
      if (e.target.dataset.o === 'snap') { this.controls.setTranslationSnap(e.target.checked ? 1 : null); this.controls.setRotationSnap(e.target.checked ? Math.PI / 12 : null); this.controls.setScaleSnap(e.target.checked ? 0.1 : null); }
    });
    this.#fillList();
  }

  #fillList() {
    const q = this.search.value.trim().toLowerCase();
    this.list.innerHTML = '';
    let group = '';
    for (const a of this.placements.assets) {
      if (q && !a.name.toLowerCase().includes(q) && !a.group.toLowerCase().includes(q)) continue;
      if (a.group !== group) { group = a.group; this.list.append(Object.assign(document.createElement('h4'), { textContent: group })); }
      const b = document.createElement('button');
      b.className = 'ed-asset' + (this.asset === a ? ' on' : '');
      b.dataset.id = a.id;
      b.innerHTML = `${a.img ? `<img src="${a.img}" alt="">` : ''}<span>${a.name}</span>`;
      b.onclick = () => { this.asset = a; this.setMode('place'); this.#fillList(); };
      this.list.append(b);
    }
  }

  /** Thumbnails of the assets, drawn once from their own geometry. */
  #iconsOnce() {
    if (this.iconsDone) return;
    this.iconsDone = true;
    try {
      const items = {};
      for (const a of this.placements.assets) items[a.id] = { obj: a.obj ? a.make() : new THREE.Mesh(a.geometry, a.material), pitch: 0.25, yaw: 0.6 };
      const ic = renderIcons(items, 96);
      for (const a of this.placements.assets) a.img = ic[a.id];
    } catch { /* names only */ }
    this.#fillList();
  }

  #fields(force = false) {
    const box = this.panel.querySelector('#ed-sel'), it = this.sel;
    if (!it) { if (box.dataset.id) { box.dataset.id = ''; box.innerHTML = ''; } return; }
    const deg = (r) => +(r * 180 / Math.PI).toFixed(1);
    if (force || box.dataset.id !== it.id) {
      box.dataset.id = it.id;
      box.innerHTML = `<h4>${this.placements.byId.get(it.asset).name} <small>${it.id}</small></h4>
        <div class="ed-f">${['x', 'z', 'dy', 'yaw', 'pitch', 'roll', 's'].map((f) => `<label>${{ s: 'scale', dy: 'height' }[f] || f}<input data-f="${f}" type="number" step="${f === 's' ? 0.05 : 0.5}"></label>`).join('')}</div>
        <label class="ed-note">note<input data-f="note" type="text" placeholder="what is this for?"></label>`;
      box.onchange = (e) => {
        const f = e.target.dataset.f; if (!f) return;
        this.#push();
        const v = e.target.value;
        if (f === 'note') it.note = v;
        else it[f] = ['yaw', 'pitch', 'roll'].includes(f) ? parseFloat(v) * Math.PI / 180 : parseFloat(v);
        this.placements.touch();
      };
    }
    const vals = { x: it.x, z: it.z, dy: it.dy, yaw: deg(it.yaw), pitch: deg(it.pitch), roll: deg(it.roll), s: it.s, note: it.note || '' };
    for (const inp of box.querySelectorAll('input[data-f]')) {
      if (document.activeElement === inp) continue;
      const v = vals[inp.dataset.f];
      inp.value = typeof v === 'number' ? +v.toFixed(2) : v;
    }
  }

  #status() {
    const s = this.bar.querySelector('#ed-status');
    if (!s) return;
    s.textContent = `${this.placements.items.length} placed · ${this.placements.removed.length} removed · fly ×${this.speed.toFixed(1)}`;
    for (const b of this.bar.querySelectorAll('[data-g]')) b.classList.toggle('on', b.dataset.g === this.controls.mode);
  }
}
