// The backpack and the quick bar.
//
// The pack holds what you carry (24 slots); the bar at the bottom of the screen holds five of those items as quick picks.
// [1]-[5] choose a slot, [T] steps through them (and then to bare hands), and the pack ([Tab]) is where you drag an item from
// the grid onto a bar slot, or drag bar slots around to reorder them (drag one off the bar to clear it). The bar holds
// references, not copies: the item stays in the pack. Pure data lives in `Inventory`; the DOM is `InventoryUI`.

export const PACK = 24, BAR = 5;

const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

/** kind: tool (held, swung or placed), water (a container), treat (what you clean water with), stuff (carried, not a quick pick). */
export const ITEMS = {
  axe: { name: 'Axe', kind: 'tool', tip: 'Fell trees and saw firewood. [Click] to swing.', icon: svg('<path d="M6 20L15.5 8.5"/><path d="M12.5 6.5c2.8-2.2 5.6-1.8 7 .3l-1.8 3.6c-2.4 1-4.6.4-6-1.6z"/>') },
  machete: { name: 'Machete', kind: 'tool', tip: 'Cut brush and small trees. [Click] to swing.', icon: svg('<path d="M9 16L19.5 4.5 18 12l-8 7.5z"/><path d="M9 16l-4.5 4.5"/>') },
  fireworks: { name: 'Fireworks', kind: 'tool', tip: 'Mortar tubes. [Click] set one down, [R] light, [I] style.', icon: svg('<path d="M12 2.5c3.2 3 3.6 8.2 0 12.5-3.6-4.3-3.2-9.5 0-12.5z"/><path d="M9 15.5l-2.5 4M15 15.5l2.5 4M12 15v6"/>') },
  mind: { name: 'Telekinesis', kind: 'tool', tip: 'Lift and reshape the ground. [Click] lift, [R] sink, [E] level.', icon: svg('<path d="M2.5 12C5.5 7 9 5 12 5s6.500 2 9.500 7c-3 5-6.500 7-9.500 7S5.500 17 2.500 12z"/><circle cx="12" cy="12" r="3"/>') },
  canteen: { name: 'Canteen', kind: 'water', tip: 'A one-quart steel canteen. [Y] drink, [U] fill at water.', icon: svg('<path d="M10 2.500h4v3h-4z"/><path d="M8.500 5.500h7c1.400 0 2.500 1.100 2.500 2.500v10.500c0 1.700-1.300 3-3 3H9c-1.700 0-3-1.300-3-3V8c0-1.400 1.100-2.500 2.500-2.500z"/><path d="M6.500 10h11"/>') },
  bladder: { name: 'Bladder', kind: 'water', tip: 'A 2 L hydration bladder with a drinking hose.', icon: svg('<path d="M7 6h9l2 3v11H7z"/><path d="M11.500 6V3.500h3V6"/><path d="M18 11c3 .5 3 5 0 5.500"/>') },
  pot: { name: 'Cooking pot', kind: 'water', tip: 'Fill it at the water, carry it to a lit fire and boil it.', icon: svg('<path d="M5 10h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M3 11.500h2M19 11.500h2M7.500 7.500h9"/><path d="M12 3.500c-1 1 1 1.500 0 3"/>') },
  straw: { name: 'LifeStraw', kind: 'water', tip: 'Drink straight from a stream or lake through a 0.2 micron filter.', icon: svg('<path d="M5 19L19 5"/><path d="M15.500 4.500l4 4"/><path d="M4 20l1.500-3"/>') },
  pump: { name: 'Pump filter', kind: 'treat', tip: '[U] pumps the water in your bottle through a ceramic filter.', icon: svg('<path d="M12 2.500v8M8 2.500h8"/><path d="M9 10.500h6V19H9z"/><path d="M4.500 17H9M15 17h4.500"/>') },
  iodine: { name: 'Iodine tablets', kind: 'treat', tip: '[U] drops tablets in your bottle. About an hour to work.', icon: svg('<path d="M9 2.500h6v3H9z"/><path d="M8 5.500h8V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"/><path d="M8 12h8"/>') },
  radio: { name: 'Handheld radio', kind: 'gear', tip: 'Hold [Click] to talk to a friend who is too far to hear you. They need a radio in their pack too. Hills in the way make it crackle.', icon: svg('<rect x="7" y="8" width="10" height="14" rx="2"/><path d="M14 8V2.5M9.500 12h5M9.500 15.500h5M9.500 18.500h5"/>') },
  poser: { name: 'Pose editor', kind: 'dev', tip: 'Developer tool: pose a character bone by bone, key the poses on a timeline and save them as an animation. [F3] also opens it.', icon: svg('<circle cx="12" cy="5" r="2.200"/><path d="M12 8v6M6.500 10.500L12 9l5.500 1.500M12 14l-3.500 7M12 14l3.500 7"/>') },
  builder: { name: 'World builder', kind: 'dev', tip: 'Developer tool: fly, place trees, rocks, cars, signs and camp props, move them with a gizmo, erase, and sculpt the ground with telekinesis. [F2] also opens it.', icon: svg('<path d="M12 2.5l8 4.500v9L12 21l-8-5v-9z"/><path d="M4 7l8 4.500L20 7M12 11.500V21"/>') },
  firewood: { name: 'Firewood', kind: 'stuff', tip: 'Logs for the fire. [J] drops them.', icon: svg('<ellipse cx="7" cy="16" rx="2.500" ry="3"/><path d="M7 13h11a2.500 3 0 0 1 0 6H7"/><ellipse cx="10" cy="8" rx="2.500" ry="3"/><path d="M10 5h8a2.500 3 0 0 1 0 6h-8"/>') },
};

