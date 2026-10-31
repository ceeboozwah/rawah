import * as THREE from 'three';

// Hand-made animations (made with the pose editor, src/poser.js) live in data/anims/<name>.json as keyframes on tracks, one track
// per bone and one for the hips' height, so each can be keyed at its own times:
//   { version: 2, name, duration, loop, smooth, flow, tracks: { hips: [{ t, v, e? }], mixamorigArm_L...: [{ t, q: [x, y, z, w], e? }] } }
// `q` is how far the bone has turned from its rest in the WORLD (the same quantity `retarget` carries between rigs, src/anims.js),
// so one animation fits every character; `v` is the hips' height change in clip units (cm). `e` is the curve of the segment that
// STARTS at that key: four numbers [x1, y1, x2, y2] of a cubic Bezier (as in CSS, y may overshoot), or 'hold' to stay until the
// next key; with none, `smooth` picks a smoothstep and otherwise the segment is linear. `flow` turns the whole track into a smooth
// spline through its keys (a spherical cubic, squad, for rotations) so the motion does not stop at every key.
// Version 1 files (`keys`: whole poses, a bone missing from a key meaning rest) are read as tracks. Everything here is pure maths on
// three's quaternions: the editor samples it to preview, and `bake` turns it into a clip in the Mixamo skeleton's own terms, which the
// animation library then retargets like any other clip.

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion(), _c = new THREE.Quaternion(), _d = new THREE.Quaternion();
const _la = new THREE.Vector3(), _lb = new THREE.Vector3();
const IDENT = [0, 0, 0, 1];
const ease3 = (u) => u * u * (3 - 2 * u);

export const EASES = {
  linear: [0, 0, 1, 1], 'ease in': [0.42, 0, 1, 1], 'ease out': [0, 0, 0.58, 1], 'ease in-out': [0.42, 0, 0.58, 1],
  'slow start': [0.7, 0, 0.9, 0.4], overshoot: [0.34, 1.56, 0.64, 1], snap: [0.1, 0.9, 0.3, 1], hold: 'hold',
};

/** A cubic Bezier easing: the y at time u of the curve from (0,0) to (1,1) with handles (x1,y1) and (x2,y2). */
export function bezier(e, u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const [x1, y1, x2, y2] = e;
  const X = (s) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const Y = (s) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  let lo = 0, hi = 1, s = u;
  for (let i = 0; i < 24; i++) { s = (lo + hi) / 2; if (X(s) < u) lo = s; else hi = s; }
  return Y(s);
}

/** Version 1 keys (whole poses) as tracks: every bone that appears anywhere gets a key at every key time (rest where it was absent). */
export function toTracks(data) {
  if (data.tracks) return data.tracks;
  const keys = data.keys || [], names = new Set();
  for (const k of keys) for (const n of Object.keys(k.rot || {})) names.add(n);
  const tracks = { hips: keys.map((k) => ({ t: k.t, v: k.hips || 0 })) };
  for (const n of names) tracks[n] = keys.map((k) => ({ t: k.t, q: (k.rot && k.rot[n]) || IDENT.slice() }));
  return tracks;
}

/** The segment of a sorted key list around t: keys a then b (b may be a itself), their times, and the neighbours either side for splines. */
function segment(list, t, duration, loop) {
  const n = list.length;
  if (n === 1) return { a: list[0], b: list[0], ta: 0, tb: 1, p: list[0], n: list[0] };
  let i0 = -1;
  for (let i = 0; i < n; i++) if (list[i].t <= t + 1e-6) i0 = i;
  if (i0 < 0) {
    if (!loop) return { a: list[0], b: list[0], ta: 0, tb: 1, p: list[0], n: list[0] };
    return { a: list[n - 1], b: list[0], ta: list[n - 1].t - duration, tb: list[0].t, p: list[(n - 2 + n) % n], n: list[1 % n] };
  }
  if (i0 === n - 1) {
    if (!loop || list[0].t + duration <= list[n - 1].t + 1e-6) return { a: list[n - 1], b: list[n - 1], ta: 0, tb: 1, p: list[n - 1], n: list[n - 1] };
    return { a: list[n - 1], b: list[0], ta: list[n - 1].t, tb: list[0].t + duration, p: list[n - 2], n: list[1 % n] };
  }
  const p = i0 > 0 ? list[i0 - 1] : loop ? list[n - 1] : list[0];
  const nx = i0 + 2 < n ? list[i0 + 2] : loop ? list[0] : list[n - 1];
  return { a: list[i0], b: list[i0 + 1], ta: list[i0].t, tb: list[i0 + 1].t, p, n: nx };
}

const curve = (a, u, smooth) => (a.e === 'hold' ? 0 : Array.isArray(a.e) ? bezier(a.e, u) : smooth ? ease3(u) : u);

