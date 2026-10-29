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

//  BLADDER  a 2 L hydration bladder you scoop full at the water (about 0.3 L/s) and drink through its hose; [2] picks it, [1] the
//           canteen, [3] the LifeStraw. Each carries its own water, its own hazard and its own treatment.
//  STRAW    a LifeStraw: [3], then [Y] facing water kneels and drinks straight from it through a 0.2 micron hollow fibre.
//  BOIL     [4] cycles the treatment ([U] does it): pump, boil, iodine. Boiling sets the container's water in a pot on the fire
//           until it heats, then a rolling boil for 1 minute (3 above 2000 m, the CDC/WMS figure), then it has to cool.
//  IODINE   a tablet in the container and a wait: about an hour in cold mountain water, longer if it is silty. It kills bacteria and
//           most viruses in that time, Giardia only after about three times as long and Cryptosporidium hardly at all.
//
// Illness is a hazard per litre split into four kinds of bug (Giardia, Cryptosporidium, bacteria, viruses); each treatment keeps a
// fraction of each. The per-litre figures are estimates from dose-response and typical cyst counts, not measurements: the evidence
// for wilderness water is thin (Welch 2000), but the Appalachian Trail cohort found frequent untreated drinkers had about 8 times the odds of diarrhoea.

import { NONE, SHARE, SURV, mulH, sumH, effective, kindOf, sourceHaz } from './water.js';
export { sumH, effective, kindOf, sourceHaz };

export const CANTEEN_L = 0.95;
export const BLADDER_L = 2.0;
export const POT_L = 1.5;
const PROP = 1.35;                        // props on the ground are drawn a third larger than life so they read from a few metres away
const SIP_L = 0.18;                       // a few swallows
const FILL_LS = 0.21;                     // litres a second dunking a narrow-necked canteen
const PUMP_LMIN = 1.0;                    // litres a minute through a clean ceramic element
const mk = (cap, water) => ({ cap, water, haz: { ...NONE }, turb: 0, treated: true, how: 'home', from: 'home', iod: null, hot: 0 });

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

/** A 2 L hydration bladder lying flat: translucent blue bag, screw cap, slider bar, hose with a bite valve. Origin on the ground under it. */
export function buildBladder() {
  const m = mats(), g = new THREE.Group();
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x3f89b5, metalness: 0, roughness: 0.3, transparent: true, opacity: 0.78 });
  const bag = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), bagMat);
  bag.scale.set(0.105, 0.03, 0.17); bag.position.y = 0.03; bag.castShadow = true; g.add(bag);
  const weld = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 40), m.silicone);
  weld.rotation.x = Math.PI / 2; weld.scale.set(0.105, 0.17, 1); weld.position.y = 0.03; g.add(weld);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.022, 20), m.plastic); cap.position.set(0, 0.05, -0.15); cap.castShadow = true; g.add(cap);
  const slider = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.02), m.plastic); slider.position.set(0, 0.05, 0.14); g.add(slider);
  const tube = hose([new THREE.Vector3(0.05, 0.04, 0.14), new THREE.Vector3(0.14, 0.02, 0.2), new THREE.Vector3(0.2, 0.01, 0.12), new THREE.Vector3(0.22, 0.012, 0.04)], 0.006, m.plastic);
  g.add(tube);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 0.03, 12), m.blue); valve.rotation.x = Math.PI / 2; valve.position.set(0.22, 0.014, 0.0); g.add(valve);
  const root = new THREE.Group(); root.add(g);
  root.userData.lift = 0; root.userData.mouthY = 0.07; root.userData.tilt = 0.12;
  return root;
}

/** A small steel cooking pot with a lid and a bail handle, standing on y = 0. */
export function buildPot() {
  const m = mats(), g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.082, 0.13, 28, 1, true), m.steel); wall.material = wall.material.clone(); wall.material.side = THREE.DoubleSide; wall.position.y = 0.065; wall.castShadow = true; g.add(wall);
  const soot = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.05, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1, side: THREE.DoubleSide })); soot.scale.set(1.005, 1, 1.005); soot.position.y = 0.025; g.add(soot);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.004, 24), m.dark); base.position.y = 0.002; g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.003, 8, 28), m.dark); rim.rotation.x = Math.PI / 2; rim.position.y = 0.13; g.add(rim);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.081, 0.081, 0.002, 24), m.water); water.position.y = 0.1; g.add(water);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.006, 28), m.steel); lid.position.y = 0.17; lid.castShadow = true; g.add(lid);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), m.plastic); knob.position.y = 0.184; lid.add(knob); knob.position.set(0, 0.014, 0);
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.087, 0.0028, 6, 24, Math.PI), m.dark); bail.position.y = 0.12; g.add(bail);
  g.userData.lid = lid; g.userData.water = water;
  return g;
}

/** A handheld two-way radio (the kind sold for hiking and camping): rounded black body, rubber-duck antenna, channel and volume
 *  knobs on top, a small screen, a speaker grille, a long push-to-talk bar down the side and a belt clip on the back. About 6 x 3.4 x
 *  12 cm; the origin is the middle of the body, the antenna points up (+y) and the front faces +z. */
