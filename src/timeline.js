import { EASES, bezier } from './posebake.js';

// The pose editor's timeline, laid out like the timeline of an audio workstation: a ruler with a playhead along the top, then
// a row for the whole pose, one for the hips, and a row for each body part that opens into a row per bone, each carrying its own keyframe
// diamonds under the same clock. A diamond on a body part stands for every bone key at that time. Click a diamond to select it (shift adds),
// drag to move it, double-click an empty spot of a row to key that bone (or part) there, click the ruler or an empty spot to move the
// playhead. Wheel scrolls the rows, ctrl + wheel zooms the time, shift + wheel pans it. The selected keys share a curve: pick one or
// shape the Bezier handles, and the segment after each selected key follows it.
//
// It owns no animation data: it reads and edits the `tracks` object the editor hands it (see posebake.js) and says when something changed.

const LW = 132, RH = 19, RULER = 22, MAXROWS = 8, PAD = 14;
const COL = { bg: 'rgba(14,16,20,0.94)', row: 'rgba(255,255,255,0.035)', rowAlt: 'rgba(255,255,255,0.06)', grid: 'rgba(255,255,255,0.09)', text: '#cdd3dc', dim: '#7e8794', key: '#f6d3bd', sel: '#ffffff', play: '#ff6a4a', part: '#9fb5d6', head: 'rgba(255,255,255,0.1)' };

const keyAt = (list, t) => list.find((k) => Math.abs(k.t - t) < 0.0015);

