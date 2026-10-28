import * as THREE from 'three';

// Icons for the pack and the quick bar, drawn from the game's own models: each one is rendered once, at start, to a small
// transparent picture by a throwaway renderer. The models' materials hook into the shared sky and fog, so they are swapped
// for plain lit ones here; colour and texture carry over.

/** items: { id: { obj: THREE.Object3D, spin?: radians about the view axis, yaw?: turn about Y } } -> { id: dataURL } */
export function renderIcons(items, size = 128) {
  const out = {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch { return out; }
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6258, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-2, 3, 4);
  scene.add(sun);
  for (const [id, { obj, spin = 0, yaw = 0.5, pitch = 0.35 }] of Object.entries(items)) {
    try {
      const root = new THREE.Group(), model = obj.clone(true);
      model.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        if (!m || o.visible === false) return;
        o.material = new THREE.MeshStandardMaterial({
          color: m.color ? m.color.clone() : 0xcccccc, map: m.map || null, roughness: Math.min(0.9, m.roughness ?? 0.7), metalness: m.metalness ?? 0,
          transparent: !!m.transparent, opacity: m.opacity ?? 1, side: m.side ?? THREE.FrontSide,
        });
      });
      model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.set(1, 1, 1);
      root.add(model);
      root.rotation.set(pitch, yaw, spin, 'ZYX');
      scene.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const half = Math.max(s.x, s.y) * 0.56 + 1e-4;
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 50);
      cam.position.set(c.x, c.y, c.z + 10);
      cam.lookAt(c);
      renderer.render(scene, cam);
      out[id] = renderer.domElement.toDataURL('image/png');
      scene.remove(root);
    } catch { /* keep the line icon */ }
  }
  renderer.dispose();
  renderer.forceContextLoss?.();
  return out;
}