export function buildRadio() {
  const g = new THREE.Group();
  const plastic = new THREE.MeshStandardMaterial({ color: 0x23262a, metalness: 0.05, roughness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x121315, metalness: 0, roughness: 0.9 });
  const face = new THREE.MeshStandardMaterial({ color: 0x31353a, metalness: 0.1, roughness: 0.45 });
  const lcd = new THREE.MeshStandardMaterial({ color: 0x244a3f, emissive: 0x1d5a48, emissiveIntensity: 0.55, roughness: 0.25 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd8692a, metalness: 0, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.35 });
  const add = (geo, mat, x, y, z, rot) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); if (rot) o.rotation.set(...rot); o.castShadow = true; g.add(o); return o; };
  // body: a rounded rectangle extruded, bevelled edges
  const W = 0.058, H = 0.118, D = 0.032, r = 0.009;
  const sh = new THREE.Shape();
  sh.moveTo(-W / 2 + r, -H / 2); sh.lineTo(W / 2 - r, -H / 2); sh.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + r);
  sh.lineTo(W / 2, H / 2 - r); sh.quadraticCurveTo(W / 2, H / 2, W / 2 - r, H / 2); sh.lineTo(-W / 2 + r, H / 2);
  sh.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - r); sh.lineTo(-W / 2, -H / 2 + r); sh.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + r, -H / 2);
  const bodyGeo = new THREE.ExtrudeGeometry(sh, { depth: D - 0.006, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 6 });
  bodyGeo.translate(0, 0, -(D - 0.006) / 2);
  add(bodyGeo, plastic, 0, 0, 0);
  // faceplate: a slightly lighter panel, the screen above, three small keys, the speaker grille below
  add(new THREE.BoxGeometry(W - 0.012, 0.05, 0.002), face, 0, 0.028, D / 2 + 0.0005);
  add(new THREE.BoxGeometry(0.036, 0.018, 0.0015), lcd, 0, 0.04, D / 2 + 0.0017);
  for (const kx of [-0.014, 0, 0.014]) add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 12), rubber, kx, 0.014, D / 2 + 0.0018, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.034, 0.0022, 0.0015), rubber, 0, -0.012 - i * 0.0062, D / 2 + 0.0005);
  add(new THREE.BoxGeometry(0.02, 0.0045, 0.0015), accent, 0, -0.052, D / 2 + 0.0005);      // an orange stripe, the way they come
  // the push-to-talk bar on the left side and a smaller side key above it
  add(new THREE.BoxGeometry(0.006, 0.036, 0.018), rubber, -W / 2 - 0.0008, 0.008, 0.002);
  add(new THREE.BoxGeometry(0.005, 0.014, 0.012), rubber, -W / 2 - 0.0008, 0.043, 0.002);
  // top: antenna base and a tapering antenna, the volume knob and the channel knob
  add(new THREE.CylinderGeometry(0.0085, 0.0095, 0.012, 16), steel, 0.012, H / 2 + 0.004, 0);
  const ant = add(new THREE.CylinderGeometry(0.0042, 0.0062, 0.14, 12), rubber, 0.012, H / 2 + 0.07, 0);
  ant.rotation.z = -0.03;
  add(new THREE.CylinderGeometry(0.009, 0.009, 0.014, 20), rubber, -0.016, H / 2 + 0.007, 0);
  add(new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 18), accent, -0.016, H / 2 + 0.019, 0);
  add(new THREE.CylinderGeometry(0.0075, 0.0075, 0.01, 18), rubber, -0.004, H / 2 + 0.005, 0.006);
  // the back: a belt clip
  add(new THREE.BoxGeometry(0.02, 0.07, 0.003), steel, 0, 0.0, -D / 2 - 0.0016);
  g.userData.top = new THREE.Vector3(0.012, H / 2 + 0.14, 0);         // the antenna tip
  g.userData.mic = new THREE.Vector3(0, 0.02, D / 2);                 // where it is spoken into
  return g;
}

/** A LifeStraw: a pale tube with a blue band and a mouthpiece cap, 0.22 m long, lying along +x with its centre at the origin. */
export function buildStraw() {
  const m = mats(), g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.22, 14), new THREE.MeshStandardMaterial({ color: 0xdfe7ea, roughness: 0.45 })); tube.rotation.z = Math.PI / 2; g.add(tube);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0132, 0.0132, 0.05, 14), m.blue); band.rotation.z = Math.PI / 2; band.position.x = -0.04; g.add(band);
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0125, 0.03, 14), m.blue); mouth.rotation.z = Math.PI / 2; mouth.position.x = 0.125; g.add(mouth);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 14), m.mesh); cap.rotation.z = Math.PI / 2; cap.position.x = -0.116; g.add(cap);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

// ------------------------------------------------------------------ what you carry and do

const ROLL_MIN = (elev) => (elev > 2000 ? 3 : 1);                         // minutes at a rolling boil (CDC / WMS: 3 above 2000 m)
const HEAT_MIN_PER_L = 4.5;                                               // a wood fire under a pot: about 1.4 kW into the water
const COOL_MIN = 10;                                                      // minutes before boiled water can be drunk
const METHODS = ['pump', 'boil', 'iodine'];