function qlog(q, out) {
  const s = Math.hypot(q.x, q.y, q.z), k = s > 1e-6 ? Math.atan2(s, q.w) / s : 1;
  return out.set(q.x * k, q.y * k, q.z * k);
}
function qexp(v, out) {
  const m = v.length(), k = m > 1e-6 ? Math.sin(m) / m : 1;
  return out.set(v.x * k, v.y * k, v.z * k, Math.cos(m));
}
/** The inner control point of squad at q1, given its neighbours: q1 * exp(-(log(q1^-1 q2) + log(q1^-1 q0)) / 4). */
function inner(q0, q1, q2, out) {
  _c.copy(q1).invert();
  qlog(_d.copy(_c).multiply(q2), _la);
  qlog(_d.copy(_c).multiply(q0), _lb);
  _la.add(_lb).multiplyScalar(-0.25);
  return out.copy(q1).multiply(qexp(_la, _d));
}
const align = (q, to) => { if (q.dot(to) < 0) q.set(-q.x, -q.y, -q.z, -q.w); return q; };

/** One bone's turn at time t. */
function sampleBone(list, t, duration, loop, smooth, flow, out) {
  const s = segment(list, t, duration, loop);
  let u = s.tb > s.ta ? Math.min(1, Math.max(0, (t - s.ta) / (s.tb - s.ta))) : 0;
  const qa = _a.fromArray(s.a.q), qb = align(_b.fromArray(s.b.q), qa);
  if (flow && s.a !== s.b && !Array.isArray(s.a.e) && s.a.e !== 'hold') {
    const qp = align(new THREE.Quaternion().fromArray(s.p.q), qa), qn = align(new THREE.Quaternion().fromArray(s.n.q), qb);
    const sa = inner(qp, qa.clone(), qb, new THREE.Quaternion()), sb = inner(qa, qb.clone(), qn, new THREE.Quaternion());
    const base = qa.clone().slerp(qb, u), tan = sa.slerp(sb, u);
    return out.copy(base).slerp(tan, 2 * u * (1 - u)).normalize();
  }
  u = curve(s.a, u, smooth);
  return out.copy(qa).slerp(qb, u).normalize();
}

/** The hips' height at time t. */
function sampleHips(list, t, duration, loop, smooth, flow) {
  const s = segment(list, t, duration, loop);
  const u0 = s.tb > s.ta ? Math.min(1, Math.max(0, (t - s.ta) / (s.tb - s.ta))) : 0;
  if (s.a === s.b) return s.a.v;
  if (flow && !Array.isArray(s.a.e) && s.a.e !== 'hold') {
    // Catmull-Rom through the values, with tangents from the neighbours' spacing
    const dt = s.tb - s.ta;
    let tp = s.p === s.a ? s.ta : s.p.t, tn = s.n === s.b ? s.tb : s.n.t;
    if (tp > s.ta + 1e-6) tp -= duration;   // the key before this one, found by wrapping round
    if (tn < s.tb - 1e-6) tn += duration;   // and the one after
    const m0 = (s.b.v - s.p.v) / Math.max(1e-3, s.tb - tp) * dt, m1 = (s.n.v - s.a.v) / Math.max(1e-3, tn - s.ta) * dt;
    const u = u0, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * s.a.v + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * s.b.v + (u3 - u2) * m1;
  }
  const u = curve(s.a, u0, smooth);
  return s.a.v + (s.b.v - s.a.v) * u;
}

/** The pose at time t: bone -> world delta (written into `out`, a Map of Quaternions, for every bone that has a track); returns the hips change. */
export function sampleTracks(tracks, t, duration, loop, smooth, flow, out) {
  out.clear();
  for (const [name, list] of Object.entries(tracks)) {
    if (name === 'hips' || !list.length) continue;
    out.set(name, sampleBone(list, t, duration, loop, smooth, flow, new THREE.Quaternion()));
  }
  return tracks.hips && tracks.hips.length ? sampleHips(tracks.hips, t, duration, loop, smooth, flow) : 0;
}

/** A source-skeleton clip from the saved data: for each bone, the local rotation that puts its world turn on top of the rest pose. */
export function bake(data, srcRest, fps = 30) {
  const dur = Math.max(0.1, data.duration || 1), n = Math.max(2, Math.round(dur * fps) + 1);
  const times = new Float32Array(n), names = [...srcRest.keys()], tracks = toTracks(data);
  const track = new Map(names.map((nm) => [nm, new Float32Array(n * 4)]));
  const hips = new Float32Array(n * 3), rest = srcRest.get('mixamorigHips');
  const D = new Map(), W = new Map();
  for (let i = 0; i < n; i++) {
    const t = Math.min(dur, i / fps);
    times[i] = t;
    const dy = sampleTracks(tracks, t, dur, !!data.loop, data.smooth !== false, !!data.flow, D);
    for (const nm of names) {
      const r = srcRest.get(nm), d = D.get(nm);
      const world = W.get(nm) || W.set(nm, new THREE.Quaternion()).get(nm);
      if (d) world.copy(d).multiply(r.wq); else world.copy(r.wq);
      if (r.parent) _c.copy(W.get(r.parent)).invert().multiply(world); else _c.copy(world);
      _c.toArray(track.get(nm), i * 4);
    }
    hips[i * 3] = 0; hips[i * 3 + 1] = (rest?.hips || 54.2) + dy; hips[i * 3 + 2] = 0;
  }
  const out = names.map((nm) => new THREE.QuaternionKeyframeTrack(`${nm}.quaternion`, times, track.get(nm)));
  out.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, hips));
  return new THREE.AnimationClip(data.name || 'pose', dur, out);
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
