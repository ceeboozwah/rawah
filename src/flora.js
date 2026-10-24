import * as THREE from 'three';
import { hash2 } from './noise.js';
import { buildSpecies, paintAtlas, foliageMaterial, foliageDepth, bakeImpostors, impostorGeometry, impostorMaterial } from './trees.js';
import { CULL, expandedFrustum, sphereInView } from './culling.js';
import { barkTexture } from './fire.js';

// Trees, burned snags, downed logs, krummholz, willows and boulders around the
// hiker. Placement is a jittered grid driven by World.cover(), which reads the
// Sentinel-2 land cover, so live forest, the 2020 burn and the aspen groves
// grow where they really are. Square tiles hold placement data only; a few
// global instanced meshes are refilled as you move: card-built trees close
// up (trees.js), crossed-quad impostors out to the horizon of the forest.

const TILE_M = 232;        // tile side in metres
const SPACING = 5.2;       // metres between placement candidates
const ROCK_R = 240;        // boulders and logs inside this radius
const REFILL_M = 10;       // move this far before refilling instances
const TREES = ['spruce', 'lodgepole', 'aspen', 'snag', 'krumm', 'willow'];
const KINDS = [...TREES, 'boulder', 'log'];
const CAP = { spruce: 4000, lodgepole: 3000, aspen: 2000, snag: 3000, krumm: 3000, willow: 1500, boulder: 6000, log: 4000 };
const IMP_CAP = 140000;
const STUMP_CAP = 1500;
const CHOPPABLE = ['spruce', 'lodgepole', 'aspen', 'snag'];
/** Trunk radius at the base for each kind at scale 1 (the same numbers trees.js builds with). */
export const TRUNK_R = { spruce: 0.26, lodgepole: 0.24, aspen: 0.17, snag: 0.22 };
const treeKey = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;
// Culling. The buffers are refilled only when the view has turned ROT_REFILL or moved
// REFILL_M, so the frustum used to fill them is wider than the camera's by CULL.margin
// (culling.js), which must stay above ROT_REFILL.
const ROT_REFILL = 0.12;   // radians
const OCC_FROM = 120;      // impostors nearer than this are never tested against the skyline
const TALL = 30;           // tallest tree, for tile bounds
const LOW_SUN = 0.55;      // below this (33 degrees up) shadows run long, and down a slope they run on without end: keep every caster
const SHADOW_REACH = 170;  // longest shadow worth keeping a caster for (the shadow map reaches about this far)
// height and crown radius of each kind at scale 1, for shadow-aware culling
const DIM = { spruce: [18, 3.4], lodgepole: [20, 3], aspen: [12, 3], snag: [19, 1.5], krumm: [3, 2], willow: [3, 2], boulder: [2.5, 2.5], log: [1, 3.2] };

function rockGeometries() {
  const boulder = new THREE.IcosahedronGeometry(1, 1);
  const p = boulder.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + hash2(Math.round(p.getX(i) * 50), Math.round(p.getZ(i) * 50), 11) * 0.32;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.78, p.getZ(i) * k);
  }
  boulder.computeVertexNormals();
  const log = new THREE.CylinderGeometry(0.16, 0.2, 6, 7, 1);
  log.rotateZ(Math.PI / 2);
  return { boulder, log };
}

export class Flora {
  constructor(world, scene, renderer, { card = 85, radius = 1250, thin = 700, impostor = 4096 } = {}, leaves = 'autumn') {
    this.world = world;
    this.cardR = card;          // full trees inside this radius
    this.radius = radius;       // impostors out to here
    this.thin = thin;           // beyond this, every other impostor
    this.uniforms = { uTime: { value: 0 }, uCalm: { value: 0.6 } };
    const atlas = paintAtlas(leaves);
    this.species = buildSpecies();
    const foliage = this.foliage = foliageMaterial(atlas, this.uniforms);
    const depth = foliageDepth(atlas, this.uniforms);
    this.impostors = bakeImpostors(renderer, this.species, foliage, impostor);

    this.group = new THREE.Group();
    scene.add(this.group);
    this.meshes = {};
    for (const kind of TREES) {
      this.meshes[kind] = this.species[kind].map((geo) => {
        const m = new THREE.InstancedMesh(geo, foliage, CAP[kind]);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, new THREE.Color());
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = kind !== 'willow';
        m.receiveShadow = true;
        m.customDepthMaterial = depth;
        this.group.add(m);
        return m;
      });
    }
    const rocks = rockGeometries();
    const stone = new THREE.MeshLambertMaterial({ color: 0x8e8882 });
    const wood = new THREE.MeshLambertMaterial({ color: 0x5d5650 });
    for (const [kind, geo, mat] of [['boulder', rocks.boulder, stone], ['log', rocks.log, wood]]) {
      const m = new THREE.InstancedMesh(geo, mat, CAP[kind]);
      m.setColorAt(0, new THREE.Color());
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.meshes[kind] = [m];
    }
    const ig = impostorGeometry(IMP_CAP);
    this.imp = new THREE.InstancedMesh(ig, impostorMaterial(this.impostors.texture, this.uniforms), IMP_CAP);
    this.imp.setColorAt(0, new THREE.Color());
    this.imp.count = 0;
    this.imp.frustumCulled = false;
    this.group.add(this.imp);

