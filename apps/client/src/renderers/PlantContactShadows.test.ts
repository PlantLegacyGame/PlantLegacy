import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

import { PlantContactShadows, type SurfaceNormal } from './PlantContactShadows.ts';

function make(groundNormal?: (x: number, z: number) => SurfaceNormal) {
  const scene = new THREE.Scene();
  const shadows = new PlantContactShadows({ scene, ...(groundNormal ? { groundNormal } : {}) });
  const group = scene.children[0] as THREE.Group;
  return { scene, shadows, group };
}

function patchFor(group: THREE.Group, plantId: string): THREE.Mesh | undefined {
  return group.children.find(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.name.endsWith(plantId),
  );
}

describe('plant contact shadows', () => {
  it('lays one patch per plant in the ground plane', () => {
    const tilted: SurfaceNormal = { x: 0.4, y: 0.9, z: 0.1 };
    const { shadows, group } = make((x) => (x < 0 ? { x: 0, y: 1, z: 0 } : tilted));
    shadows.update([
      { plantId: 'a', x: -1, z: 0, groundY: 2, radius: 0.5 },
      { plantId: 'b', x: 2, z: 1, groundY: 3, radius: 0.8 },
    ]);
    assert.equal(shadows.size(), 2);
    assert.equal(group.children.length, 2);

    const patch = patchFor(group, 'b');
    assert.ok(patch);
    // The disc is built in the XY plane, so its own normal is +Z: after the
    // quaternion it has to point along the hill's normal, not the world's up.
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(patch.quaternion);
    const expected = new THREE.Vector3(tilted.x, tilted.y, tilted.z).normalize();
    assert.ok(facing.distanceTo(expected) < 1e-6, `patch faces ${facing.toArray()}`);
    assert.ok(Math.abs(patch.position.y - 3) < 0.1);
  });

  it('rides in place when only the spread changes, and follows a moved foot', () => {
    const { shadows, group } = make();
    shadows.update([{ plantId: 'a', x: 0, z: 0, groundY: 1, radius: 0.4 }]);
    const patch = patchFor(group, 'a');
    assert.ok(patch);
    const firstScale = patch.scale.x;
    shadows.update([{ plantId: 'a', x: 2.5, z: -1, groundY: 1.2, radius: 0.9 }]);
    assert.equal(shadows.size(), 1);
    assert.equal(group.children.length, 1);
    assert.ok(Math.abs(patch.position.x - 2.5) < 1e-6);
    assert.ok(patch.scale.x > firstScale);
  });

  it('never shrinks below a seed dot and never grows past a thicket', () => {
    const { shadows, group } = make();
    shadows.update([
      { plantId: 'seed', x: 0, z: 0, groundY: 0, radius: 0.001 },
      { plantId: 'thicket', x: 3, z: 0, groundY: 0, radius: 40 },
    ]);
    const seed = patchFor(group, 'seed');
    const thicket = patchFor(group, 'thicket');
    assert.ok(seed && thicket);
    assert.ok(seed.scale.x >= 0.12, `seed patch is ${seed.scale.x}`);
    assert.ok(thicket.scale.x <= 2.6 * 1.25, `thicket patch is ${thicket.scale.x}`);
  });

  it('removes the patch when its plant is no longer carried', () => {
    const { shadows, group } = make();
    shadows.update([
      { plantId: 'a', x: 0, z: 0, groundY: 0, radius: 0.3 },
      { plantId: 'b', x: 1, z: 0, groundY: 0, radius: 0.3 },
    ]);
    shadows.update([{ plantId: 'b', x: 1, z: 0, groundY: 0, radius: 0.3 }]);
    assert.equal(shadows.size(), 1);
    assert.equal(group.children.length, 1);
    assert.equal(patchFor(group, 'a'), undefined);
  });

  it('hides with the plant pass', () => {
    const { shadows, group } = make();
    shadows.setVisible(false);
    assert.equal(group.visible, false);
    shadows.setVisible(true);
    assert.equal(group.visible, true);
  });

  it('falls back to flat ground when the terrain normal is missing', () => {
    const { shadows, group } = make();
    shadows.update([{ plantId: 'a', x: 0, z: 0, groundY: 0, radius: 0.3 }]);
    const patch = patchFor(group, 'a');
    assert.ok(patch);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(patch.quaternion);
    assert.ok(facing.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
  });
});
