import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { rng } from './trees.js';
import { valueNoise } from './noise.js';
import { ROCK, BOXEL } from './terrain.js';

// Rock for the Rawah: pale pink-grey Precambrian granite and gneiss that
// weathers into angular blocks, flat slabs and teeth. Three shapes, a few
// variants each, are instanced by flora.js, which also assembles them into
// outcrops, tors, talus fans and lone glacial erratics. Each is an icosphere
// shaved flat against a handful of random planes, so it reads as cut stone,
// then painted per vertex with banding and a little lichen.

// hex is read as sRGB; vertex colours are linear, so these are converted once here
const GRANITE = [new THREE.Color(0x7d716a), new THREE.Color(0x6a6866), new THREE.Color(0x86766a)];
const LICHEN = [new THREE.Color(0x76803f), new THREE.Color(0xb27a2c)];

/** A faceted stone: `sx, sy, sz` stretch it, `planes` shaves it, `cut` is how far in the first planes bite. */
function stone(seed, { sx = 1, sy = 0.75, sz = 1, planes = 9, cut = 0.72, flat = -0.5, tilt = 0 }) {
  const R = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const cuts = [];
  for (let k = 0; k < planes; k++) {
    // the first plane is a roughly flat top, the rest are random faces
    const n = k === 0
      ? new THREE.Vector3((R() - 0.5) * tilt, 1, (R() - 0.5) * tilt).normalize()
      : new THREE.Vector3(R() - 0.5, (R() - 0.5) * 1.2, R() - 0.5).normalize();
    cuts.push([n, (k === 0 ? 0.8 : cut) + R() * 0.2]);
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    for (const [n, d] of cuts) { const o = v.dot(n) - d; if (o > 0) v.addScaledVector(n, -o); }
    if (v.y < flat) v.y = flat;
    const jit = 1 + (valueNoise(v.x * 3 + seed, v.z * 3, seed) - 0.5) * 0.22;
    p.setXYZ(i, v.x * sx * jit, v.y * sy, v.z * sz * jit);
  }
  const flatGeo = g;                   // an icosphere is already unindexed, so every face gets its own normal: hard edges
  flatGeo.deleteAttribute('uv');
  flatGeo.computeVertexNormals();
  // paint: horizontal banding, lighter up top, a few lichen patches
  const pos = flatGeo.attributes.position, nor = flatGeo.attributes.normal, col = new Float32Array(pos.count * 3);
  const base = GRANITE[seed % GRANITE.length], c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const band = 0.5 + 0.5 * Math.sin(y * 7 + valueNoise(x * 2, z * 2, seed + 3) * 4);
    const mottled = valueNoise(x * 6 + seed, z * 6, seed + 9);
    const crack = Math.abs(valueNoise(x * 9 + seed * 3, z * 9, seed + 13) - 0.5) < 0.045 ? 0.78 : 1;
    c.copy(base).multiplyScalar((0.62 + band * 0.22 + mottled * 0.3 + Math.max(0, nor.getY(i)) * 0.1) * (0.78 + 0.22 * Math.min(1, Math.max(0, y + 0.6))) * crack);
    if (nor.getY(i) > 0.3 && valueNoise(x * 4, z * 4, seed + 21) > 0.55) c.lerp(LICHEN[(seed >> 1) & 1], 0.55);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  flatGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flatGeo.computeBoundingBox();
  flatGeo.computeBoundingSphere();
  return flatGeo;
}

// The user's Rock Boulder 10 pack (assets/rocks/): twelve scanned-and-baked boulders, 16-160 triangles each, that share one 2048 px
// albedo and one tangent normal atlas. The 3ds Max file is read by tools/extract_boulders.py (no other mesh came with it) into
// boulders.bin (per rock: unindexed positions, smooth normals, uvs; y up, base at y = 0, metres) and boulders.json.
const BOULDER_K = 0.6;      // the biggest native rock is 3.3 m; 0.6 puts it at 2 units across, the size of the old icosphere boulder at scale 1
let BOULDERS = null;

