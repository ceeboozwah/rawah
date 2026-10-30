import * as THREE from 'three';

// Hand-made animations (made with the pose editor, src/poser.js) live in data/anims/<name>.json as a few keyframes:
//   { version: 1, name, duration, loop, smooth, keys: [{ t, hips, rot: { mixamorigArm_L...: [x, y, z, w] } }] }
// `rot` is how far each bone has turned from its rest in the WORLD (the same quantity `retarget` carries between rigs,
// src/anims.js), so one animation fits every character; bones not listed are at rest, `hips` is the hip height change in clip
// units (cm). Everything here is pure maths on three's quaternions: the editor samples it to preview, and `bake` turns it into
// a clip in the Mixamo skeleton's own terms, which the animation library then retargets like any other clip.

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion(), _c = new THREE.Quaternion();
const ease = (u) => u * u * (3 - 2 * u);
const IDENT = [0, 0, 0, 1];

/** The pose at time t between the keys: bone -> world delta (written into `out`, a Map of Quaternions); returns the hips change. */
export function sampleKeys(keys, t, duration, loop, smooth, out) {
  out.clear();
  if (!keys.length) return 0;
  const n = keys.length;
  let i0 = -1;
  for (let i = 0; i < n; i++) if (keys[i].t <= t + 1e-6) i0 = i;
  let a, b, ta, tb;
  if (n === 1) { a = b = keys[0]; ta = 0; tb = 1; }
  else if (i0 < 0) {
    if (loop) { a = keys[n - 1]; b = keys[0]; ta = a.t - duration; tb = b.t; } else { a = b = keys[0]; ta = 0; tb = 1; }
  } else if (i0 === n - 1) {
    if (loop && keys[0].t + duration > keys[n - 1].t + 1e-6) { a = keys[n - 1]; b = keys[0]; ta = a.t; tb = b.t + duration; } else { a = b = keys[n - 1]; ta = 0; tb = 1; }
  } else { a = keys[i0]; b = keys[i0 + 1]; ta = a.t; tb = b.t; }
  let u = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
  if (smooth) u = ease(u);
  const names = new Set([...Object.keys(a.rot || {}), ...Object.keys(b.rot || {})]);
  for (const name of names) {
    _a.fromArray((a.rot && a.rot[name]) || IDENT);
    _b.fromArray((b.rot && b.rot[name]) || IDENT);
    out.set(name, new THREE.Quaternion().copy(_a).slerp(_b, u));
  }
  return (a.hips || 0) + ((b.hips || 0) - (a.hips || 0)) * u;
}

/** A source-skeleton clip from the saved data: for each bone, the local rotation that puts its world turn on top of the rest pose. */
export function bake(data, srcRest, fps = 30) {
  const dur = Math.max(0.1, data.duration || 1), n = Math.max(2, Math.round(dur * fps) + 1);
  const times = new Float32Array(n), names = [...srcRest.keys()];
  const track = new Map(names.map((nm) => [nm, new Float32Array(n * 4)]));
  const hips = new Float32Array(n * 3), rest = srcRest.get('mixamorigHips');
  const D = new Map(), W = new Map();
  for (let i = 0; i < n; i++) {
    const t = Math.min(dur, i / fps);
    times[i] = t;
    const dy = sampleKeys(data.keys || [], t, dur, !!data.loop, data.smooth !== false, D);
    for (const nm of names) {
      const r = srcRest.get(nm), d = D.get(nm);
      const world = W.get(nm) || W.set(nm, new THREE.Quaternion()).get(nm);
      if (d) world.copy(d).multiply(r.wq); else world.copy(r.wq);
      if (r.parent) _c.copy(W.get(r.parent)).invert().multiply(world); else _c.copy(world);
      _c.toArray(track.get(nm), i * 4);
    }
    hips[i * 3] = 0; hips[i * 3 + 1] = (rest?.hips || 54.2) + dy; hips[i * 3 + 2] = 0;
  }
  const tracks = names.map((nm) => new THREE.QuaternionKeyframeTrack(`${nm}.quaternion`, times, track.get(nm)));
  tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, hips));
  return new THREE.AnimationClip(data.name || 'pose', dur, tracks);
}

/** The world delta of every bone of a source clip at time t (into `out`, a Map); returns the hips change in clip units. */
export function deltasFromClip(clip, srcRest, t, out) {
  out.clear();
  const tr = new Map();
  for (const track of clip.tracks) if (track.name.endsWith('.quaternion')) tr.set(track.name.slice(0, -11), track);
  const W = new Map(), tt = Math.min(Math.max(t, 0), clip.duration);
  for (const [nm, r] of srcRest) {
    const track = tr.get(nm), local = track ? _a.fromArray(track.createInterpolant().evaluate(tt)) : _a.copy(r.lq);
    const world = W.get(nm) || W.set(nm, new THREE.Quaternion()).get(nm);
    if (r.parent) world.copy(W.get(r.parent)).multiply(local); else world.copy(local);
    out.set(nm, new THREE.Quaternion().copy(world).multiply(_b.copy(r.wq).invert()));
  }
  const hp = clip.tracks.find((x) => x.name === 'mixamorigHips.position');
  return hp ? hp.createInterpolant().evaluate(tt)[1] - (srcRest.get('mixamorigHips')?.hips || 54.2) : 0;
}
