import * as THREE from 'three';

// Stream channels: the lidar grid is 3.6 m, far too coarse for a creek 1.6 to 2.4 m wide, so the water used to hover over the
// ground it was meant to run in. Here every stream is dug into the terrain, in the terrain and in the physics alike.
//
//  1. At load each stream gets its own water level `wy` (st.pts[i][2]): a little below the ground along its line, never uphill
//     (a spur is dug through, not climbed), smoothed. Everything that reads the level (the ribbon, wading, fishing) uses it.
//  2. Around the camera a 512 m window at 0.5 m texels holds the channel surface: a rounded bed a bit below the water, banks
//     rising steeply to the sides (steeper further out), absolute heights (`1e4` where there is no stream). The terrain and
//     grass vertex shaders take a soft minimum of the ground they already draw and this surface (`groundH` in cdlod.js), and
//     `World.height` does the same in JS, so the hiker, trees and the camera agree with the screen. Because it is a minimum
//     with the natural ground, the channel only ever cuts: no stream can leave a levee or float.
//  3. The water ribbon is exactly as wide as the water, where the banks meet the surface, and its flow speed comes from the
//     stream's own slope (about 0.2 to 1.1 m/s), not one fast constant.
// The window follows the player and is rebuilt when they have walked about 100 m; the rebuild is geometry only (distance
// to a few hundred segments), a few milliseconds.

export const CH_N = 1024, CH_C = 0.5;           // texels per side and metres per texel (the shader hard-codes both)
const NONE = 1e4;
const REACH = 11;                                // metres from the centreline the channel surface is written
const SMIN = 0.3;                                // softness of the lip where the bank meets the ground
const DEPTH = 0.38;                              // bed below the water surface at the edge of the bed
const SCOOP = 0.12;                              // extra depth at the very middle
const SLOPE = 0.85, FLARE = 0.1;                 // bank slope and how it steepens with distance

