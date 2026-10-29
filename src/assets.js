import * as THREE from 'three';
import { carModel, landmark } from './features.js';
import { tentMesh, stoolMesh } from './camp.js';
import { FamilyTent } from './famtent.js';
import { Fire } from './fire.js';

// The placeable assets that are not instanced trees and rocks: the two cars, the landmarks (outhouse, the two signs) and the camp
// (solo tent, family tent, stool, a fire ring). Each is a factory that builds a fresh Object3D standing on y = 0 and facing +z,
// plus a collision radius (0 = walk through). The editor's palette lists them; `Placements` draws them as plain clones.

/** models: the loaded glTF scenes of main.js (civic, maverick, outhouse, wildernessSign, trailheadSign). */
export function objectAssets(models) {
  const list = [];
  const add = (id, name, group, make, solid = 0) => list.push({ id, name, group, make, solid, obj: true });
  if (models.civic) add('car:civic', 'Honda Civic', 'Cars', () => carModel(models.civic), 2.1);
  if (models.maverick) add('car:maverick', 'Ford Maverick', 'Cars', () => carModel(models.maverick), 2.2);
  if (models.outhouse) add('landmark:outhouse', 'Outhouse', 'Signs & buildings', () => landmark(models.outhouse, 2.5), 1.1);
  if (models.wildernessSign) add('landmark:wilderness-sign', 'Wilderness sign', 'Signs & buildings', () => landmark(models.wildernessSign, 2.4), 0.5);
  if (models.trailheadSign) add('landmark:trailhead-sign', 'Trailhead sign', 'Signs & buildings', () => landmark(models.trailheadSign, 2.2), 0.5);
  add('camp:tent', 'Solo tent', 'Camp', () => { const g = tentMesh(); g.visible = true; return g; }, 1.3);
  add('camp:family-tent', 'Family tent', 'Camp', () => { const t = new FamilyTent(new THREE.Scene()); t.group.visible = true; return t.group; }, 2.4);
  add('camp:stool', 'Camp stool', 'Camp', () => stoolMesh(), 0.35);
  add('camp:fire-ring', 'Fire ring', 'Camp', () => { const f = new Fire(); f.visible = true; f.flames.visible = false; f.sparks.visible = false; f.smoke.visible = false; f.light.intensity = 0; f.glow.intensity = 0; return f.group; }, 0.9);
  return list;
}