    // felled trees stay felled: a set of placement keys that #populate skips, and the stumps they leave
    this.felled = new Map();      // key -> [x, z, e, radius]
    const bark = barkTexture();
    const stumpMat = [new THREE.MeshLambertMaterial({ map: bark }), new THREE.MeshLambertMaterial({ color: 0xcfa468 }), new THREE.MeshLambertMaterial({ map: bark })];
    this.stumps = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.12, 1, 10), stumpMat, STUMP_CAP);
    this.stumps.count = 0;
    this.stumps.frustumCulled = false;
    this.stumps.castShadow = this.stumps.receiveShadow = true;
    this.group.add(this.stumps);

    this.tile = Math.max(8, Math.round(TILE_M / world.cell));
    this.nt = Math.ceil(world.N / this.tile);
    this.tiles = new Map();
    this.filledAt = new THREE.Vector3(Infinity, 0, 0);
    this.dirty = true;

    // view culling: set each frame by setView()
    this.camera = null;
    this.horizon = null;
    this.shadowDir = null;
    this.frustum = new THREE.Frustum();
    this.fill = { key: -1, dir: new THREE.Vector3(0, 0, -1), cam: new THREE.Vector3(Infinity, 0, 0), fov: 0, aspect: 0, horizon: -1, light: new THREE.Vector3(), shadows: false };
    this._dir = new THREE.Vector3();
    this.stats = { kept: 0, outside: 0, hidden: 0 };
  }

  /** The camera, the terrain skyline and the direction the light comes from (null when nothing casts a shadow). */
  setView(camera, horizon, shadowDir) {
    this.camera = camera;
    this.horizon = horizon;
    this.shadowDir = shadowDir;
  }

  #cullKey() {
    return (CULL.frustum && this.camera ? 1 : 0) + (CULL.occlusion && this.horizon?.active ? 2 : 0) + (this.shadowDir ? 4 : 0) + (this.shadowDir && this.shadowDir.y < LOW_SUN ? 8 : 0);
  }

  /** Has the view changed enough that the culled buffers no longer cover it? */
  #viewStale() {
    const f = this.fill, cam = this.camera;
    if (!cam) return false;
    const key = this.#cullKey();
    if (key !== f.key) return true;
    if (key & 1) {
      cam.getWorldDirection(this._dir);
      if (this._dir.angleTo(f.dir) > ROT_REFILL || Math.abs(cam.fov - f.fov) > 1 || cam.aspect !== f.aspect) return true;
      if (cam.position.distanceTo(f.cam) > REFILL_M) return true;
      if (key & 4 && this.shadowDir.angleTo(f.light) > 0.04) return true;
    }
    if (key & 2 && this.horizon.version !== f.horizon) return true;
    return false;
  }

  tileKey(x, z) {
    const w = this.world;
    return [Math.floor((x + w.half) / (this.tile * w.cell)), Math.floor((z + w.half) / (this.tile * w.cell))];
  }

  /** Stream placement tiles in and out; refill instances when we've moved far enough. Returns tiles still pending. */
  update(pos, budget = 1, dt = 0) {
    this.uniforms.uTime.value += dt;
    const w = this.world, size = this.tile * w.cell;
    const want = new Set();
    const span = Math.ceil(this.radius / size) + 1;
    const [ti, tj] = this.tileKey(pos.x, pos.z);
    const todo = [];
    for (let j = tj - span; j <= tj + span; j++) {
      for (let i = ti - span; i <= ti + span; i++) {
        if (i < 0 || j < 0 || i >= this.nt || j >= this.nt) continue;
        const cx = (i + 0.5) * size - w.half, cz = (j + 0.5) * size - w.half;
        const d = Math.max(0, Math.hypot(cx - pos.x, cz - pos.z) - size * 0.71);
        if (d > this.radius) continue;
        const key = j * this.nt + i;
        want.add(key);
        if (!this.tiles.has(key)) todo.push([d, key, i, j]);
      }
    }
    for (const key of this.tiles.keys()) if (!want.has(key)) { this.tiles.delete(key); this.dirty = true; }
    todo.sort((a, b) => a[0] - b[0]);
    const n = Math.min(budget, todo.length);
    for (let k = 0; k < n; k++) {
      const [, key, i, j] = todo[k];
      this.tiles.set(key, this.#populate(i, j));
      this.dirty = true;
    }
    if (this.dirty || this.filledAt.distanceTo(pos) > REFILL_M || this.#viewStale()) this.#fill(pos);
    return todo.length - n;
  }

  #populate(ti, tj) {
    const w = this.world, size = this.tile * w.cell;
    const x0 = ti * size - w.half, z0 = tj * size - w.half;
    const n = Math.floor(size / SPACING);
    const items = Object.fromEntries(KINDS.map((k) => [k, []]));
    const solids = []; // x, z, radius, top
    let minY = Infinity, maxY = -Infinity;
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const gi = ti * n + a, gj = tj * n + b;
        const r1 = hash2(gi, gj, 1), r2 = hash2(gi, gj, 2), r3 = hash2(gi, gj, 3);
        const x = x0 + (a + r2) * SPACING, z = z0 + (b + r3) * SPACING;
        const e = w.height(x, z);
        const cv = w.cover(x, z, e);
        let kind = null;
        const pf = cv.forest * 0.6, pa = cv.aspen * 0.5, ps = cv.snag * 0.42, pk = cv.krumm * 0.3;
        if (r1 < pa) kind = 'aspen';
        else if (r1 < pa + pf) kind = e < 2980 + hash2(gi, gj, 4) * 160 ? 'lodgepole' : 'spruce';
        else if (r1 < pa + pf + ps) kind = 'snag';
        else if (r1 < pa + pf + ps + pk) kind = 'krumm';
        else if (r1 > 1 - (cv.snag * 0.1 + cv.forest * 0.025)) kind = 'log';
        else if (e < 2780 && cv.meadow > 0.6 && cv.grade < 0.08 && r1 > 0.93) kind = 'willow';
        else if (r1 > 1 - (cv.rock * 0.05 + cv.alpine * 0.004)) kind = 'boulder';
        if (!kind) continue;
        if (this.felled.size && this.felled.has(treeKey(x, z))) continue;
        const lake = w.lakeAt(x, z);
        if (lake && e < lake.level + 0.7) continue;
        const near = w.nearestTrail(x, z);
        if (near.trail && near.d < near.trail.width / 2 + (kind === 'boulder' || kind === 'log' ? 1.2 : 2.2)) continue;
        const brook = w.nearestStream(x, z);
        if (brook.stream && brook.d < brook.stream.width / 2 + 1.5) continue;
        const s = kind === 'boulder' ? 0.5 + Math.pow(hash2(gi, gj, 5), 2.2) * (1.3 + cv.rock * 1.4)
          : kind === 'krumm' || kind === 'willow' ? 0.7 + hash2(gi, gj, 5) * 0.7
          : 0.62 + hash2(gi, gj, 5) * 0.55 - Math.max(0, e - cv.treeline + 120) / 450;
        if (s < 0.35) continue;
        items[kind].push(x, e, z, s, hash2(gi, gj, 6));
        if (e < minY) minY = e;
        if (e > maxY) maxY = e;
        if (kind === 'boulder') solids.push(x, z, s, e + s * 0.55);
        else if (kind !== 'krumm' && kind !== 'willow' && kind !== 'log') solids.push(x, z, (kind === 'snag' ? 0.2 : 0.3) * s + 0.1, Infinity);
      }
    }
    if (minY > maxY) minY = maxY = w.baseHeight(x0 + size / 2, z0 + size / 2);
    return { ti, tj, items, solids: new Float32Array(solids), x0, z0, size, minY, maxY };
  }

  /** Refill every instanced mesh from the tiles in range, leaving out what the camera cannot see. */
  #fill(pos) {
    this.filledAt.copy(pos);
    this.dirty = false;
    const counts = new Map();
    const all = Object.values(this.meshes).flat();
    for (const m of all) counts.set(m, 0);
    let ni = 0;
    const imp = this.imp, im = imp.instanceMatrix.array, ic = imp.instanceColor.array, cell = imp.geometry.attributes.aCell.array;
    const cells = this.impostors.cells;

    // what to cull against, remembered so #viewStale knows when it has gone out of date
    const f = this.fill, cam = this.camera, horizon = this.horizon;
    const key = f.key = this.#cullKey();
    const planes = key & 1 ? expandedFrustum(cam, CULL.margin, this.frustum).planes : null;
    const sky = key & 2 ? horizon : null;
    const sun = key & 4 ? this.shadowDir : null;
    if (cam) { cam.getWorldDirection(f.dir); f.cam.copy(cam.position); f.fov = cam.fov; f.aspect = cam.aspect; }
    f.horizon = horizon ? horizon.version : -1;
    if (sun) f.light.copy(sun);
    // a shadow falls away from the light: this much sideways per metre of height
    const sk = sun ? 1 / Math.max(sun.y, 0.05) : 0;
    const sx = sun ? -sun.x * sk : 0, sz = sun ? -sun.z * sk : 0;
    const keepCasters = !CULL.casters || !!(key & 8);
    const stats = this.stats;
    stats.kept = stats.outside = stats.hidden = 0;

    /** Could this caster, or the shadow it throws, be on screen? (centre, half-height, crown radius) */
    const casterSeen = (x, y, z, hh, R) => {
      if (!planes || keepCasters) return true;
      const r = hh + R + REFILL_M;
      if (sphereInView(planes, x, y + hh, z, r)) return true;
      if (!sun) return false;
      // the shadow of the crown runs out along the ground to here; look along it in four samples
      let h = hh * 2;
      const len = Math.hypot(sx, sz) * h;
      if (len > SHADOW_REACH) h *= SHADOW_REACH / len;
      const L = Math.hypot(sx, sz) * h * 0.125 + REFILL_M;
      for (let t = 0.125; t < 1.01; t += 0.25) if (sphereInView(planes, x + sx * h * t, y, z + sz * h * t, R + L)) return true;
      return false;
    };

    const put = (mesh, x, y, z, sx, sy, sz, rot, v) => {
      const k = counts.get(mesh);
      if (k >= mesh.instanceMatrix.count) return;
      counts.set(mesh, k + 1);
      writeMatrix(mesh.instanceMatrix.array, k, x, y, z, sx, sy, sz, rot);
      const c = mesh.instanceColor.array;
      c[k * 3] = v; c[k * 3 + 1] = v * 0.99; c[k * 3 + 2] = v * 0.96;
    };
    const rr = ROCK_R + REFILL_M;
    for (const tile of this.tiles.values()) {
      // whole-tile rejection: off screen (shadows included), or behind a ridge with nothing but far impostors in it
      if (planes || sky) {
        const cx = tile.x0 + tile.size / 2, cz = tile.z0 + tile.size / 2;
        const hy = (tile.maxY - tile.minY) / 2, cy = tile.minY + hy;
        // a sphere around the whole tile that holds every crown and shadow in it
        if (planes && !casterSeen(cx, cy, cz, hy + TALL / 2, tile.size * 0.71 + hy + 20)) { stats.outside++; continue; }
        // past the boulders and the full trees a tile holds nothing but impostors, which cast no shadow
        const near = Math.hypot(cx - pos.x, cz - pos.z) - tile.size * 0.71;
        if (sky && near > rr && sky.hiddenBox(tile.x0, tile.x0 + tile.size, tile.z0, tile.z0 + tile.size, tile.maxY + TALL)) { stats.hidden++; continue; }
      }
      for (const kind of KINDS) {
        const list = tile.items[kind];
        const variants = this.meshes[kind];
        const [dh, dr] = DIM[kind];
        for (let k = 0; k < list.length; k += 5) {
          const x = list[k], e = list[k + 1], z = list[k + 2], s = list[k + 3], r = list[k + 4];
          const ex = x - pos.x, ez = z - pos.z, d = Math.sqrt(ex * ex + ez * ez);
          const rot = r * Math.PI * 2, v = 0.82 + r * 0.3;
          if (kind === 'boulder') {
            if (d < ROCK_R && casterSeen(x, e, z, dh * s * 0.5, dr * s)) put(variants[0], x, e - s * 0.2, z, s * (0.9 + r * 0.5), s, s * (1.3 - r * 0.4), rot, v);
            continue;
          }
          if (kind === 'log') {
            if (d < ROCK_R && casterSeen(x, e, z, 0.5 * s, dr)) put(variants[0], x, e + 0.12, z, 0.6 + s * 0.6, 1, 1, rot, v);
            continue;
          }
          const vi = Math.floor(((r * 7.31) % 1) * variants.length);
          if (d < this.cardR) {
            if (casterSeen(x, e, z, dh * s * 0.5, dr * s)) { put(variants[vi], x, e - 0.15, z, s, s, s, rot, v); stats.kept++; }
            else stats.outside++;
            continue;
          }
          if (d > this.radius || (d > this.thin && r > 0.5) || ni >= IMP_CAP) continue;
          const c = cells[kind][vi];
          if (planes && !sphereInView(planes, x, e + c.h * s * 0.5, z, c.h * s * 0.5 + REFILL_M)) { stats.outside++; continue; }
          if (sky && d > OCC_FROM && sky.hidden(x, e + c.h * s, z)) { stats.hidden++; continue; }
          writeMatrix(im, ni, x, e - 0.15, z, c.w * s, c.h * s, c.w * s, rot);
          ic[ni * 3] = v; ic[ni * 3 + 1] = v; ic[ni * 3 + 2] = v;
          cell[ni * 2] = c.u; cell[ni * 2 + 1] = c.v;
          ni++;
        }
      }
    }
    for (const m of all) {
      m.count = counts.get(m);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    imp.count = ni;
    imp.instanceMatrix.needsUpdate = true;
    imp.instanceColor.needsUpdate = true;
    imp.geometry.attributes.aCell.needsUpdate = true;
  }

  // ---------------------------------------------------------------- felling
  /** The tree in front of you within reach, as a reference, or null. */
  treeAt(p, yaw, reach = 3.2) {
    const w = this.world, size = this.tile * w.cell;
    const [ti, tj] = this.tileKey(p.x, p.z);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bs = Infinity;
    for (let j = tj - 1; j <= tj + 1; j++) {
      for (let i = ti - 1; i <= ti + 1; i++) {
        const tile = this.tiles.get(j * this.nt + i);
        if (!tile) continue;
        for (const kind of CHOPPABLE) {
          const list = tile.items[kind];
          for (let k = 0; k < list.length; k += 5) {
            const x = list[k], z = list[k + 2], s = list[k + 3];
            const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz), edge = d - TRUNK_R[kind] * s;
            if (edge > reach || d < 0.05) continue;
            const facing = (dx * fx + dz * fz) / d;
            if (facing < 0.55) continue;
            const score = edge - facing * 1.2;
            if (score < bs) { bs = score; best = { tile, kind, k, x, e: list[k + 1], z, s, r: list[k + 4], d }; }
          }
        }
      }
    }
    return best;
  }

  /** Standing trees within r of (x, z): { x, z, rad }. Only the tiles around the point (those are loaded). */
  treesAround(x, z, r) {
    const out = [], [ti, tj] = this.tileKey(x, z);
    for (let j = tj - 1; j <= tj + 1; j++) {
      for (let i = ti - 1; i <= ti + 1; i++) {
        const tile = this.tiles.get(j * this.nt + i);
        if (!tile) continue;
        for (const kind of CHOPPABLE) {
          const list = tile.items[kind];
          for (let k = 0; k < list.length; k += 5) {
            if (Math.hypot(list[k] - x, list[k + 2] - z) <= r) out.push({ x: list[k], z: list[k + 2], rad: TRUNK_R[kind] * list[k + 3] });
          }
        }
      }
    }
    return out;
  }

  /** Take a tree out of the forest, leaving a stump. Returns what the falling tree needs. */
  fell(ref) {
    const list = ref.tile.items[ref.kind];
    // find it again (the lists may have been rebuilt): same position
    let k = -1;
    for (let q = 0; q < list.length; q += 5) if (list[q] === ref.x && list[q + 2] === ref.z) { k = q; break; }
    if (k < 0) return null;
    list.splice(k, 5);
    const sol = ref.tile.solids;
    for (let q = 0; q < sol.length; q += 4) {
      if (Math.abs(sol[q] - ref.x) < 1e-3 && Math.abs(sol[q + 1] - ref.z) < 1e-3 && sol[q + 3] === Infinity) {
        const next = new Float32Array(sol.length - 4);
        next.set(sol.subarray(0, q)); next.set(sol.subarray(q + 4), q);
        ref.tile.solids = next;
        break;
      }
    }
    const rad = TRUNK_R[ref.kind] * ref.s;
    this.#addStump(ref.x, ref.e, ref.z, rad);
    this.felled.set(treeKey(ref.x, ref.z), [ref.x, ref.z, ref.e, rad]);
    this.dirty = true;
    const variants = this.species[ref.kind];
    const vi = Math.floor(((ref.r * 7.31) % 1) * variants.length);
    return { geo: variants[vi], rot: ref.r * Math.PI * 2, kind: ref.kind, x: ref.x, e: ref.e - 0.15, z: ref.z, s: ref.s, rad };
  }

  #addStump(x, e, z, rad) {
    const n = this.stumps.count;
    if (n >= STUMP_CAP) return;
    const m = new THREE.Matrix4().makeScale(rad, 0.42, rad).setPosition(x, e + 0.18, z);
    this.stumps.setMatrixAt(n, m);
    this.stumps.count = n + 1;
    this.stumps.instanceMatrix.needsUpdate = true;
  }

  /** What has been felled, for saving: [x, z, ground, radius]. */
  felledList() { return [...this.felled.values()]; }

  /** Put a saved set of felled trees back: out of the forest, stumps in. */
  applyFelled(list) {
    for (const [x, z, e, rad] of list || []) {
      const key = treeKey(x, z);
      if (this.felled.has(key)) continue;
      this.felled.set(key, [x, z, e, rad]);
      this.#addStump(x, e, z, rad);
      for (const tile of this.tiles.values()) {
        for (const kind of CHOPPABLE) {
          const arr = tile.items[kind];
          for (let q = 0; q < arr.length; q += 5) if (treeKey(arr[q], arr[q + 2]) === key) { arr.splice(q, 5); q -= 5; }
        }
        const sol = tile.solids;
        for (let q = 0; q < sol.length; q += 4) {
          if (Math.abs(sol[q] - x) < 1e-3 && Math.abs(sol[q + 1] - z) < 1e-3 && sol[q + 3] === Infinity) {
            const next = new Float32Array(sol.length - 4);
            next.set(sol.subarray(0, q)); next.set(sol.subarray(q + 4), q);
            tile.solids = next;
            break;
          }
        }
      }
    }
    this.dirty = true;
  }

  /** Push a circle of radius r out of trunks and boulders; returns ground lift from boulder tops. */
  collide(p, r, feetY) {
    let ground = -Infinity;
    const w = this.world, size = this.tile * w.cell;
    const fi = (p.x + w.half) / size, fj = (p.z + w.half) / size;
    for (let j = Math.floor(fj - 0.1); j <= Math.floor(fj + 0.1); j++) {
      for (let i = Math.floor(fi - 0.1); i <= Math.floor(fi + 0.1); i++) {
        const tile = this.tiles.get(j * this.nt + i);
        if (!tile) continue;
        const s = tile.solids;
        for (let k = 0; k < s.length; k += 4) {
          const dx = p.x - s[k], dz = p.z - s[k + 1];
          const rr = s[k + 2] + r;
          const d2 = dx * dx + dz * dz;
          if (d2 > rr * rr) continue;
          const top = s[k + 3];
          if (top !== Infinity) {
            // boulder: a dome you can stand on if you are already near its top
            const R = s[k + 2];
            const dd = Math.sqrt(d2);
            const surf = dd < R ? top - R * 0.55 + Math.sqrt(R * R - dd * dd) * 0.55 : -Infinity;
            if (feetY > surf - 0.45) { ground = Math.max(ground, surf); continue; }
          }
          const d = Math.sqrt(d2) || 1e-3;
          p.x = s[k] + (dx / d) * rr;
          p.z = s[k + 1] + (dz / d) * rr;
        }
      }
    }
    return ground;
  }

  /** Nearest standing tree within reach (for gathering deadfall). */
  treeNear(x, z, reach) {
    for (const tile of this.tiles.values()) {
      const s = tile.solids;
      for (let k = 0; k < s.length; k += 4) {
        if (s[k + 3] === Infinity && Math.hypot(s[k] - x, s[k + 1] - z) < reach) return true;
      }
    }
    return false;
  }
}

/** Column-major TRS with a rotation about Y, written straight into an instance buffer. */
function writeMatrix(a, i, x, y, z, sx, sy, sz, rot) {
  const c = Math.cos(rot), s = Math.sin(rot), o = i * 16;
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
