import * as THREE from 'three';

// The cut-out plants of the user's vegetation pack (tools/cut_vegetation.py): three atlases of single plants, one cell each,
// with real sizes in vegetation.json. grass.webp is the sedges and bunchgrasses, forbs.webp the wildflowers and cushion plants,
// shrubs.webp the willows, understory shrubs and dwarf shrubs. `plants[i]` = { x, y (cell), h, w (metres the plant stands),
// cardH, cardW (metres the whole cell covers), bloom }; `cats` gives each category's first plant and count.
// Returns null when the files are missing and the game falls back to the painted grass and the old willows.

export async function loadVegetation(base = './assets/vegetation/') {
  try {
    const meta = await fetch(base + 'vegetation.json').then((r) => r.json());
    const loader = new THREE.TextureLoader();
    const out = {};
    await Promise.all(['grass', 'forbs', 'shrubs'].map(async (k) => {
      const tex = await loader.loadAsync(`${base}${k}.webp`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      out[k] = { meta: meta[k], tex };
    }));
    return out;
  } catch (e) { console.warn('vegetation cut-outs failed to load; using the painted grass', e); return null; }
}

/** The streamside plants (tools/cut_streamside.py): willow thickets, sedge clumps and yellow and white wildflowers, one atlas. */
export async function loadStreamside(base = './assets/vegetation/') {
  try {
    const [meta, tex] = await Promise.all([fetch(base + 'bank.json').then((r) => r.json()), new THREE.TextureLoader().loadAsync(base + 'bank.webp')]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return { meta, tex };
  } catch (e) { console.warn('streamside plants failed to load', e); return null; }
}