export class Timeline {
  /**
   * @param {object} o
   * @param {() => object} o.tracks        the live tracks object
   * @param {Array<[string, string[]]>} o.groups   body parts: [title, bone names (full)]
   * @param {() => number} o.time          playhead
   * @param {() => number} o.duration
   * @param {() => string|null} o.selected the selected bone
   * @param {(t:number)=>void} o.scrub     move the playhead
   * @param {(bone:string)=>void} o.pick   a bone row was clicked
   * @param {(tracks:string[], t:number)=>void} o.add   key these tracks at t from the current pose
   * @param {(why:string)=>void} o.changed keys moved, removed or re-curved
   */
  constructor(o) {
    this.o = o;
    this.open = new Set(['Body']);
    this.sel = [];                 // selected keys: { track, key }
    this.scroll = 0;
    this.zoom = 1; this.pan = 0;   // visible span = duration / zoom, starting at pan seconds
    this.drag = null;
    this.rows = [];
    const el = this.el = document.createElement('div');
    el.className = 'pz-tl hidden';
    el.innerHTML = `<canvas></canvas>
      <div class="pz-tlbar">
        <span>Curve of the selected keys</span>
        <select class="tl-ease"><option value="">(smooth default)</option>${Object.keys(EASES).map((n) => `<option>${n}</option>`).join('')}<option value="custom">custom</option></select>
        <canvas class="tl-curve" width="84" height="40"></canvas>
        <label>x1<input type="number" class="tl-h" step="0.05" min="0" max="1"></label><label>y1<input type="number" class="tl-h" step="0.05" min="-1" max="2"></label>
        <label>x2<input type="number" class="tl-h" step="0.05" min="0" max="1"></label><label>y2<input type="number" class="tl-h" step="0.05" min="-1" max="2"></label>
        <button class="tl-del">Delete keys</button>
        <small class="tl-info"></small>
      </div>`;
    document.body.appendChild(el);
    this.cv = el.querySelector('canvas');
    this.curveCv = el.querySelector('.tl-curve');
    this.easeSel = el.querySelector('.tl-ease');
    this.hs = [...el.querySelectorAll('.tl-h')];
    this.info = el.querySelector('.tl-info');
    this.easeSel.onchange = () => this.#setEase(this.easeSel.value);
    for (const h of this.hs) h.onchange = () => this.#setEase('custom', this.hs.map((i) => +i.value || 0));
    el.querySelector('.tl-del').onclick = () => this.deleteSelected();
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => this.#down(e));
    cv.addEventListener('dblclick', (e) => this.#dbl(e));
    cv.addEventListener('wheel', (e) => this.#wheel(e), { passive: false });
    window.addEventListener('pointermove', (e) => this.#move(e));
    window.addEventListener('pointerup', (e) => this.#up(e));
  }

  show(on) { this.el.classList.toggle('hidden', !on); if (on) this.draw(); }
  get height() { return this.el.offsetHeight; }

  // ------------------------------------------------------------ rows
  #buildRows() {
    const tracks = this.o.tracks(), sel = this.o.selected();
    const rows = [{ id: 'all', label: 'Whole pose', names: Object.keys(tracks), kind: 'all' }];
    rows.push({ id: 'hips', label: 'Hips height', names: ['hips'], kind: 'hips' });
    for (const [title, bones] of this.o.groups) {
      const keyed = bones.filter((b) => tracks[b]?.length), has = keyed.length || (sel && bones.includes(sel));
      if (!has) continue;
      const open = this.open.has(title);
      rows.push({ id: `g:${title}`, label: title, names: keyed, kind: 'group', open, title });
      if (open) for (const b of bones) if (tracks[b]?.length || b === sel) rows.push({ id: b, label: b.replace('mixamorig', '').replace(/^(Left|Right)/, (m) => m[0] + '·'), names: [b], kind: 'bone', bone: b });
    }
    this.rows = rows;
  }

  #times(row) {
    const tracks = this.o.tracks(), ts = [];
    for (const n of row.names) for (const k of tracks[n] || []) if (!ts.some((x) => Math.abs(x - k.t) < 0.0015)) ts.push(k.t);
    return ts;
  }

  // ------------------------------------------------------------ geometry
  get #span() { return Math.max(0.05, this.o.duration() / this.zoom); }
  #x(t) { const W = this.cv.clientWidth; return LW + (t - this.pan) / this.#span * (W - LW - PAD); }
  #t(x) { const W = this.cv.clientWidth; return this.pan + (x - LW) / (W - LW - PAD) * this.#span; }
  #rowAt(y) { const i = Math.floor((y - RULER) / RH) + this.scroll; return y >= RULER ? this.rows[i] : null; }

  // ------------------------------------------------------------ drawing
  draw() {
    if (this.el.classList.contains('hidden')) return;
    this.#buildRows();
    const dpr = Math.min(2, devicePixelRatio || 1), W = this.el.clientWidth, vis = Math.min(MAXROWS, this.rows.length);
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.rows.length - vis)));
    const H = RULER + vis * RH + 2;
    const cv = this.cv;
    cv.style.height = `${H}px`;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
    g.font = '500 12px Gabarito, sans-serif'; g.textBaseline = 'middle';
    const dur = this.o.duration(), t0 = this.pan, t1 = this.pan + this.#span;
    // ruler: the finest tick spacing that keeps labels apart
    const px = (W - LW - PAD) / this.#span;
    let step = 0.05; for (const s of [0.05, 0.1, 0.25, 0.5, 1, 2, 5]) { step = s; if (s * px >= 56) break; }
    g.fillStyle = COL.head; g.fillRect(0, 0, W, RULER);
    g.textAlign = 'left';
    for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-6; t += step) {
      const x = Math.round(this.#x(t)) + 0.5;
      g.strokeStyle = COL.grid; g.beginPath(); g.moveTo(x, RULER - 6); g.lineTo(x, H); g.stroke();
      g.fillStyle = COL.dim; g.fillText(t.toFixed(step < 0.1 ? 2 : step < 1 ? 2 : 1), x + 3, 9);
    }
    // the end of the animation
    const xe = this.#x(dur);
    if (xe < W) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(Math.max(LW, xe), RULER, W - Math.max(LW, xe), H - RULER); }
    // rows
    const sel = this.o.selected(), tracks = this.o.tracks();
    for (let i = 0; i < vis; i++) {
      const row = this.rows[i + this.scroll], y = RULER + i * RH;
      g.fillStyle = i % 2 ? COL.rowAlt : COL.row; g.fillRect(0, y, W, RH);
      const isSel = row.kind === 'bone' && row.bone === sel;
      if (isSel) { g.fillStyle = 'rgba(246,211,189,0.14)'; g.fillRect(0, y, W, RH); }
      g.fillStyle = row.kind === 'group' || row.kind === 'all' ? COL.part : isSel ? COL.key : COL.text;
      g.textAlign = 'left';
      const ind = row.kind === 'bone' ? 22 : 8;
      if (row.kind === 'group') { g.fillText(row.open ? '▾' : '▸', 6, y + RH / 2); g.fillText(row.label, 20, y + RH / 2); }
      else g.fillText(row.label, ind, y + RH / 2);
      for (const t of this.#times(row)) {
        if (t < t0 - 0.01 || t > t1 + 0.01) continue;
        const x = this.#x(t), c = y + RH / 2, on = this.sel.some((s) => Math.abs(s.key.t - t) < 0.0015 && row.names.includes(s.track));
        g.fillStyle = on ? COL.sel : row.kind === 'group' || row.kind === 'all' ? COL.part : COL.key;
        g.beginPath(); g.moveTo(x, c - 5); g.lineTo(x + 5, c); g.lineTo(x, c + 5); g.lineTo(x - 5, c); g.closePath(); g.fill();
        // a mark under a key that has its own curve
        const own = row.names.some((n) => (tracks[n] || []).some((k) => Math.abs(k.t - t) < 0.0015 && k.e));
        if (own) { g.fillStyle = COL.play; g.fillRect(x - 1.5, c + 6, 3, 2); }
      }
    }
    g.strokeStyle = COL.grid; g.beginPath(); g.moveTo(LW + 0.5, RULER); g.lineTo(LW + 0.5, H); g.stroke();
    // the playhead
    const xp = this.#x(this.o.time());
    if (xp >= LW - 1 && xp <= W) {
      g.strokeStyle = COL.play; g.lineWidth = 1.5; g.beginPath(); g.moveTo(xp, 0); g.lineTo(xp, H); g.stroke(); g.lineWidth = 1;
      g.fillStyle = COL.play; g.beginPath(); g.moveTo(xp - 6, 0); g.lineTo(xp + 6, 0); g.lineTo(xp, 9); g.closePath(); g.fill();
    }
    // scroll hint
    if (this.rows.length > vis) { g.fillStyle = COL.dim; g.textAlign = 'right'; g.fillText(`${this.scroll + 1}–${this.scroll + vis} of ${this.rows.length} rows`, LW - 6, 9); }
    this.#syncBar();
  }

  #syncBar() {
    const n = this.sel.length, ks = this.sel.map((s) => s.key);
    this.info.textContent = n ? `${n} key${n > 1 ? 's' : ''} selected` : 'Click a diamond to select it; double-click a row to add a key.';
    const same = ks.length && ks.every((k) => JSON.stringify(k.e || null) === JSON.stringify(ks[0].e || null));
    const e = same ? ks[0].e : null;
    const name = !same ? '' : !e ? '' : e === 'hold' ? 'hold' : (Object.entries(EASES).find(([, v]) => Array.isArray(v) && v.every((x, i) => Math.abs(x - e[i]) < 1e-6)) || ['custom'])[0];
    if (document.activeElement !== this.easeSel) this.easeSel.value = name;
    const vals = Array.isArray(e) ? e : EASES['ease in-out'];
    this.hs.forEach((h, i) => { if (document.activeElement !== h) h.value = vals[i]; h.disabled = !n; });
    this.easeSel.disabled = !n;
    const c = this.curveCv.getContext('2d');
    c.clearRect(0, 0, 84, 40); c.strokeStyle = 'rgba(255,255,255,0.25)'; c.strokeRect(4.5, 4.5, 75, 31);
    c.strokeStyle = COL.key; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i <= 40; i++) { const u = i / 40, y = e === 'hold' ? (u < 1 ? 0 : 1) : Array.isArray(e) ? bezier(e, u) : u * u * (3 - 2 * u); c.lineTo(4 + u * 76, 36 - Math.max(-0.3, Math.min(1.3, y)) * 31); }
    c.stroke(); c.lineWidth = 1;
  }

  // ------------------------------------------------------------ input
  #pos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  #hit(row, x) {
    for (const t of this.#times(row)) if (Math.abs(this.#x(t) - x) <= 7) return t;
    return null;
  }

  #keysOf(row, t) {
    const tracks = this.o.tracks(), out = [];
    for (const n of row.names) { const k = keyAt(tracks[n] || [], t); if (k) out.push({ track: n, key: k }); }
    return out;
  }

  #down(e) {
    if (e.button !== 0) return;
    const [x, y] = this.#pos(e);
    try { this.cv.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
    if (y < RULER) { this.drag = { kind: 'scrub' }; this.o.scrub(Math.max(0, Math.min(this.o.duration(), this.#t(Math.max(LW, x))))); return; }
    const row = this.#rowAt(y);
    if (!row) return;
    if (x < LW) {
      if (row.kind === 'group') { if (this.open.has(row.title)) this.open.delete(row.title); else this.open.add(row.title); }
      else if (row.kind === 'bone') this.o.pick(row.bone);
      this.draw();
      return;
    }
    const t = this.#hit(row, x);
    if (t != null) {
      const keys = this.#keysOf(row, t);
      const already = keys.length && keys.every((k) => this.sel.some((s) => s.key === k.key));
      if (e.shiftKey) { for (const k of keys) { const i = this.sel.findIndex((s) => s.key === k.key); if (i >= 0) this.sel.splice(i, 1); else this.sel.push(k); } }
      else if (!already) this.sel = keys;
      if (row.kind === 'bone') this.o.pick(row.bone);
      this.o.scrub(t);
      this.drag = { kind: 'move', from: t, x0: x, moved: false, orig: this.sel.map((s) => s.key.t) };
    } else {
      if (!e.shiftKey) this.sel = [];
      if (row.kind === 'bone') this.o.pick(row.bone);
      this.drag = { kind: 'scrub' };
      this.o.scrub(Math.max(0, Math.min(this.o.duration(), this.#t(x))));
    }
    this.draw();
  }

  #move(e) {
    if (!this.drag) return;
    const [x] = this.#pos(e), d = this.drag;
    if (d.kind === 'scrub') { this.o.scrub(Math.max(0, Math.min(this.o.duration(), this.#t(Math.max(LW, x))))); return; }
    if (Math.abs(x - d.x0) < 3 && !d.moved) return;
    d.moved = true;
    const snap = e.shiftKey ? 0.05 : 0.01, dt = Math.round((this.#t(x) - this.#t(d.x0)) / snap) * snap;
    const lo = Math.min(...d.orig), hi = Math.max(...d.orig), dur = this.o.duration();
    const shift = Math.max(-lo, Math.min(dur - hi, dt));
    this.sel.forEach((s, i) => { s.key.t = +(d.orig[i] + shift).toFixed(3); });
    this.o.scrub(+(d.from + shift).toFixed(3), true);
    this.draw();
  }

  #up() {
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'move' && d.moved) {
      // keep each track in time order, and drop a key that landed on top of another in the same track
      const tracks = this.o.tracks();
      for (const n of new Set(this.sel.map((s) => s.track))) {
        const list = tracks[n];
        list.sort((a, b) => a.t - b.t);
        for (let i = list.length - 1; i > 0; i--) if (Math.abs(list[i].t - list[i - 1].t) < 0.0015) { const dead = this.sel.some((s) => s.key === list[i - 1]) ? i : i - 1; this.sel = this.sel.filter((s) => s.key !== list[dead]); list.splice(dead, 1); }
      }
      this.o.changed('moved');
    }
    this.draw();
  }

  #dbl(e) {
    const [x, y] = this.#pos(e);
    if (x < LW || y < RULER) return;
    const row = this.#rowAt(y);
    if (!row || this.#hit(row, x) != null) return;
    const t = +(Math.round(Math.max(0, Math.min(this.o.duration(), this.#t(x))) * 100) / 100).toFixed(3);   // snapped to a hundredth
    const names = row.kind === 'all' ? null : row.kind === 'group' ? this.o.groups.find(([ti]) => ti === row.title)[1] : row.names;
    this.o.add(names, t);
    this.draw();
  }

  #wheel(e) {
    e.preventDefault();
    const [x] = this.#pos(e);
    if (e.ctrlKey || e.metaKey) {
      const at = this.#t(Math.max(LW, x)), old = this.zoom;
      this.zoom = Math.max(1, Math.min(16, this.zoom * (e.deltaY > 0 ? 0.87 : 1.15)));
      this.pan = Math.max(0, Math.min(this.o.duration() - this.#span, at - (at - this.pan) * (old / this.zoom)));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.pan = Math.max(0, Math.min(this.o.duration() - this.#span, this.pan + (e.deltaX || e.deltaY) / (this.cv.clientWidth - LW) * this.#span));
    } else this.scroll += e.deltaY > 0 ? 1 : -1;
    this.draw();
  }

  // ------------------------------------------------------------ editing the selection
  #setEase(name, custom) {
    const v = name === '' ? null : name === 'custom' ? (custom || this.hs.map((i) => +i.value || 0)) : EASES[name];
    for (const s of this.sel) { if (v == null) delete s.key.e; else s.key.e = Array.isArray(v) ? v.slice() : v; }
    this.o.changed('curve');
    this.draw();
  }

  deleteSelected() {
    if (!this.sel.length) return false;
    const tracks = this.o.tracks();
    for (const s of this.sel) { const list = tracks[s.track], i = list ? list.indexOf(s.key) : -1; if (i >= 0) list.splice(i, 1); }
    for (const n of Object.keys(tracks)) if (!tracks[n].length) delete tracks[n];
    this.sel = [];
    this.o.changed('deleted');
    this.draw();
    return true;
  }

  clearSelection() { this.sel = []; }
}
