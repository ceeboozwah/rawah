import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { tubeMesh } from './fireworks.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// The hand tools, built from boxes and flat extrusions: an axe and a machete (and a firework tube).
// Each is modelled in metres with the grip at the origin, the head along +Y and
// the cutting edge toward +X, so one transform puts it in a hand (character.js)
// and another in front of the camera (props.js).

export const TOOLS = ['fists', 'axe', 'machete', 'fireworks', 'mind'];
export const TOOL_NAME = { fists: 'Bare hands', axe: 'Axe', machete: 'Machete', fireworks: 'Fireworks', mind: 'Telekinesis' };

let mats = null;
function materials() {
  if (mats) return mats;
  const lit = (color, key) => {
    const m = new THREE.MeshLambertMaterial({ color });
    m.onBeforeCompile = (shader) => withAtmosphere(shader, { weather: 0.5, occlusion: 0.6 });
    m.customProgramCacheKey = () => `rawah-tool-${key}`;
    return m;
  };
  mats = { wood: lit(0x7a5632, 'wood'), steel: lit(0x9aa0a6, 'steel'), edge: lit(0xc9ced2, 'edge'), grip: lit(0x25221f, 'grip') };
  return mats;
}

/** A flat shape from [x, y] points, extruded `t` metres thick and centred on z = 0. */
function plate(points, t) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  return g;
}

// The axe is the user's Lumberjack Axe model (assets/tools/axe.fbx: 58 cm, centimetre units, lying along X with the head at -X,
// the cutting edge toward -Y and the haft offset 3.7 cm toward +Y from the head's middle). `loadAxe` re-seats the vertices into the
// tool frame (grip at the origin, head +Y, edge +X; 1.4x the model's size so it is about the length of the old axe) and wears the
// pack's albedo (with its ambient occlusion baked in) and normal map (assets/tools/axe_albedo.jpg, axe_normal.webp, from the 2048 px
// PNGs; its roughness and metal maps are not used, the tool material is Lambert). `buildTool('axe')` uses it; until it has loaded,
// or if it fails, the built-from-boxes axe below stays and is swapped when the model arrives.
const AXE_SCALE = 1.4, AXE_GRIP = 16.4;   // metres per model cm is 0.01 x AXE_SCALE; the grip sits 16.4 cm up the haft from the middle
let axeGeo = null, axeMat = null;
const waiting = new Set();

export async function loadAxe() {
  try {
    // the model names its textures by the author's own paths: do not go looking for them, load the packed ones below
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => (/\.(png|jpe?g|tga)$/i.test(url) ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' : url));
    const tex = new THREE.TextureLoader();
    const [fbx, map, normalMap] = await Promise.all([
      new FBXLoader(manager).loadAsync('assets/tools/axe.fbx'),
      tex.loadAsync('assets/tools/axe_albedo.jpg'), tex.loadAsync('assets/tools/axe_normal.webp'),
    ]);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4; normalMap.anisotropy = 4;
    let mesh = null;
    fbx.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    const src = mesh.geometry, pos = src.attributes.position, nor = src.attributes.normal, n = pos.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), k = 0.01 * AXE_SCALE;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // model (x, y, z) -> tool (-y, -x, -z): the haft along +Y toward the head, the edge toward +X
      P[i * 3] = (-y + 3.7) * k; P[i * 3 + 1] = (-x + AXE_GRIP) * k; P[i * 3 + 2] = -z * k;
      N[i * 3] = -nor.getY(i); N[i * 3 + 1] = -nor.getX(i); N[i * 3 + 2] = -nor.getZ(i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', src.attributes.uv.clone());
    if (src.index) g.setIndex(src.index.clone());
    g.computeBoundingSphere();
    axeMat = new THREE.MeshLambertMaterial({ map, normalMap });
    axeMat.onBeforeCompile = (shader) => withAtmosphere(shader, { weather: 0.5, occlusion: 0.6 });
    axeMat.customProgramCacheKey = () => 'rawah-tool-axe-model';
    axeGeo = g;
    for (const grp of waiting) fitAxe(grp);
    waiting.clear();
  } catch (err) { console.warn('axe model not loaded, keeping the plain one', err); }
}

function fitAxe(group) {
  for (const o of [...group.children]) group.remove(o);
  const o = new THREE.Mesh(axeGeo, axeMat);
  o.castShadow = true;
  group.add(o);
}

export function buildTool(kind) {
  const m = materials(), g = new THREE.Group();
  const part = (geo, mat) => { const o = new THREE.Mesh(geo, mat); o.castShadow = true; g.add(o); return o; };
  if (kind === 'axe' && axeGeo) { fitAxe(g); return g; }
  if (kind === 'axe') {
    waiting.add(g);
    // the plain axe until the model has loaded: a hickory haft, and a steel head with a poll behind the bit
    const haft = part(new THREE.BoxGeometry(0.034, 0.78, 0.03), m.wood);
    haft.position.y = 0.2;
    part(plate([[-0.035, 0.44], [-0.035, 0.58], [0.03, 0.58], [0.135, 0.64], [0.145, 0.37], [0.03, 0.44]], 0.032), m.steel);
    part(plate([[0.135, 0.64], [0.15, 0.505], [0.145, 0.37], [0.125, 0.4], [0.128, 0.61]], 0.034), m.edge);
  } else if (kind === 'fireworks') {
    // a mortar tube held by its middle
    const tube = tubeMesh(0);
    tube.position.y = -0.15;
    g.add(tube);
  } else if (kind === 'machete') {
    // a long, broad blade with a clipped point, and a black handle
    const handle = part(new THREE.BoxGeometry(0.03, 0.14, 0.026), m.grip);
    handle.position.y = -0.02;
    part(plate([[-0.012, 0.05], [0.03, 0.055], [0.05, 0.4], [0.045, 0.5], [0.005, 0.56], [-0.012, 0.5]], 0.006), m.steel);
    part(plate([[0.03, 0.055], [0.036, 0.055], [0.056, 0.4], [0.05, 0.5], [0.044, 0.5], [0.05, 0.4]], 0.007), m.edge);
  }
  return g;
}