export const CHANNEL_GLSL = /* glsl */ `
uniform highp sampler2D uChTex;
uniform vec2 uChOrg;
uniform float uChOn;
vec2 chCell(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= 1024 || c.y >= 1024) return vec2(1e4);
  return texelFetch(uChTex, c, 0).rg;
}
vec2 streamBoth(vec2 xz) {
  if (uChOn < 0.5) return vec2(1e4);
  vec2 u = (xz - uChOrg) / 0.5 - 0.5;
  vec2 c = floor(u), f = u - c;
  ivec2 i = ivec2(c);
  vec2 a = chCell(i), b = chCell(i + ivec2(1, 0)), d = chCell(i + ivec2(0, 1)), e = chCell(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
float streamAt(vec2 xz) { return streamBoth(xz).x; }
float streamEdge(vec2 xz) { return streamBoth(xz).y; }   // metres from the water's edge: the bank plants read it
float chanMin(float a, float b) {
  float h = max(${SMIN.toFixed(2)} - abs(a - b), 0.0) / ${SMIN.toFixed(2)};
  return min(a, b) - h * h * ${(SMIN * 0.25).toFixed(4)};
}
float chanCut(vec2 q) {   // how far the channel lowers the lidar ground at q (for the normal)
  float nat = baseH(q) + editH(q);
  return chanMin(nat, streamAt(q)) - nat;
}
`;

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class Channels {
  constructor(world) {
    this.world = world;
    this.data = new Float32Array(CH_N * CH_N * 2).fill(NONE);     // R the channel surface, G the distance from the water's edge (negative in the water)
    this.org = { x: 0, z: 0 };
    this.has = false;
    this.tex = new THREE.DataTexture(this.data, CH_N, CH_N, THREE.RGFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.uniforms = { uChTex: { value: this.tex }, uChOrg: { value: new THREE.Vector2() }, uChOn: { value: 0 } };
    this.segs = [];
    this.#prepare();
  }

  /** Water levels, bed and bank widths and flow speeds for every stream, from the ground along it. */
  #prepare() {
    const w = this.world;
    for (const st of w.streams) {
      const p = st.pts, n = p.length;
      const nat = p.map(([x, z]) => {
        let m = w.height(x, z);
        // the thalweg is already cut into the 3.6 m grid: look a little to either side for the floodplain it runs across
        return m;
      });
      // target: a little under the ground at the line, smoothed over a few points (median-ish by a running mean of minima)
      const target = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let m = Infinity;
        for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) m = Math.min(m, nat[k]);
        target[i] = m - 0.3;
      }
      const wy = new Float32Array(n);
      wy[0] = target[0];
      for (let i = 1; i < n; i++) wy[i] = Math.min(wy[i - 1] + 0.05, Math.max(target[i], nat[i] - 3.0));     // never uphill, never a trench deeper than 3 m
      for (let pass = 0; pass < 3; pass++) for (let i = 1; i < n - 1; i++) wy[i] = Math.min(wy[i], 0.25 * wy[i - 1] + 0.5 * wy[i] + 0.25 * wy[i + 1] + 0.02);
      const wb = Math.max(0.34, st.width * 0.3);
      st.wb = wb;
      st.hw = wb + 1.05 * DEPTH / SLOPE;                  // half width of the water: where the banks come up to the surface
      st.speed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        p[i][2] = wy[i];
        const a = p[Math.max(0, i - 2)], b = p[Math.min(n - 1, i + 2)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const slope = Math.max(0, (a[2] - b[2]) / len);
        st.speed[i] = Math.min(1.1, Math.max(0.2, 0.18 + 4.5 * Math.pow(slope, 0.8)) * (st.width > 4 ? 1.2 : 1));
      }
      st.id = this.segs.length ? this.segs[this.segs.length - 1].id + 1 : 0;
      for (let i = 0; i < n - 1; i++) {
        this.segs.push({ ax: p[i][0], az: p[i][1], ay: p[i][2], bx: p[i + 1][0], bz: p[i + 1][1], by: p[i + 1][2], wb, id: st.id, along: 0 });
      }
    }
    // the world's nearest-stream lookup carries the levels too
    let k = 0;
    for (const st of w.streams) for (let i = 0; i < st.pts.length - 1; i++) {
      const s = w.streamSegs[k++];
      if (s) { s.ay = st.pts[i][2]; s.by = st.pts[i + 1][2]; }
    }
    // a spatial hash of segments for the window rebuild
    this.cellSize = 64;
    this.grid = new Map();
    this.segs.forEach((s, i) => {
      const x0 = Math.floor((Math.min(s.ax, s.bx) - REACH) / this.cellSize), x1 = Math.floor((Math.max(s.ax, s.bx) + REACH) / this.cellSize);
      const z0 = Math.floor((Math.min(s.az, s.bz) - REACH) / this.cellSize), z1 = Math.floor((Math.max(s.az, s.bz) + REACH) / this.cellSize);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const key = gx * 100003 + gz; let a = this.grid.get(key); if (!a) this.grid.set(key, a = []); a.push(i); }
    });
  }

  /** Rebuild the window when the camera has moved far from its centre. */
  update(x, z) {
    const cx = this.org.x + (CH_N * CH_C) / 2, cz = this.org.z + (CH_N * CH_C) / 2;
    if (this.has && Math.hypot(x - cx, z - cz) < 100) return false;
    const half = (CH_N * CH_C) / 2;
    this.org.x = Math.round((x - half) / 16) * 16;
    this.org.z = Math.round((z - half) / 16) * 16;
    this.#rasterize();
    this.has = true;
    this.uniforms.uChOrg.value.set(this.org.x, this.org.z);
    this.uniforms.uChOn.value = 1;
    this.tex.needsUpdate = true;
    return true;
  }

  #rasterize() {
    const d = this.data, ox = this.org.x, oz = this.org.z, size = CH_N * CH_C;
    d.fill(NONE);
    const seen = new Set();
    const gx0 = Math.floor(ox / this.cellSize), gx1 = Math.floor((ox + size) / this.cellSize);
    const gz0 = Math.floor(oz / this.cellSize), gz1 = Math.floor((oz + size) / this.cellSize);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      for (const i of this.grid.get(gx * 100003 + gz) || []) {
        if (seen.has(i)) continue;
        seen.add(i);
        this.#stamp(this.segs[i], i);
      }
    }
  }

  #stamp(s, i) {
    const d = this.data, ox = this.org.x, oz = this.org.z;
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-6, L = Math.sqrt(L2);
    const wb = s.wb;
    const x0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - REACH - ox) / CH_C)), x1 = Math.min(CH_N - 1, Math.ceil((Math.max(s.ax, s.bx) + REACH - ox) / CH_C));
    const z0 = Math.max(0, Math.floor((Math.min(s.az, s.bz) - REACH - oz) / CH_C)), z1 = Math.min(CH_N - 1, Math.ceil((Math.max(s.az, s.bz) + REACH - oz) / CH_C));
    for (let r = z0; r <= z1; r++) {
      const pz = oz + (r + 0.5) * CH_C;
      for (let c = x0; c <= x1; c++) {
        const px = ox + (c + 0.5) * CH_C;
        const t = Math.min(1, Math.max(0, ((px - s.ax) * dx + (pz - s.az) * dz) / L2));
        const ex = px - (s.ax + dx * t), ez = pz - (s.az + dz * t);
        const dist = Math.hypot(ex, ez);
        if (dist > REACH) continue;
        const wy = s.ay + (s.by - s.ay) * t;
        // the bed and the banks wander a little along the stream so no two reaches are the same ditch
        const along = i * 0.37 + t;
        const wv = wb * (1 + 0.22 * Math.sin(along * 2.1 + s.id) + 0.12 * Math.sin(along * 5.3));
        let prof;
        if (dist < wv) { const q = dist / wv; prof = wy - DEPTH - SCOOP * (1 - q * q); }
        else { const x = dist - wv; prof = wy - DEPTH + SLOPE * x + FLARE * x * x; }
        const k = (r * CH_N + c) * 2;
        if (prof < d[k]) d[k] = prof;
        const edge = dist - (wv + 1.05 * DEPTH / SLOPE);
        if (edge < d[k + 1]) d[k + 1] = edge;
      }
    }
  }

  /** The channel surface at a point (1e4 where there is none): the same bilinear sample the shader takes. */
  at(x, z) {
    if (!this.has) return NONE;
    const ux = (x - this.org.x) / CH_C - 0.5, uz = (z - this.org.z) / CH_C - 0.5;
    const cx = Math.floor(ux), cz = Math.floor(uz), fx = ux - cx, fz = uz - cz;
    const g = (c, r) => (c < 0 || r < 0 || c >= CH_N || r >= CH_N ? NONE : this.data[(r * CH_N + c) * 2]);
    const a = g(cx, cz), b = g(cx + 1, cz), e = g(cx, cz + 1), f = g(cx + 1, cz + 1);
    return (a + (b - a) * fx) * (1 - fz) + (e + (f - e) * fx) * fz;
  }

  /** Soft minimum of the natural ground and the channel surface. */
  cut(ground, x, z) {
    const p = this.at(x, z);
    if (p >= NONE * 0.5) return ground;
    const h = Math.max(SMIN - Math.abs(ground - p), 0) / SMIN;
    return Math.min(ground, p) - h * h * SMIN * 0.25;
  }
}