export async function loadBoulders() {
  try {
    const [meta, buf] = await Promise.all([
      fetch('assets/rocks/boulders.json').then((r) => r.json()),
      fetch('assets/rocks/boulders.bin').then((r) => r.arrayBuffer()),
    ]);
    const f = new Float32Array(buf);
    const loader = new THREE.TextureLoader();
    const [albedo, normal] = await Promise.all([loader.loadAsync('assets/rocks/boulder_albedo.jpg'), loader.loadAsync('assets/rocks/boulder_normal.webp')]);
    albedo.colorSpace = THREE.SRGBColorSpace;
    for (const t of [albedo, normal]) { t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
    const geos = meta.slice(0, 12).map((m) => {   // the 13th is a stray 8-triangle fragment
      const g = new THREE.BufferGeometry(), n = m.n, o = m.o;
      const pos = f.slice(o, o + n * 3);
      for (let i = 0; i < pos.length; i++) pos[i] *= BOULDER_K;
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(f.slice(o + n * 3, o + n * 6), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(f.slice(o + n * 6, o + n * 8), 2));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return g;
    });
    BOULDERS = { geos, albedo, normal };
  } catch (err) {
    console.warn('boulder pack failed to load, using the built rocks', err);
  }
}

/** Unit-ish geometry for every rock kind; scale in flora to the size wanted. */
export function rockGeometries() {
  const boulder = [stone(1, { sy: 0.8 }), stone(2, { sx: 1.15, sy: 0.7, sz: 0.9, planes: 11 }), stone(3, { sy: 0.9, planes: 8, cut: 0.66 }), stone(4, { sx: 0.9, sy: 0.65, sz: 1.2, planes: 10 })];
  return {
    granite: BOULDERS ? BOULDERS.geos : boulder,
    textured: !!BOULDERS,
    boulder,
    slab: [stone(5, { sx: 1.5, sy: 0.3, sz: 1.1, planes: 6, cut: 0.9, flat: -0.28, tilt: 0.3 }), stone(6, { sx: 1.2, sy: 0.4, sz: 1.5, planes: 7, cut: 0.86, flat: -0.38, tilt: 0.4 })],
    tooth: [stone(7, { sx: 0.5, sy: 2.1, sz: 0.55, planes: 8, cut: 0.7, flat: -0.8 }), stone(8, { sx: 0.65, sy: 1.6, sz: 0.5, planes: 9, cut: 0.66, flat: -0.8 })],
  };
}

export function rockMaterial(extent = 1) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    withAtmosphere(shader, { weather: 1, occlusion: 0.8 });
    shader.uniforms.uRock = ROCK;
    shader.uniforms.uBoxel = BOXEL;
    shader.uniforms.uRExtent = { value: extent };
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 rwp = (uViewInv * vec4(vFogView, 1.0)).xyz;
        // real granite grain from the terrain's rock sheet, and the boxel field's damp darkening the stone
        diffuseColor.rgb *= mix(vec3(1.0), texture2D(uRock, rwp.xz * 0.22 + rwp.y * 0.1).rgb, 0.55);
        diffuseColor.rgb *= 1.0 - texture2D(uBoxel, rwp.xz / uRExtent + 0.5).r * 0.32;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uRock;\nuniform sampler2D uBoxel;\nuniform float uRExtent;');
  };
  mat.customProgramCacheKey = () => 'rawah-rock';
  return mat;
}

/** The boulder pack's stone: its own albedo and normal atlas, through the shared light, weather and the boxel field's damp. */
export function graniteMaterial(extent = 1) {
  const mat = new THREE.MeshLambertMaterial({ map: BOULDERS.albedo, normalMap: BOULDERS.normal });
  mat.onBeforeCompile = (shader) => {
    withAtmosphere(shader, { weather: 1, occlusion: 0.8 });
    shader.uniforms.uBoxel = BOXEL;
    shader.uniforms.uRExtent = { value: extent };
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 rwp = (uViewInv * vec4(vFogView, 1.0)).xyz;
        // the pack's stone is a dark brown-grey; the Rawah batholith is a pale pinkish grey, (its albedo averages about a fifth of the old rocks' brightness) so lift it hard and take some of the brown out
        diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))), diffuseColor.rgb, 0.7) * vec3(3.6, 3.3, 3.15);
        diffuseColor.rgb *= 1.0 - texture2D(uBoxel, rwp.xz / uRExtent + 0.5).r * 0.32;
      }`).replace('#include <common>', '#include <common>\nuniform sampler2D uBoxel;\nuniform float uRExtent;');
  };
  mat.customProgramCacheKey = () => 'rawah-granite';
  return mat;
}