const START_PACK = ['axe', 'machete', 'fireworks', 'mind', 'canteen', 'bladder', 'pot', 'straw', 'pump', 'iodine', 'radio'];
const START_BAR = ['axe', 'machete', 'fireworks', 'mind', 'canteen'];

export class Inventory {
  constructor({ dev = false } = {}) { this.dev = dev; this.reset(); }

  /** Developer builds carry the world builder (opens the editor, src/editor.js). */
  #devItems() {
    if (!this.has('radio')) { const f = this.pack.indexOf(null); if (f >= 0) this.pack[f] = { id: 'radio', n: 1 }; }     // older saves get the radio too
    if (!this.dev) return;
    for (const id of ['builder', 'poser']) {
      if (this.has(id)) continue;
      const free = this.pack.indexOf(null);
      if (free >= 0) this.pack[free] = { id, n: 1 };
    }
  }

  reset() {
    this.pack = Array(PACK).fill(null);
    START_PACK.forEach((id, i) => { this.pack[i] = { id, n: 1 }; });
    this.bar = Array(BAR).fill(null);
    START_BAR.forEach((id, i) => { this.bar[i] = id; });
    this.sel = -1;                                   // -1: bare hands
    this.#devItems();
  }

  has(id) { return this.pack.some((s) => s && s.id === id && s.n > 0); }
  /** The item in the selected slot, or null for bare hands (or an item you no longer have). */
  get id() { const id = this.sel >= 0 ? this.bar[this.sel] : null; return id && this.has(id) ? id : null; }

  select(i) { this.sel = i === this.sel ? -1 : i; }

  /** [T]: the next filled slot, then bare hands, then the first again. */
  next() {
    const order = [];
    for (let i = 0; i < BAR; i++) if (this.bar[i] && this.has(this.bar[i])) order.push(i);
    order.push(-1);
    this.sel = order[(order.indexOf(this.sel) + 1) % order.length];
  }

  /** Stacks that the game owns: set their count, add them to the first free slot, or take them out when empty. */
  sync(counts) {
    let changed = false;
    for (const [id, n] of Object.entries(counts)) {
      const at = this.pack.findIndex((s) => s && s.id === id);
      if (n > 0) {
        if (at >= 0) { if (this.pack[at].n !== n) { this.pack[at].n = n; changed = true; } }
        else { const free = this.pack.indexOf(null); if (free >= 0) { this.pack[free] = { id, n }; changed = true; } }
      } else if (at >= 0) { this.pack[at] = null; changed = true; }
    }
    return changed;
  }

  /** Move things around: from/to are { k: 'p' | 'h', i }. */
  move(from, to) {
    if (!to) { if (from.k === 'h') this.bar[from.i] = null; return; }
    if (from.k === 'p' && to.k === 'p') { [this.pack[from.i], this.pack[to.i]] = [this.pack[to.i], this.pack[from.i]]; return; }
    if (from.k === 'h' && to.k === 'h') { [this.bar[from.i], this.bar[to.i]] = [this.bar[to.i], this.bar[from.i]]; return; }
    if (from.k === 'h' && to.k === 'p') { this.bar[from.i] = null; return; }
    // pack -> bar: the item goes on the bar once; one already there swaps places with the one it replaces
    const id = this.pack[from.i]?.id;
    if (!id || ITEMS[id].kind === 'stuff') return;
    const was = this.bar.indexOf(id);
    if (was >= 0) this.bar[was] = this.bar[to.i];
    this.bar[to.i] = id;
  }

  save() { return { p: this.pack.map((s) => (s ? [s.id, s.n] : null)), b: this.bar, s: this.sel }; }
  load(d) {
    this.reset();
    if (!d) return;
    if (Array.isArray(d.p)) { this.pack = Array(PACK).fill(null); d.p.slice(0, PACK).forEach((s, i) => { if (s && ITEMS[s[0]]) this.pack[i] = { id: s[0], n: s[1] || 1 }; }); }
    if (Array.isArray(d.b)) this.bar = Array.from({ length: BAR }, (_, i) => (ITEMS[d.b[i]] ? d.b[i] : null));
    this.sel = Number.isInteger(d.s) && d.s >= -1 && d.s < BAR ? d.s : -1;
    this.#devItems();
  }
}

