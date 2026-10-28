import * as THREE from 'three';

// The campfire's smoke column: a plume of soft puffs that rises a hundred metres and more above the fire, leans downwind
// and spreads as it climbs, so it clears the tree line and shows where camp is from a long way off. Puffs are placed
// in the vertex shader from the clock alone (no per-frame cost), in world space, depth-tested so ridges hide it. It
// thins as the fire burns down and lingers as a faint thread for a couple of minutes after the fire is out.

const COUNT = 170;
const LINGER = 150;                                   // seconds a dead fire's smoke thins away over

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aSeed;
uniform float uTime, uScale, uStr, uHeight, uGlow;
uniform vec3 uBase, uCol;
uniform vec2 uDrift;
varying vec4 vCol;
void main() {
  float age = fract(uTime * 0.011 * (0.85 + aSeed.z * 0.3) + aSeed.y);
  float rise = 1.0 - pow(1.0 - age, 1.8);
  float h = 1.4 + uHeight * rise;
  vec2 sway = vec2(sin(uTime * 0.23 + aSeed.x * 40.0 + age * 6.0), cos(uTime * 0.19 + aSeed.w * 37.0 + age * 5.0)) * (0.4 + 20.0 * age);
  vec2 lean = uDrift * 90.0 * pow(age, 1.35);
  vec3 p = uBase + vec3(lean.x + sway.x + (aSeed.x - 0.5) * 1.2, h, lean.y + sway.y + (aSeed.w - 0.5) * 1.2);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  float dist = max(-mv.z, 0.1);
  float size = 2.0 + 56.0 * pow(age, 0.8);
  gl_PointSize = clamp(uScale * size / dist, 0.0, 420.0);
  float shown = step(aSeed.x, uStr);
  float a = shown * smoothstep(0.0, 0.06, age) * pow(1.0 - age, 1.6) * 0.13 * (0.6 + uStr);
  a *= exp(-dist * 0.00022) * smoothstep(size * 0.5, size * 1.6, dist);   // thin with distance, never a wall in your face
  float g = (1.0 - smoothstep(0.0, 0.09, age)) * uGlow;                   // lit orange from below at night
  vCol = vec4(uCol + vec3(1.0, 0.42, 0.12) * g, a);
}`;

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec4 vCol;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float soft = smoothstep(1.0, 0.15, d);
  gl_FragColor = vec4(vCol.rgb, vCol.a * soft);
}`;

export class SmokeColumn {
  constructor(scene) {
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      seed[i * 4] = (i + 0.5) / COUNT;                     // thinning order: the first to go are spread through the column
      seed[i * 4 + 1] = (i * 0.618034) % 1;                // phase
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.u = { uTime: { value: 0 }, uScale: { value: 800 }, uStr: { value: 0 }, uHeight: { value: 200 }, uGlow: { value: 0 }, uBase: { value: new THREE.Vector3() }, uCol: { value: new THREE.Color(0.6, 0.6, 0.62) }, uDrift: { value: new THREE.Vector2() } };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthWrite: false, fog: false });
    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.level = 0;
    this.last = null;
  }

  /** fire: camp.fire or null; fuel 0..1; groundY(x, z); drift: [x, z] m/s; light: sky.light 0..1; sun: THREE.Color of the direct light. */
  update(t, dt, { fire, fuel, groundY, drift, light, sun, scale }) {
    if (fire) {
      this.last = { x: fire.x, z: fire.z, y: groundY(fire.x, fire.z) };
      this.level = 0.3 + 0.7 * Math.min(1, fuel);
    } else this.level = Math.max(0, this.level - dt / LINGER);
    const on = !!this.last && this.level > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.u;
    u.uTime.value = t; u.uScale.value = scale; u.uStr.value = this.level;
    u.uHeight.value = 60 + 190 * this.level;
    u.uBase.value.set(this.last.x, this.last.y, this.last.z);
    u.uDrift.value.set(drift[0], drift[1]);
    const day = Math.min(1, Math.max(0, light));
    const k = 0.07 + 0.46 * day;
    u.uCol.value.setRGB(k * (0.86 + 0.14 * sun.r), k * (0.88 + 0.12 * sun.g), k * (0.95 + 0.05 * sun.b));
    u.uGlow.value = (1 - day) * 0.9;
  }

  reset() { this.level = 0; this.last = null; this.mesh.visible = false; }
}