export class Gear {
  constructor({ scene, camera, avatar, world }) {
    this.scene = scene; this.camera = camera; this.avatar = avatar; this.world = world;
    this.m = mats();
    this.reset();
    // held: first person hangs off the camera (beyond the near plane), third person sits in the hand
    this.held = buildCanteen();
    this.radioObj = buildRadio();
    this.radioFp = buildRadio();
    this.radioFp.visible = false;
    camera.add(this.radioFp);
    this.radioLift = 0;
    this.heldFp = buildCanteen();
    this.heldFp.visible = false;
    camera.add(this.heldFp);
    // the station: what you set on the ground to fill, filter and boil
    this.station = new THREE.Group();
    this.station.visible = false;
    this.groundCanteen = buildCanteen();
    this.groundCanteen.userData.lift = 0.11; this.groundCanteen.userData.mouthY = 0.12; this.groundCanteen.userData.tilt = 1.15;
    this.groundBag = buildBladder();
    this.groundPot = buildPot();
    this.groundPot.userData.lift = 0; this.groundPot.userData.mouthY = 0.13; this.groundPot.userData.tilt = 0.08;
    this.gm = this.groundCanteen;
    this.filterObj = buildFilter();
    this.cup = buildCup(this.m);
    this.strainer = strainer(this.m);
    this.potModel = buildPot();
    this.strawObj = buildStraw();
    this.steam = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.station.add(this.groundCanteen, this.groundBag, this.groundPot, this.filterObj, this.cup, this.strainer, this.potModel, this.strawObj, this.steam);
    scene.add(this.station);
    this.events = [];
    this.lastSips = 0;
    this.pumped = 0;
  }

  reset() {
    this.canteen = mk(CANTEEN_L, CANTEEN_L);
    this.bladder = mk(BLADDER_L, BLADDER_L);
    this.pot = mk(POT_L, 0);
    this.potObj = null;
    this.sel = 'canteen';
    this.method = 'pump';
    this.filter = { owned: true, clog: 0.05, litres: 0, scrubs: 0 };
    this.straw = { owned: true, litres: 0 };
    this.tabs = 20;
    this.act = null;
    this.warnedRaw = false;
  }

  /** The container [U] and [Y] work on (the straw fills and treats the canteen). */
  get cur() { return this.sel === 'bladder' ? this.bladder : this.sel === 'pot' ? this.pot : this.canteen; }
  get name() { return this.sel === 'bladder' ? 'bladder' : this.sel === 'pot' ? 'pot' : 'canteen'; }
  get carried() { return this.canteen.water + this.bladder.water + this.pot.water; }
  get busy() { return !!this.act && this.act.kind !== 'drink'; }
  get drinking() { return this.act?.kind === 'drink'; }

  select(k) {
    if (this.act) return null;
    this.sel = k;
    if (k === 'pot') this.method = 'boil';
    else if (this.method === 'boil') this.method = 'pump';
    return k === 'straw' ? 'LifeStraw: face the water and press [Y] to drink from it.' : k === 'bladder' ? 'Bladder (2 L): [U] fill it at the water, [Y] drink.' : k === 'pot' ? 'Cooking pot: [U] fill it at the water, carry it to a lit fire and [U] again to boil, then select your canteen and [U] to pour it in.' : 'Canteen: [U] fill it at the water, [Y] drink.';
  }

  setMethod(m) { if (!this.act) this.method = m; }

  /** Ground the grass should leave bare: the station while it is set out. */
  clearings() { return this.station.visible && this.act?.bx !== undefined ? [[this.act.bx, this.act.bz, 0.85]] : (this.station.visible && this.act?.target ? [[this.act.target.x, this.act.target.z, 0.6]] : []); }