// ------------------------------------------------------------------ the screen

export class InventoryUI {
  /** hooks: { select(i), describe(id) -> string, badge(id) -> string, changed() } */
  constructor(inv, hooks) {
    this.inv = inv; this.hooks = hooks; this.open = false; this.drag = null; this.held = null; this.nameT = 0;
    const hud = document.getElementById('hud');
    this.bar = document.createElement('div');
    this.bar.id = 'hotbar';
    hud.appendChild(this.bar);
    this.name = document.createElement('div');
    this.name.id = 'hotbar-name';
    hud.appendChild(this.name);
    this.panel = document.createElement('div');
    this.panel.id = 'inventory';
    this.panel.className = 'glass hidden';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Pack');
    this.panel.innerHTML = '<div class="kicker">Pack</div><div id="inv-grid"></div><div id="inv-info"><b></b><span></span></div><p class="inv-help">Drag an item onto a slot of the bar below to keep it close. Drag a bar slot off the bar to clear it. [Tab] closes.</p>';
    document.body.appendChild(this.panel);
    this.grid = this.panel.querySelector('#inv-grid');
    this.info = this.panel.querySelector('#inv-info');
    for (let i = 0; i < PACK; i++) this.grid.appendChild(this.#slot('p', i));
    for (let i = 0; i < BAR; i++) this.bar.appendChild(this.#slot('h', i));
    for (const el of [this.panel, this.bar]) {
      el.addEventListener('pointerdown', (e) => this.#down(e));
      el.addEventListener('pointerover', (e) => this.#hover(e));
    }
    window.addEventListener('pointermove', (e) => this.#move(e));
    window.addEventListener('pointerup', (e) => this.#up(e));
    this.render();
  }

  #slot(k, i) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.k = k; el.dataset.i = i;
    if (k === 'h') { const n = document.createElement('span'); n.className = 'num'; n.textContent = i + 1; el.appendChild(n); }
    const ic = document.createElement('div'); ic.className = 'ic'; el.appendChild(ic);
    const ct = document.createElement('span'); ct.className = 'ct'; el.appendChild(ct);
    return el;
  }

  #idAt(k, i) { return k === 'p' ? this.inv.pack[i]?.id : this.inv.bar[i] && this.inv.has(this.inv.bar[i]) ? this.inv.bar[i] : null; }

  render() {
    const inv = this.inv;
    for (const el of [...this.grid.children, ...this.bar.children]) {
      const k = el.dataset.k, i = +el.dataset.i, id = this.#idAt(k, i);
      const ic = el.querySelector('.ic'), ct = el.querySelector('.ct');
      const art = id ? (ITEMS[id].img ? `<img src="${ITEMS[id].img}" alt="" draggable="false">` : ITEMS[id].icon) : '';
      if (ic.dataset.id !== (id ? id + (ITEMS[id].img ? '+' : '') : '')) { ic.innerHTML = art; ic.dataset.id = id ? id + (ITEMS[id].img ? '+' : '') : ''; }
      const stack = k === 'p' && inv.pack[i] && inv.pack[i].n > 1 ? `×${inv.pack[i].n}` : '';
      ct.textContent = stack || (id ? this.hooks.badge(id) : '');
      el.classList.toggle('empty', !id);
      el.classList.toggle('on', k === 'h' && inv.sel === i);
      el.classList.toggle('held', !!this.held && this.held.k === k && this.held.i === i);
      el.classList.toggle('onbar', k === 'p' && !!id && inv.bar.includes(id));
      el.title = id ? ITEMS[id].name : '';
    }
  }

  /** The name over the bar for a moment after you choose. */
  flash(text) {
    this.name.textContent = text;
    this.name.classList.add('show');
    clearTimeout(this.nameT);
    this.nameT = setTimeout(() => this.name.classList.remove('show'), 1800);
  }

  setOpen(on) {
    this.open = on;
    this.panel.classList.toggle('hidden', !on);
    document.body.classList.toggle('inv-open', on);
    this.held = null;
    this.#clearDrag();
    this.render();
  }

  #hover(e) {
    const el = e.target.closest?.('.slot');
    const id = el ? this.#idAt(el.dataset.k, +el.dataset.i) : null;
    const [b, s] = this.info.children;
    b.textContent = id ? ITEMS[id].name : '';
    s.textContent = id ? `${ITEMS[id].tip}  ${this.hooks.describe(id)}` : '';
  }

  #down(e) {
    if (e.button > 0) return;
    const el = e.target.closest('.slot');
    if (!el) return;
    if (!this.open) { if (el.dataset.k === 'h') this.hooks.select(+el.dataset.i); return; }      // a tap on the bar picks the slot
    const at = { k: el.dataset.k, i: +el.dataset.i };
    if (this.held) {                                  // click-to-place after a click-to-pick
      const from = this.held; this.held = null;
      if (from.k !== at.k || from.i !== at.i) { this.inv.move(from, at); this.hooks.changed(); }
      this.render();
      return;
    }
    if (!this.#idAt(at.k, at.i)) return;
    this.drag = { ...at, x: e.clientX, y: e.clientY, moved: false, ghost: null };
    e.preventDefault();
  }

  #move(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      d.moved = true;
      d.ghost = document.createElement('div');
      d.ghost.className = 'slot ghost';
      { const it = ITEMS[this.#idAt(d.k, d.i)]; d.ghost.innerHTML = `<div class="ic">${it.img ? `<img src="${it.img}" alt="" draggable="false">` : it.icon}</div>`; }
      document.body.appendChild(d.ghost);
    }
    if (d.ghost) { d.ghost.style.left = `${e.clientX}px`; d.ghost.style.top = `${e.clientY}px`; }
  }

  #up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost?.remove();
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 6) { this.held = { k: d.k, i: d.i }; this.render(); return; }      // a click: now click where it goes
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.slot');
    const to = el ? { k: el.dataset.k, i: +el.dataset.i } : null;
    if (to && to.k === d.k && to.i === d.i) { this.render(); return; }
    if (!to && d.k === 'p') { this.render(); return; }                           // dropped a pack item on nothing: it stays
    this.inv.move({ k: d.k, i: d.i }, to);
    this.hooks.changed();
    this.render();
  }

  #clearDrag() { this.drag?.ghost?.remove(); this.drag = null; }
}
