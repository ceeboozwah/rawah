import * as THREE from 'three';
import { Character, CHARACTERS } from './character.js';
import { ACTIONS } from './hiker.js';
import { buildRadio } from './gear.js';

// Playing together, in the browser. One person starts a shared game and gets a six-character code; friends open the game, pick
// their hiker on the title screen, type the code and appear in the same valley. Everyone is connected to everyone (a mesh, fine
// for a handful of friends) over WebRTC with PeerJS: the free PeerJS cloud broker only introduces the browsers, after that the
// positions and the voices go straight between them.
//
//  CODE     the host's peer id is `rawah-` + the code. A guest connects to the host, who answers with a welcome (who is here, the
//           host's time of day, weather, season and position); the guest then connects to each of the others, so the one who
//           arrives last does all the dialling (data connection plus a voice call each).
//  STATE    10 times a second each player sends where they are and what their body is doing (mode, stance, speed, an action in
//           progress, the tool in hand). A remote hiker is a `Character`, posed from a `Body` that those numbers fill in, with a
//           name above its head; its position is eased between packets.
//  VOICE    the microphone (getUserMedia: the browser asks the player; refused, the player can still listen) goes out as a
//           WebRTC audio call. Each incoming voice is placed in the world with a panner at that hiker, full volume within 6 m and
//           fading to nothing at 150 m. With a handheld radio in the pack, a friend who holds the push-to-talk button is also heard over the
//           radio from far away (see RADIO below). A friend who is talking lights their name.
//  NOT SHARED  the world is each browser's own copy: time and weather are the host's, but felled trees, fires, tents and
//           sculpted ground are not. The browsers need a way to reach each other (public STUN only: some strict networks would
//           need a TURN relay), and the microphone needs https or localhost.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const makeCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const idOf = (code) => `rawah-${code}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Where friends open the game. Hosting from a copy on your own computer still works: the guests load the public one. */
export const PUBLIC_URL = 'https://ceeboozwah.github.io/rawah/';
const isLocal = () => /^(localhost|127\.|\[::1\]|10\.|192\.168\.)/.test(location.hostname) || location.hostname.endsWith('.local');
export const inviteLink = (code) => `${isLocal() ? PUBLIC_URL : `${location.origin}${location.pathname}`}?join=${code}`;
const RATE = 0.1;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- the handheld radio
// A radio carries a voice a long way, so it reaches where the proximity voice has faded away: up to about 7 km, clear inside 1.2 km,
// quieter and hissier past that, and half as strong with a ridge in the way. It sounds like one: the voice is squeezed into the
// 380 to 3000 Hz a small speaker gives, lifted in the mids, pushed through a light tanh clipper and a fast compressor, with a hiss
// under it that grows as the signal weakens, a click when the other person keys up, and a squelch tail and a beep when they let go.
const RADIO = { near: 12, clear: 1200, far: 7000, band: [380, 3000] };
const driveCurve = (k) => { const c = new Float32Array(2048); for (let i = 0; i < c.length; i++) { const x = (i / (c.length - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; };

/** The radio's voice processing: input -> speaker band -> mids -> clipper -> compressor -> output. */
export function radioChain(ctx) {
  const input = ctx.createGain(); input.gain.value = 1.6;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = RADIO.band[0]; hp.Q.value = 0.8;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = RADIO.band[1]; lp.Q.value = 0.9;
  const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1800; pk.gain.value = 4; pk.Q.value = 0.9;
  const ws = ctx.createWaveShaper(); ws.curve = driveCurve(1.5); ws.oversample = '2x';
  const cmp = ctx.createDynamicsCompressor(); cmp.threshold.value = -24; cmp.knee.value = 10; cmp.ratio.value = 5; cmp.attack.value = 0.003; cmp.release.value = 0.12;
  const output = ctx.createGain(); output.gain.value = 0.55;
  input.connect(hp); hp.connect(lp); lp.connect(pk); pk.connect(ws); ws.connect(cmp); cmp.connect(output);
  return { input, output };
}                  // seconds between state packets
const RANGE = { full: 6, none: 150 };

class Body {
  constructor() {
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.mode = 'walk'; this.stance = 'stand'; this.grounded = true;
    this.action = null; this.recover = 0; this.sliding = false; this.injured = 0; this.resting = false;
    this.stamina = 100; this.flip = false; this.wallUp = { x: 0, y: 0 }; this.climbSpeed = 0;
    this.face = false; this.emote = ''; this.lookAt = null;
  }
}

/** A name above a hiker's head; it lights while they talk. */
function makeLabel(name) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  sprite.scale.set(1.9, 0.475, 1);
  sprite.renderOrder = 20;
  let last = '';
  return {
    sprite,
    draw(speaking, muted) {
      const key = `${name}|${speaking}|${muted}`;
      if (key === last) return;
      last = key;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, 256, 64);
      g.font = "400 30px 'Paytone One', sans-serif";
      const w = g.measureText(name).width + 38;
      const x = (256 - w) / 2;
      g.fillStyle = 'rgba(10,13,18,0.72)';
      g.beginPath(); g.roundRect(x, 10, w, 44, 22); g.fill();
      if (speaking) { g.strokeStyle = '#f6d3bd'; g.lineWidth = 3; g.stroke(); }
      g.fillStyle = speaking ? '#f6d3bd' : '#8fb1d6';
      g.beginPath(); g.arc(x + 20, 32, 6, 0, 6.3); g.fill();
      g.fillStyle = '#fff';
      g.textBaseline = 'middle';
      g.fillText(name, x + 34, 33);
      tex.needsUpdate = true;
    },
  };
}

class Remote {
  constructor(net, id, info) {
    this.net = net; this.id = id; this.name = info.name || 'Friend'; this.character = CHARACTERS[info.character] ? info.character : 'blaize';
    this.b = new Body();
    this.char = new Character(net.scene, this.character, { lib: net.lib, placeholder: false, firstPerson: false });
    this.target = null;
    this.label = makeLabel(this.name);
    net.scene.add(this.label.sprite);
    this.speaking = false; this.voice = null; this.lastAct = -1;
    this.ptt = false; this.radioObj = null; this.sig = { q: 0, d: 0, next: 0 };
  }

  /** The newest state packet. */
  apply(s) {
    this.target = s;
    if (!this.placed) { this.b.pos.set(s.x, s.y, s.z); this.b.yaw = s.yaw; this.placed = true; }
    if (s.a && s.a[1] !== this.lastAct) {
      this.lastAct = s.a[1];
      const spec = ACTIONS[s.a[0]];
      if (spec) this.b.action = { id: -s.a[1], kind: s.a[0], t: 0, dur: spec.dur, hits: spec.hits, slow: 0 };
    }
  }

  update(dt) {
    const t = this.target, b = this.b;
    if (!t) return;
    const k = 1 - Math.exp(-12 * dt);
    if (Math.hypot(t.x - b.pos.x, t.z - b.pos.z) > 25) b.pos.set(t.x, t.y, t.z);
    else { b.pos.x += (t.x - b.pos.x) * k; b.pos.z += (t.z - b.pos.z) * k; b.pos.y += (t.y - b.pos.y) * k; }
    b.vel.set(t.vx, 0, t.vz);
    let dy = t.yaw - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    b.yaw += dy * k;
    b.pitch = t.pitch;
    b.mode = t.m; b.stance = t.s; b.grounded = t.g; b.sliding = t.sl; b.resting = t.re; b.flip = t.f; b.climbSpeed = t.cs;
    b.wallUp.x = t.wx; b.wallUp.y = t.wy; b.emote = t.em || '';
    if (b.action) { b.action.t += dt; if (b.action.t >= b.action.dur) b.action = null; }
    if (this.char.tool !== t.tl && t.tl) this.char.setTool(t.tl);
    // a friend talking on the radio holds it up
    if (this.ptt && !this.radioObj) this.radioObj = buildRadio();
    this.char.setItem?.(this.ptt ? this.radioObj : null);
    this.char.update(dt, b);
    this.label.sprite.position.set(b.pos.x, b.pos.y + 2.25, b.pos.z);
    this.label.draw(this.speaking, false);
  }

  dispose() {
    this.net.scene.remove(this.label.sprite);
    this.label.sprite.material.map?.dispose();
    const c = this.char;
    c.update = () => {};
    const drop = () => { const r = c.group || c.root; if (c.group) { c.group.parent?.remove(c.group); return true; } return !r; };
    if (!drop()) { const t = setInterval(() => { if (drop()) clearInterval(t); }, 500); }
    this.voice?.stop();
  }
}

export class Net {
  /**
   * ctx: { scene, world, lib, toast(text, kind), me() -> { name, character }, snapshot() -> the local hiker's state,
   *        onWelcome(w) -> void, onTime({ hour, day }) }
   */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.peer = null; this.code = ''; this.host = false;
    this.conns = new Map();       // peer id -> data connection
    this.remotes = new Map();     // peer id -> Remote
    this.pending = new Map();     // peer id -> voice stream that arrived before the hello
    this.stream = null; this.audio = null;
    this.micOn = false; this.micError = ''; this.ptt = false; this.noise = null;
    this.acc = 0; this.timeAcc = 0; this.actId = 0; this.lastAct = null;
    this.listeners = new Set();
    this.#ui();
  }

  get connected() { return !!this.peer && !!this.code; }
  get players() { return [...this.remotes.values()]; }
  onChange(f) { this.listeners.add(f); }
  #changed() { this.#render(); for (const f of this.listeners) f(); }

  // ------------------------------------------------------------------ setting up
  async #audioAndMic() {
    if (this.audio) { this.audio.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.audio = new AC();
    this.audio.resume?.();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'InsecureOrigin' });
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.micOn = true;
    } catch (e) {
      // listen-only: a silent track stands in so the call still connects
      this.micError = e.name === 'NotAllowedError' ? 'denied' : e.name === 'InsecureOrigin' ? 'insecure' : 'unavailable';
      this.stream = this.audio.createMediaStreamDestination().stream;
      this.micOn = false;
      this.toast?.(this.micError === 'denied' ? 'Microphone blocked: you can hear friends but they cannot hear you. Allow it in the browser\'s address bar to talk.' : this.micError === 'insecure' ? 'The microphone needs https or localhost. You can still hear friends.' : 'No microphone found. You can still hear friends.', 'warn');
    }
  }

  #open(id) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) { reject(Object.assign(new Error('no peerjs'), { type: 'nolib' })); return; }
      const p = new window.Peer(id, { debug: 0 });
      const to = setTimeout(() => { p.destroy(); reject(Object.assign(new Error('timeout'), { type: 'timeout' })); }, 12000);
      p.on('open', () => { clearTimeout(to); resolve(p); });
      p.on('error', (e) => { clearTimeout(to); reject(e); });
    });
  }

  #wire(peer) {
    this.peer = peer;
    peer.on('connection', (conn) => this.#accept(conn));
    peer.on('call', (call) => {
      call.answer(this.stream);
      call.on('stream', (s) => this.#voice(call.peer, s));
    });
    peer.on('error', (e) => { if (e.type !== 'peer-unavailable') this.toast?.(`Connection problem: ${e.type || e.message}`, 'warn'); });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* gone */ } });
  }

  async startHost() {
    if (this.connected) return this.code;
    try {
      await this.#audioAndMic();
      let peer = null, code = '';
      for (let i = 0; i < 6 && !peer; i++) {
        code = makeCode();
        try { peer = await this.#open(idOf(code)); } catch (e) { if (e.type !== 'unavailable-id') throw e; }
      }
      if (!peer) throw new Error('no code free');
      this.#wire(peer);
      this.code = code; this.host = true;
      this.toast?.(`Your game is open. Friends join with the code ${code}.`);
      this.#changed();
      return code;
    } catch (e) {
      this.toast?.(e.type === 'nolib' ? 'The multiplayer library did not load.' : e.type === 'timeout' ? 'Could not reach the connection broker. Check your network.' : `Could not start a shared game (${e.type || e.message}).`, 'warn');
      this.leave();
      return '';
    }
  }

  async join(codeIn) {
    const code = normCode(codeIn);
    if (code.length !== 6) { this.toast?.('A game code is six letters and numbers.', 'warn'); return false; }
    if (this.connected) this.leave();
    try {
      await this.#audioAndMic();
      const peer = await this.#open(undefined);
      this.#wire(peer);
      this.code = code; this.host = false;
      const conn = peer.connect(idOf(code), { reliable: true });
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(Object.assign(new Error('timeout'), { type: 'peer-unavailable' })), 12000);
        conn.on('open', () => { clearTimeout(to); resolve(); });
        peer.on('error', (e) => { if (e.type === 'peer-unavailable') { clearTimeout(to); reject(e); } });
      });
      this.#accept(conn, true);
      this.#hello(conn);
      this.#changed();
      return true;
    } catch (e) {
      this.toast?.(e.type === 'peer-unavailable' ? `No game with the code ${code}. Check it with your friend.` : e.type === 'nolib' ? 'The multiplayer library did not load.' : 'Could not reach that game. Check your network.', 'warn');
      this.leave();
      return false;
    }
  }

  leave() {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear(); this.conns.clear(); this.pending.clear();
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.peer = null; this.code = ''; this.host = false; this.ptt = false;
    if (this.stream && this.micOn) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null; this.micOn = false; this.micError = '';
    try { this.audio?.close(); } catch { /* closed */ }
    this.audio = null;
    this.#changed();
  }

  // ------------------------------------------------------------------ talking to the others
  #hello(conn) {
    const me = this.me();
    conn.send({ t: 'hello', id: this.peer.id, name: me.name, character: me.character });
  }

  #accept(conn, outgoing = false) {
    const id = conn.peer;
    this.conns.set(id, conn);
    const ready = () => {
      conn.on('data', (d) => this.#msg(conn, d));
      conn.on('close', () => this.#gone(id));
      conn.on('error', () => this.#gone(id));
    };
    if (outgoing || conn.open) ready(); else conn.on('open', ready);
  }

  #gone(id) {
    const r = this.remotes.get(id);
    this.conns.delete(id); this.remotes.delete(id); this.pending.delete(id);
    if (r) { this.toast?.(`${r.name} left.`); r.dispose(); this.#changed(); }
  }

  #msg(conn, d) {
    if (!d || typeof d !== 'object') return;
    const id = conn.peer;
    if (d.t === 'hello') {
      this.#addRemote(id, d);
      if (this.host) {
        // tell the newcomer who is here and what time it is; they dial the others themselves
        const others = [...this.remotes.values()].filter((r) => r.id !== id).map((r) => ({ id: r.id, name: r.name, character: r.character }));
        const me = this.me();
        conn.send({ t: 'welcome', players: [{ id: this.peer.id, name: me.name, character: me.character }, ...others], ...this.welcomeInfo() });
      }
    } else if (d.t === 'welcome') {
      const hostInfo = d.players.find((p) => p.id === id);
      if (hostInfo) this.#addRemote(id, hostInfo);
      const call = this.peer.call(id, this.stream);          // the host's voice
      call?.on('stream', (s) => this.#voice(id, s));
      for (const p of d.players) if (p.id !== this.peer.id && p.id !== id) this.#dial(p);
      this.onWelcome?.(d, this.code);
    } else if (d.t === 's') {
      this.remotes.get(id)?.apply(d);
    } else if (d.t === 'ptt') {
      const r = this.remotes.get(id);
      if (r) r.ptt = !!d.on;
    } else if (d.t === 'time' && id === idOf(this.code)) {
      this.onTime?.(d);
    }
  }

  welcomeInfo() { return this.info ? this.info() : {}; }

  /** The newer player calls an older one: a data connection and a voice call. */
  #dial(p) {
    if (this.conns.has(p.id)) return;
    const conn = this.peer.connect(p.id, { reliable: true });
    this.#accept(conn);
    conn.on('open', () => {
      this.#hello(conn);
      const call = this.peer.call(p.id, this.stream);
      call?.on('stream', (s) => this.#voice(p.id, s));
    });
    this.#addRemote(p.id, p);
  }

  #addRemote(id, info) {
    let r = this.remotes.get(id);
    if (r && r.character === (CHARACTERS[info.character] ? info.character : r.character) && r.name === (info.name || r.name)) return r;
    if (r) r.dispose();
    r = new Remote(this, id, info);
    this.remotes.set(id, r);
    const s = this.pending.get(id);
    if (s) { this.pending.delete(id); this.#voice(id, s); }
    this.toast?.(`${r.name} joined.`);
    this.#changed();
    return r;
  }

  // ------------------------------------------------------------------ voices
  #voice(id, stream) {
    const r = this.remotes.get(id);
    if (!r) { this.pending.set(id, stream); return; }
    r.voice?.stop();
    const ctx = this.audio;
    if (!ctx) return;
    // Chrome only runs a remote stream that is attached to a media element
    const el = new Audio();
    el.srcObject = stream; el.muted = true; el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 512;
    const gp = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'linear';
    panner.refDistance = RANGE.full; panner.maxDistance = RANGE.none; panner.rolloffFactor = 1;
    src.connect(an); src.connect(gp); gp.connect(panner); panner.connect(ctx.destination);
    // the radio path (silent until that friend keys up and you carry a radio) and its hiss
    const chain = radioChain(ctx), rg = ctx.createGain(); rg.gain.value = 0;
    src.connect(chain.input); chain.output.connect(rg); rg.connect(ctx.destination);
    const hiss = ctx.createBufferSource(); hiss.buffer = this.#noise(); hiss.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.45;
    const hg = ctx.createGain(); hg.gain.value = 0;
    hiss.connect(bp); bp.connect(hg); hg.connect(ctx.destination); hiss.start();
    const buf = new Uint8Array(an.fftSize);
    r.voice = {
      panner, gp, rg, hg, an, buf,
      stop() { try { src.disconnect(); gp.disconnect(); panner.disconnect(); chain.output.disconnect(); rg.disconnect(); hiss.stop(); hiss.disconnect(); bp.disconnect(); hg.disconnect(); } catch { /* gone */ } el.srcObject = null; },
    };
  }

  /** Two seconds of white noise, made once. */
  #noise() {
    if (this.noise && this.noise.sampleRate === this.audio.sampleRate) return this.noise;
    const ctx = this.audio, buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this.noise = buf);
  }

  /** A burst of static (the click of a key-up, the squelch tail) and an optional beep. */
  #squelch(len, level, beep = false) {
    const ctx = this.audio;
    if (!ctx) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
    src.buffer = this.#noise(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.5;
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t, Math.random()); src.stop(t + len + 0.02);
    if (beep) this.#beep(t + len * 0.7, 1250, 0.07, 0.07);
  }

  #beep(at, freq, dur, level) {
    const ctx = this.audio;
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'sine'; o.frequency.value = freq; lp.type = 'lowpass'; lp.frequency.value = 2400;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(level, at + 0.006); g.gain.setValueAtTime(level, at + dur - 0.012); g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(lp); lp.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + dur + 0.02);
  }

  /** Push to talk: tell the others, and chirp so you know the key is down. Only does anything while connected. */
  setPtt(on) {
    on = !!on && this.connected;
    if (on === this.ptt) return;
    this.ptt = on;
    for (const c of this.conns.values()) if (c.open) c.send({ t: 'ptt', on });
    if (this.audio) { if (on) this.#beep(this.audio.currentTime, 880, 0.06, 0.06); else this.#beep(this.audio.currentTime, 1320, 0.05, 0.05); }
  }

  /** How well a radio at `b` reaches one at `a`: 0..1, from distance and the ground between them. */
  #signal(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    let q = 1 - smooth(RADIO.clear, RADIO.far, d);
    if (q <= 0) return { q: 0, d, blocked: false };
    const n = Math.min(40, Math.ceil(d / 60)), ya = a.y + 1.7, yb = b.y + 1.7;
    let blocked = false;
    for (let i = 1; i < n && !blocked; i++) {
      const t = i / n;
      if (this.world.height(a.x + dx * t, a.z + dz * t) > ya + (yb - ya) * t) blocked = true;
    }
    return { q: blocked ? q * 0.5 : q, d, blocked };
  }

  // ------------------------------------------------------------------ every frame
  /** Send our state, ease the others to theirs, place their voices round the camera. */
  update(dt, camera) {
    if (!this.connected) return;
    for (const r of this.remotes.values()) {
      r.update(dt);
      const v = r.voice;
      if (v) {
        v.panner.positionX && (v.panner.positionX.value = r.b.pos.x, v.panner.positionY.value = r.b.pos.y + 1.6, v.panner.positionZ.value = r.b.pos.z);
        v.an.getByteTimeDomainData(v.buf);
        let s = 0;
        for (let i = 0; i < v.buf.length; i++) { const x = (v.buf[i] - 128) / 128; s += x * x; }
        const talk = Math.sqrt(s / v.buf.length) > 0.02;
        if (talk !== r.speaking) { r.speaking = talk; this.#render(); }
        // the radio: you hear a friend who is keying up when you both carry one and they are too far to hear directly
        const sig = r.sig;
        if (this.audio && performance.now() > sig.next) { sig.next = performance.now() + 250; Object.assign(sig, this.#signal(this.where ? this.where() : camera.position, r.b.pos)); }
        const rx = r.ptt && !!this.hasRadio?.() && sig.d > RADIO.near && sig.q > 0;
        const now = this.audio.currentTime;
        v.rg.gain.setTargetAtTime(rx ? sig.q : 0, now, 0.03);
        v.hg.gain.setTargetAtTime(rx ? 0.012 + (1 - sig.q) * 0.1 : 0, now, 0.05);
        if (rx !== r.rxWas) {
          if (rx) this.#squelch(0.045, 0.16);                    // their key-up: a click
          else if (r.rxWas) this.#squelch(0.17, 0.12, true);     // their key-down: the squelch tail, then the beep
          r.rxWas = rx;
        }
      }
    }
    const L = this.audio?.listener;
    if (L && L.positionX) {
      const f = camera.getWorldDirection(new THREE.Vector3());
      L.positionX.value = camera.position.x; L.positionY.value = camera.position.y; L.positionZ.value = camera.position.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    }
    this.acc += dt; this.timeAcc += dt;
    if (this.acc >= RATE) {
      this.acc = 0;
      const s = this.snapshot();
      const a = s.a;
      if (a && (!this.lastAct || this.lastAct !== a[1])) this.lastAct = a[1];
      for (const c of this.conns.values()) if (c.open) c.send({ t: 's', ...s });
    }
    if (this.host && this.timeAcc > 3) {
      this.timeAcc = 0;
      const t = this.timeNow?.();
      if (t) for (const c of this.conns.values()) if (c.open) c.send({ t: 'time', ...t });
    }
  }

  // ------------------------------------------------------------------ the panel and the roster
  #ui() {
    const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    this.panel = el('div', 'mp-modal hidden');
    this.panel.innerHTML = '<div class="mp-card glass" role="dialog" aria-label="Play with friends"></div>';
    this.card = this.panel.firstChild;
    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel) { this.closePanel(); return; }
      const b = e.target.closest('button, input');
      if (!b) return;
      if (b.dataset.a === 'host') this.startHost();
      else if (b.dataset.a === 'leave') { this.leave(); }
      else if (b.dataset.a === 'copy') { navigator.clipboard?.writeText(inviteLink(this.code)).then(() => this.toast?.('Invite link copied.')).catch(() => this.toast?.(`Send your friend the code ${this.code}.`)); }
      else if (b.dataset.a === 'mic') this.setMuted(!this.muted);
      else if (b.dataset.a === 'close') this.closePanel();
    });
    this.roster = el('div', 'mp-roster hidden');
    document.body.append(this.panel, this.roster);
    this.#render();
  }

  openPanel() { this.panel.classList.remove('hidden'); this.#render(); }
  closePanel() { this.panel.classList.add('hidden'); }

  #render() {
    if (!this.card) return;
    const me = this.me ? this.me() : { name: '', character: '' };
    const mic = !this.connected ? '' : this.micOn ? (this.muted ? 'Microphone muted' : 'Microphone on') : this.micError === 'denied' ? 'Microphone blocked (listen only)' : this.micError === 'insecure' ? 'Microphone needs https (listen only)' : 'No microphone (listen only)';
    if (!this.connected) {
      this.card.innerHTML = `<h3>Play with friends</h3>
        <p>Start a shared game and give your friends the code. They open Rawah, pick their hiker, enter the code and join you in this valley. The browser will ask to use your microphone so you can talk: allow it for voice.</p>
        <div class="mp-btns"><button data-a="close">Not now</button><button data-a="host" class="primary">Start a shared game</button></div>`;
    } else {
      this.card.innerHTML = `<h3>${this.host ? 'Your shared game' : 'Joined a shared game'}</h3>
        <div class="mp-code" aria-label="Game code">${this.code}</div>
        <p class="mp-sub">${this.host ? `Friends open ${inviteLink('').replace('?join=', '')} and enter this code, or use the invite link.` : 'You are playing with the host and their friends.'}</p>
        <ul class="mp-list"><li class="me"><b>${me.name}</b> <small>you</small></li>${this.players.map((r) => `<li class="${r.speaking ? 'talk' : ''}"><b>${r.name}</b>${r.speaking ? ' <small>talking</small>' : ''}</li>`).join('') || '<li class="none">Waiting for friends…</li>'}</ul>
        <div class="mp-row"><button data-a="mic" ${this.micOn ? '' : 'disabled'}>${this.micOn ? (this.muted ? 'Unmute mic' : 'Mute mic') : 'No mic'}</button><span class="mp-hint">Voices fade with distance. Take out your radio (pack, [Tab]) and hold [Click] to talk to far away friends.</span></div>
        <p class="mp-sub">${mic}</p>
        <div class="mp-btns">${this.host ? '<button data-a="copy">Copy invite link</button>' : ''}<button data-a="leave" class="danger">Leave</button><button data-a="close" class="primary">Done</button></div>`;
    }
    // the little roster in the corner while you are connected
    this.roster.classList.toggle('hidden', !this.connected);
    if (this.connected) {
      this.roster.innerHTML = `<b class="mp-tag">${this.code}</b>${this.players.map((r) => `<span class="${r.speaking ? 'talk' : ''}">${r.name}</span>`).join('')}<button data-r="mic" title="Microphone">${this.micOn ? (this.muted ? 'Mic off' : 'Mic on') : 'Listen'}</button>`;
      const b = this.roster.querySelector('[data-r=mic]');
      if (b) b.onclick = () => { if (this.micOn) this.setMuted(!this.muted); else this.openPanel(); };
    }
  }
}