  #saveC(c) { const h = (v) => +v.toFixed(5); return { w: +c.water.toFixed(3), h: [h(c.haz.g), h(c.haz.c), h(c.haz.b), h(c.haz.v)], t: +c.turb.toFixed(2), tr: c.treated, hw: c.how, f: c.from, i: c.iod ? { t: Math.round(c.iod.t), r: Math.round(c.iod.req) } : null, hot: Math.round(c.hot) }; }
  #loadC(c, s) {
    c.water = Math.min(c.cap, s.w ?? c.water);
    c.turb = s.t || 0; c.from = s.f || 'home';
    if (s.h) { c.haz = { g: s.h[0], c: s.h[1], b: s.h[2], v: s.h[3] }; c.treated = s.tr !== false; c.how = s.hw || ''; c.iod = s.i ? { t: s.i.t, req: s.i.r } : null; c.hot = s.hot || 0; }
    else {                                                           // the first saves: clean flag and a single risk number
      c.treated = !!s.cl; c.how = s.cl ? 'filtered' : '';
      const r = s.cl ? 0.002 : Math.min(0.2, (s.r || 0.1) * 0.25);
      c.haz = { g: r * SHARE.g, c: r * SHARE.c, b: r * SHARE.b, v: r * SHARE.v };
    }
  }
  save() { return { c: this.#saveC(this.canteen), b: this.#saveC(this.bladder), p: this.#saveC(this.pot), sel: this.sel, m: this.method, tabs: this.tabs, f: { o: this.filter.owned, k: +this.filter.clog.toFixed(3), l: +this.filter.litres.toFixed(1), s: this.filter.scrubs }, s: { o: this.straw.owned, l: +this.straw.litres.toFixed(1) } }; }
  load(s) {
    this.reset();
    if (!s) return;
    if (s.c) this.#loadC(this.canteen, s.c);
    if (s.b) this.#loadC(this.bladder, s.b);
    if (s.p) this.#loadC(this.pot, s.p);
    if (s.sel) this.sel = s.sel;
    if (s.m) this.method = s.m;
    if (s.tabs != null) this.tabs = s.tabs;
    if (s.f) this.filter = { owned: s.f.o !== false, clog: s.f.k ?? 0.05, litres: s.f.l || 0, scrubs: s.f.s || 0 };
    if (s.s) this.straw = { owned: s.s.o !== false, litres: s.s.l || 0 };
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
  /** [Y]: swallows from the selected container, or from the water itself through the LifeStraw (target = water ahead). */
  drink(target) {
    if (this.act) return 'busy';
    if (this.sel === 'straw') {
      if (!this.straw.owned) return 'You have no LifeStraw.';
      if (!target) return 'Face a stream or a lake to drink through the LifeStraw.';
      this.act = { kind: 'straw', t: 0, dur: 2.4, took: false, target };
      return null;
    }
    if (this.sel === 'pot') return 'Pour it into your canteen to drink: select the canteen and press [U].';
    const c = this.cur;
    if (c.water <= 0.005) return `Your ${this.name} is empty. Fill it at a stream or a lake.`;
    if (c.hot > 0) return 'It is still too hot to drink. Give it a few minutes.';
    this.act = { kind: 'drink', t: 0, dur: this.sel === 'bladder' ? 1.1 : 1.7, took: false, c };
    return null;
  }

  fill(target) {
    if (this.act) return 'busy';
    const c = this.cur;
    if (c.water >= c.cap - 0.02) return `The ${this.name} is full.`;
    this.act = { kind: 'fill', t: 0, target, c, noted: false, stir: 0 };
    return null;
  }

  /** [U] away from the water: whichever treatment is selected. fire = the lit campfire { x, z } near you, or null. */
  treat() {
    const c = this.cur, k = kindOf(c);
    if (this.act) return 'busy';
    if (k === 'empty') return 'Nothing to treat.';
    if (k === 'waiting') return `The iodine is still working (${Math.round(c.iod.t)} of ${c.iod.req} min).`;
    if (k === 'treated') return 'That water is already treated.';
    if (this.method === 'boil') return this.#boil(c);
    if (this.method === 'iodine') return this.#iodine(c);
    return this.#pump(c);
  }

  /** [U] with the canteen or bladder selected and water in the pot: pour the pot into it. */
  pour() {
    if (this.act) return 'busy';
    const to = this.cur, from = this.pot;
    if (to === from) return 'Select your canteen or bladder to pour into.';
    if (from.water < 0.02) return 'The pot is empty.';
    if (from.hot > 0) return 'The pot is still too hot to pour. Give it a few minutes.';
    if (to.water >= to.cap - 0.02) return `The ${this.name} is full.`;
    this.act = { kind: 'pour', t: 0, dur: 2.6, from, to, amount: Math.min(from.water, to.cap - to.water), done: 0, set: false };
    return null;
  }

  #pump(c) {
    if (!this.filter.owned) return 'You have no filter.';
    if (this.filter.clog > 0.97) return 'The filter is clogged solid. Scrub the element first.';
    this.act = { kind: 'pump', t: 0, done: 0, batch: 0, pour: 0, phase: 0, c };
    return null;
  }

  #boil(c) {
    const f = this.ctx?.fire;
    if (!f) return 'Boiling needs a fire. Light one with [F].';
    if (Math.hypot(f.x - this.ctx.p.x, f.z - this.ctx.p.z) > 4.5) return 'Stand closer to the fire.';
    this.act = { kind: 'boil', t: 0, heat: 0, roll: 0, need: ROLL_MIN(this.ctx.p.y), heatNeed: Math.max(1.5, c.water * HEAT_MIN_PER_L), c, set: false, rolling: false };
    return null;
  }

  #iodine(c) {
    const waterC = this.ctx?.waterC ?? 10, cloudy = c.turb > 0.3;
    const n = Math.ceil(c.water - 0.001) * (cloudy || waterC < 8 ? 2 : 1);
    if (this.tabs < n) return `You need ${n} iodine tablets for this water; you have ${this.tabs}.`;
    this.tabs -= n;
    const req = Math.round(Math.min(240, Math.max(30, 30 * 2 ** ((20 - waterC) / 10) * (1 + 2 * c.turb))));
    c.iod = { t: 0, req }; c.treated = true; c.how = 'iodine';
    this.emit({ type: 'sound', name: 'plop' });
    this.emit({ type: 'toast', text: `${n} tablet${n > 1 ? 's' : ''} in. Wait about ${req} minutes${cloudy ? ' (the water is cloudy)' : waterC < 10 ? ' (it is cold)' : ''}. You can walk on.` });
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
    if (a.kind === 'boil' && a.roll > 0) {
      const k = Math.min(1, a.roll / a.need), f = 10 ** (-6 * k), c = a.c;
      c.haz = mulH(c.haz, { g: f, c: f, b: f, v: f });
      this.emit({ type: 'toast', text: 'You took it off the fire early. The boil was cut short.', warn: true });
    }
    this.act = null;
    this.#hide();
  }

  // ---- time: iodine works, boiled water cools (also called when you sleep)
  advance(min) {
    for (const c of [this.canteen, this.bladder, this.pot]) {
      if (c.hot > 0) c.hot = Math.max(0, c.hot - min);
      if (c.iod && c.iod.t < c.iod.req && c.water > 0.02) {
        c.iod.t += min;
        if (c.iod.t >= c.iod.req) {
          c.iod.t = c.iod.req;
          this.emit({ type: 'toast', text: `The iodine has had its time. Bacteria and viruses are gone; Giardia needs about ${c.iod.req * 3} minutes and Cryptosporidium survives.` });
        }
      }
    }
  }

  // ---- frame
  /**
   * ctx: { p (feet), yaw, first, hiker, hydration, turbAt(x,z), groundY(x,z), dry, fire: {x,z} | null, waterC, gm (game minutes this frame) }.
   * Returns the events to act on: { type: 'toast'|'sound'|'ripple'|'stir'|'emote', ... }.
   */
  update(dt, ctx) {
    this.events.length = 0;
    const a = this.act;
    this.ctx = ctx;
    this.#radio(dt, ctx);
    if (ctx.gm > 0) this.advance(ctx.gm);
    // the first-person canteen is only there while drinking from it
    this.heldFp.visible = !!a && a.kind === 'drink' && ctx.first && a.c === this.canteen;
    if (!a) { ctx.hiker.emote = ctx.hiker.emote === 'Crouch Idle 01' || ctx.hiker.emote === 'Wiping Sweat' ? '' : ctx.hiker.emote; this.#itemInHand(false); return this.events; }
    a.t += dt;
    if (a.kind === 'drink') this.#drink(dt, a, ctx);
    else if (a.kind === 'straw') this.#straw(dt, a, ctx);
    else if (a.kind === 'fill') this.#fill(dt, a, ctx);
    else if (a.kind === 'pump') this.#pumpStep(dt, a, ctx);
    else if (a.kind === 'boil') this.#boilStep(dt, a, ctx);
    else if (a.kind === 'pour') this.#pourStep(dt, a, ctx);
    else if (a.kind === 'scrub') this.#scrub(dt, a, ctx);
    return this.events;
  }

  emit(e) { this.events.push(e); }

  #itemInHand(on) {
    if (this.avatar.setItem) this.avatar.setItem(on ? this.held : this.ctx?.radio ? this.radioObj : null);
  }

  /** The radio in the hand: down at the side while you wait, up at your mouth while you hold the button. */
  #radio(dt, ctx) {
    const on = !!ctx.radio && ctx.first;
    this.radioLift += ((ctx.ptt ? 1 : 0) - this.radioLift) * Math.min(1, dt * 12);
    const o = this.radioFp, k = this.radioLift;
    o.visible = on;
    if (!on) return;
    o.scale.setScalar(1.5);
    // held beyond the 0.4 m near plane, or its top would be clipped
    o.position.set(THREE.MathUtils.lerp(0.2, 0.07, k), THREE.MathUtils.lerp(-0.26, -0.15, k), THREE.MathUtils.lerp(-0.66, -0.58, k));
    o.rotation.set(THREE.MathUtils.lerp(0.3, 0.42, k), THREE.MathUtils.lerp(-0.5, -0.15, k), THREE.MathUtils.lerp(-0.12, 0, k));
  }

  #hide() { this.station.visible = false; this.ctx?.hiker && (this.ctx.hiker.emote = ''); this.pumped = 0; }

  #useModel(c) {
    this.gm = c === this.bladder ? this.groundBag : c === this.pot ? this.groundPot : this.groundCanteen;
    this.groundCanteen.visible = this.gm === this.groundCanteen;
    this.groundBag.visible = this.gm === this.groundBag;
    this.groundPot.visible = this.gm === this.groundPot;
    this.potModel.visible = false; this.strawObj.visible = false; this.steam.visible = false;
  }

  /** Swallow from a container: infection chance from what the water carries now (and its silt). */
  #swallow(c, ctx, want) {
    const went = ctx.hydration.drink(want);
    c.water = Math.max(0, c.water - went);
    this.emit({ type: 'sound', name: 'gulp' });
    if (went < want - 0.01) this.emit({ type: 'toast', text: 'Your stomach is full. Give it a few minutes.' });
    else if (went > 0) {
      const k = kindOf(c);
      if (k === 'raw' || k === 'waiting') {
        if (k === 'raw' && !this.warnedRaw) { this.warnedRaw = true; this.emit({ type: 'toast', text: 'That water is untreated. Treat it first next time.', warn: true }); }
        if (ctx.hydration.swallowRaw(went, sumH(effective(c)) * (1 + 2 * c.turb))) this.emit({ type: 'sick' });
      } else if (ctx.hydration.swallowRaw(went, sumH(effective(c)) * (1 + 2 * c.turb))) this.emit({ type: 'sick' });
    }
    this.lastSips++;
  }

  // the swallows: lift, tip, a gulp, lower (the bladder: a bite on the valve, no stopping)
  #drink(dt, a, ctx) {
    const u = a.t / a.dur, c = a.c, held = c === this.canteen;
    if (held && ctx.first) {
      const lift = smooth(0, 0.3, u) * (1 - smooth(0.8, 1, u)), tip = smooth(0.22, 0.52, u) * (1 - smooth(0.62, 0.82, u));
      const h = this.heldFp;
      h.position.set(THREE.MathUtils.lerp(0.2, 0.03, lift), THREE.MathUtils.lerp(-0.34, -0.16 + 0.015 * Math.sin(a.t * 14) * tip, lift), THREE.MathUtils.lerp(-0.56, -0.5, lift));
      h.rotation.set(THREE.MathUtils.lerp(0.18, 1.55, tip), THREE.MathUtils.lerp(-0.45, 0, lift), THREE.MathUtils.lerp(0.05, 0, lift));
      h.scale.setScalar(1.05);
      this.#itemInHand(false);
    } else {
      this.#itemInHand(held);
      ctx.hiker.emote = 'Wiping Sweat';
    }
    if (!a.took && u > 0.5) { a.took = true; this.#swallow(c, ctx, Math.min(held ? SIP_L : 0.22, c.water)); }
    if (a.t >= a.dur) { this.act = null; this.heldFp.visible = false; this.#itemInHand(false); ctx.hiker.emote = ''; }
  }

  // kneel and drink from the water through the LifeStraw
  #straw(dt, a, ctx) {
    const T = a.target, u = a.t / a.dur;
    if (!a.set) {
      a.set = true; this.#useModel(this.canteen);
      this.groundCanteen.visible = false; this.groundBag.visible = false; this.groundPot.visible = false;
      this.emit({ type: 'sound', name: 'plop' });
    }
    ctx.hiker.emote = 'Crouch Idle 01';
    this.#itemInHand(false);
    this.station.visible = true;
    this.filterObj.visible = false; this.cup.visible = false; this.strainer.visible = false;
    this.strawObj.visible = true;
    const yaw = Math.atan2(-Math.sin(ctx.yaw), -Math.cos(ctx.yaw));
    this.strawObj.scale.setScalar(PROP);
    this.strawObj.position.set(T.x, T.level + 0.04, T.z);
    this.strawObj.rotation.set(0, yaw - Math.PI / 2, -0.25);
    if (!a.took && u > 0.55) {
      a.took = true;
      const went = ctx.hydration.drink(0.28);
      if (went < 0.27) this.emit({ type: 'toast', text: 'Your stomach is full. Give it a few minutes.' });
      else {
        this.straw.litres += went;
        const turb = ctx.turbAt(T.x, T.z);
        const h = mulH(sourceHaz(T.kind, T.x, T.z), SURV.straw);
        if (ctx.hydration.swallowRaw(went, sumH(h) * (1 + 2 * turb))) this.emit({ type: 'sick' });
        if (!this.warnedStraw) { this.warnedStraw = true; this.emit({ type: 'toast', text: 'The LifeStraw takes out bacteria and protozoa, but not viruses.' }); }
      }
      this.emit({ type: 'sound', name: 'gulp' });
      this.emit({ type: 'ripple', x: T.x, z: T.z, amp: 0.2 });
    }
    if (a.t >= a.dur) { this.act = null; this.#hide(); }
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

  // dunk the container at the water's edge (the bladder is scooped with its wide mouth)
  #fill(dt, a, ctx) {
    const c = a.c;
    if (!a.set) { this.#setStation(ctx, a); a.set = true; this.#useModel(c); this.emit({ type: 'sound', name: 'plop' }); }
    const T = a.target;
    ctx.hiker.emote = 'Crouch Idle 01';
    this.#itemInHand(false);
    this.filterObj.visible = false; this.cup.visible = false; this.strainer.visible = false;
    this.station.visible = true;
    // it lies tilted in the water, neck up and out
    const g = this.gm;
    g.scale.setScalar(PROP);
    g.position.set(T.x, T.level - 0.035, T.z);
    g.rotation.set(0, Math.atan2(a.fx, a.fz), g.userData.tilt + 0.08 * Math.sin(a.t * 3));
    // it fills; the water's turbidity at the spot (and what we stir up) is what goes in
    if (!a.noted) {
      a.noted = true;
      a.turb0 = ctx.turbAt(T.x, T.z);
      a.src = sourceHaz(T.kind, T.x, T.z);
      if (c.water > 0.02 && kindOf(c) !== 'raw') this.emit({ type: 'toast', text: `Topping up treated water with untreated water makes all of it untreated${c.iod ? ' (the iodine has to start over)' : ''}.`, warn: true });
      c.haz = { ...effective(c) };                                           // what is in there is what counts from here
      c.iod = null; c.hot = 0;
      if (c.water < 0.02) c.haz = { ...NONE };
      c.treated = false; c.how = '';
    }
    a.stir += dt;
    if (a.stir > 0.35) { a.stir = 0; this.emit({ type: 'stir', x: T.x, z: T.z, a: 0.01 }); this.emit({ type: 'ripple', x: T.x, z: T.z, amp: 0.35 }); }
    const rate = (c === this.bladder ? 0.3 : c === this.pot ? 0.4 : FILL_LS) * dt;
    const add = Math.min(rate, c.cap - c.water);
    const turb = a.turb0 + 0.25 * Math.min(1, a.t / 3);                 // dunking stirs the bottom up a little
    const old = c.water, tot = old + add;
    if (tot > 0) {
      c.turb = (c.turb * old + turb * add) / tot;
      for (const k of ['g', 'c', 'b', 'v']) c.haz[k] = (c.haz[k] * old + a.src[k] * add) / tot;
    }
    c.water = tot;
    c.from = T.kind;
    if (c.water >= c.cap - 0.005) {
      this.emit({ type: 'toast', text: `${c === this.bladder ? 'Bladder' : c === this.pot ? 'Pot' : 'Canteen'} full (${c.water.toFixed(2)} L). It is untreated${c.turb > 0.25 ? ' and silty' : ''}: treat it before you drink.` });
      this.emit({ type: 'sound', name: 'lid' });
      this.act = null; this.#hide();
    }
  }

  // set the container down, run the intake hose into it, pump through the ceramic into the clean cup, pour it back
  #pumpStep(dt, a, ctx) {
    const c = a.c, f = this.filter;
    if (!a.set) {
      this.#setStation(ctx, a);
      a.set = true; this.pumped = 0; a.batch = 0; a.pour = 0;
      this.#useModel(c);
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
    // the pour: the cup tips into the container, then pumping starts again
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

  // a pot at the fire's edge, the container beside it: heat it, then hold a rolling boil
  #boilStep(dt, a, ctx) {
    const c = a.c, F = ctx.fire;
    if (!F) { this.cancel(); return; }
    if (!a.set) {
      a.set = true;
      this.#setStation(ctx, a);
      this.#useModel(c);
      const dx = ctx.p.x - F.x, dz = ctx.p.z - F.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
      a.px = F.x + ux * 0.72; a.pz = F.z + uz * 0.72;
      a.bx = a.px - uz * 0.45; a.bz = a.pz + ux * 0.45;
      const y = (x, z) => this.#ground(x, z);
      const own = c === this.pot;
      this.potObj = own ? this.groundPot : this.potModel;
      this.potObj.scale.setScalar(PROP); this.potObj.position.set(a.px, y(a.px, a.pz), a.pz); this.potObj.rotation.set(0, 0, 0);
      if (!own) {
        this.gm.scale.setScalar(PROP);
        this.gm.position.set(a.bx, y(a.bx, a.bz) + this.gm.userData.lift * PROP, a.bz); this.gm.rotation.set(0, Math.atan2(-ux, -uz), 0);
      }
      this.steam.position.set(a.px, y(a.px, a.pz) + 0.3, a.pz);
      this.emit({ type: 'sound', name: 'pour' });
    }
    ctx.hiker.emote = 'Crouch Idle 01';
    this.#itemInHand(false);
    this.station.visible = true;
    this.filterObj.visible = false; this.cup.visible = false; this.strainer.visible = false;
    this.potObj.visible = true; this.steam.visible = true;
    const gm = ctx.gm || 0;
    if (!a.rolling) {
      a.heat += gm;
      this.potObj.userData.lid.rotation.z = 0;
      this.steam.material.opacity = 0.06 * smooth(0.5, 1, a.heat / a.heatNeed);
      if (a.heat >= a.heatNeed) { a.rolling = true; this.emit({ type: 'toast', text: `Rolling boil. Hold it there ${a.need} minute${a.need > 1 ? 's' : ''}${ctx.p.y > 2000 ? ' (3 at this altitude)' : ''}.` }); this.emit({ type: 'sound', name: 'creak' }); }
    } else {
      a.roll += gm;
      this.potObj.userData.lid.rotation.z = 0.04 * Math.sin(a.t * 22);
      this.potObj.userData.lid.position.y = 0.17 + 0.004 * Math.abs(Math.sin(a.t * 17));
      this.steam.material.opacity = 0.18 + 0.08 * Math.sin(a.t * 3);
      this.steam.scale.set(1 + 0.2 * Math.sin(a.t * 2.1), 1.6 + 0.3 * Math.sin(a.t * 3.3), 1);
      this.steam.position.y += Math.sin(a.t * 2) * 0.0015;
      if (a.roll >= a.need) {
        c.haz = mulH(c.haz, SURV.boil); c.iod = null; c.treated = true; c.how = 'boiled'; c.hot = COOL_MIN;
        this.emit({ type: 'toast', text: `Boiled ${a.need} min. Safe, but hot: give it ${COOL_MIN} minutes to cool.` });
        this.emit({ type: 'sound', name: 'ready' });
        this.act = null; this.#hide();
      }
    }
  }

  // two containers side by side on dry ground; the pot tips over the other and the water runs across, its hazards mixing by volume
  #pourStep(dt, a, ctx) {
    const { from, to } = a;
    if (!a.set) {
      a.set = true; this.#setStation(ctx, a);
      this.#useModel(to);
      this.potModel.visible = false; this.groundPot.visible = true;
      const y = (x, z) => this.#ground(x, z);
      const px = a.bx + a.rx * 0.16, pz = a.bz + a.rz * 0.16, tx = a.bx - a.rx * 0.16, tz = a.bz - a.rz * 0.16;
      a.pp = [px, pz]; a.tp = [tx, tz];
      this.groundPot.scale.setScalar(PROP); this.gm.scale.setScalar(PROP);
      this.gm.position.set(tx, y(tx, tz) + this.gm.userData.lift * PROP, tz); this.gm.rotation.set(0, Math.atan2(a.fx, a.fz), 0);
      this.pourFrom0 = from.water;
      this.emit({ type: 'sound', name: 'lid' });
      a.base = { to: { w: to.water, h: { ...effective(to) }, t: to.turb, treated: to.treated || to.water < 0.02 }, from: { h: { ...effective(from) }, t: from.turb, treated: from.treated } };
      to.iod = null;
    }
    ctx.hiker.emote = 'Crouch Idle 01';
    this.#itemInHand(false);
    this.station.visible = true;
    this.filterObj.visible = false; this.cup.visible = false; this.strainer.visible = false;
    const k = Math.min(1, a.t / a.dur), tip = Math.sin(Math.min(1, k * 1.15) * Math.PI) * 1.1;
    const y = this.#ground(a.pp[0], a.pp[1]);
    this.groundPot.position.set(a.pp[0] + a.rx * 0.0, y + 0.0 + 0.06 * tip, a.pp[1] + a.rz * 0.0);
    this.groundPot.rotation.set(0, Math.atan2(a.fx, a.fz), 0);
    this.groundPot.rotateZ(tip * 0.9);
    const part = smooth(0.2, 0.85, k), amt = a.amount * part, d = amt - a.done;
    if (d > 0) {
      a.done = amt;
      from.water = Math.max(0, from.water - d);
      const B = a.base, tot = B.to.w + amt;
      for (const key of ['g', 'c', 'b', 'v']) to.haz[key] = (B.to.h[key] * B.to.w + B.from.h[key] * amt) / tot;
      to.turb = (B.to.t * B.to.w + B.from.t * amt) / tot;
      to.water = tot;
    }
    if (a.t >= a.dur) {
      const B = a.base;
      to.treated = B.to.treated && B.from.treated; to.how = to.treated ? from.how || to.how : '';
      to.hot = 0;
      this.emit({ type: 'toast', text: `Poured ${a.amount.toFixed(2)} L into the ${this.name}${to.treated ? '' : '. Part of it is untreated, so all of it is'}.`, warn: !to.treated });
      this.emit({ type: 'sound', name: 'pour' });
      this.act = null; this.#hide();
    }
  }

  #layoutStation(a, ctx) {
    const { bx, bz, rx, rz, fx, fz } = a;
    const y = (x, z) => this.#ground(x, z);
    const gm = this.gm;
    const place = (obj, x, z, yaw = 0) => { obj.position.set(x, y(x, z), z); obj.rotation.set(0, yaw, 0); };
    for (const o of [gm, this.filterObj, this.cup]) o.scale.setScalar(PROP);
    const cx = bx - rx * 0.2, cz = bz - rz * 0.2;
    place(gm, cx, cz, Math.atan2(fx, fz));
    gm.position.y += gm.userData.lift * PROP;
    gm.rotation.z = 0;
    place(this.filterObj, bx + rx * 0.06, bz + rz * 0.06, Math.atan2(rx, rz) + Math.PI / 2);
    place(this.cup, bx + rx * 0.3, bz + rz * 0.3, 0);
    a.cupPos = this.cup.position.clone();
    const my = gm.userData.mouthY;
    a.mouth = new THREE.Vector3(cx, gm.position.y + my * PROP, cz);
    // hoses: intake from the filter's side port into the container's mouth; output from the other port into the cup
    const hoses = this.filterObj.userData.hoses;
    while (hoses.children.length) { const o = hoses.children[0]; hoses.remove(o); o.geometry?.dispose(); }
    this.filterObj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.filterObj.matrixWorld).invert();
    const L = (v) => v.clone().applyMatrix4(inv);
    const ip = this.filterObj.userData.intakePort.clone(), op = this.filterObj.userData.outPort.clone();
    const canMouth = L(new THREE.Vector3(cx, gm.position.y + (my - 0.005) * PROP, cz));
    const cupTop = L(new THREE.Vector3(this.cup.position.x, this.cup.position.y + 0.1 * PROP, this.cup.position.z));
    hoses.add(hose([ip, ip.clone().add(new THREE.Vector3(-0.05, -0.04, 0.03)), canMouth.clone().add(new THREE.Vector3(0.06, 0.07, 0.03)), canMouth.clone().add(new THREE.Vector3(0, 0.02, 0))], 0.0045, this.m.hose));
    hoses.add(hose([op, op.clone().add(new THREE.Vector3(0.05, -0.03, 0.0)), cupTop.clone().add(new THREE.Vector3(-0.02, 0.07, 0.0)), cupTop], 0.0045, this.m.silicone));
    this.strainer.position.set(cx, gm.position.y + 0.02, cz + 0.0);
    this.strainer.visible = false;                                         // the strainer is inside the container
    this.cup.rotation.set(0, 0, 0);
    this.cup.userData.water.position.y = 0.006;
  }

  #finishPump(a) {
    const c = a.c;
    const done = this.pumped || 0;
    if (done > 0) {
      const frac = Math.min(1, done / Math.max(0.02, c.water)), S = SURV.pump;
      for (const k of ['g', 'c', 'b', 'v']) c.haz[k] *= frac * S[k] + (1 - frac);   // the part not yet pumped stays raw
      c.iod = null;
      if (frac > 0.98) {
        c.treated = true; c.how = 'filtered'; c.from = 'filtered';
        this.emit({ type: 'toast', text: `Filtered: ${c.water.toFixed(2)} L${this.filter.clog > 0.6 ? '. The element is clogging.' : '.'} Viruses still get through a ceramic filter.` });
        this.emit({ type: 'sound', name: 'ready' });
      } else this.emit({ type: 'toast', text: `${done.toFixed(2)} L filtered; the rest is still untreated.`, warn: true });
    }
    this.pumped = 0;
    this.act = null;
    this.#hide();
  }

  #scrub(dt, a, ctx) {
    const f = this.filter;
    if (!a.set) { this.#setStation(ctx, a); a.set = true; this.#useModel(this.cur); this.#layoutStation(a, ctx); this.filterObj.updateMatrixWorld(true); this.emit({ type: 'sound', name: 'creak' }); }
    ctx.hiker.emote = 'Crouch Idle 01';
    this.station.visible = true;
    this.filterObj.visible = true; this.cup.visible = true; this.strainer.visible = false;
    this.groundCanteen.visible = false; this.groundBag.visible = false; this.groundPot.visible = false;
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
