import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

import {
  PlantContactShadows,
  plantShadowPatches,
  type SurfaceNormal,
  shadowPatchKey,
} from './PlantContactShadows.ts';

function make(groundNormal?: (x: number, z: number) => SurfaceNormal) {
  const scene = new THREE.Scene();
  const shadows = new PlantContactShadows({ scene, ...(groundNormal ? { groundNormal } : {}) });
  const group = scene.children[0] as THREE.Group;
  return { scene, shadows, group };
}

function shadeFor(group: THREE.Group, plantId: string): THREE.Group | undefined {
  return group.children.find(
    (child): child is THREE.Group => child instanceof THREE.Group && child.name.endsWith(plantId),
  );
}

function discFor(group: THREE.Group, plantId: string): THREE.Mesh | undefined {
  return shadeFor(group, plantId)?.children.find(
    (child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && child.name.startsWith('plant-contact-shadow-'),
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

    const shade = shadeFor(group, 'b');
    const disc = discFor(group, 'b');
    assert.ok(shade && disc);
    // The disc is built in the XY plane, so its own normal is +Z: after the
    // quaternion it has to point along the hill's normal, not the world's up.
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(disc.quaternion);
    const expected = new THREE.Vector3(tilted.x, tilted.y, tilted.z).normalize();
    assert.ok(facing.distanceTo(expected) < 1e-6, `disc faces ${facing.toArray()}`);
    assert.ok(Math.abs(shade.position.y - 3) < 0.1);
  });

  it('rides in place when only the spread changes, and follows a moved foot', () => {
    const { shadows, group } = make();
    shadows.update([{ plantId: 'a', x: 0, z: 0, groundY: 1, radius: 0.4 }]);
    const disc = discFor(group, 'a');
    const shade = shadeFor(group, 'a');
    assert.ok(disc && shade);
    const firstScale = disc.scale.x;
    shadows.update([{ plantId: 'a', x: 2.5, z: -1, groundY: 1.2, radius: 0.9 }]);
    assert.equal(shadows.size(), 1);
    assert.equal(group.children.length, 1);
    assert.ok(Math.abs(shade.position.x - 2.5) < 1e-6);
    assert.ok(disc.scale.x > firstScale);
  });

  it('never shrinks below a seed dot and never grows past a thicket', () => {
    const { shadows, group } = make();
    shadows.update([
      { plantId: 'seed', x: 0, z: 0, groundY: 0, radius: 0.001 },
      { plantId: 'thicket', x: 3, z: 0, groundY: 0, radius: 40 },
    ]);
    const seed = discFor(group, 'seed');
    const thicket = discFor(group, 'thicket');
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
    assert.equal(shadeFor(group, 'a'), undefined);
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
    const disc = discFor(group, 'a');
    assert.ok(disc);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(disc.quaternion);
    assert.ok(facing.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
  });

  it('draws one shade ellipse per part, pooled by plant', () => {
    const { shadows, group } = make();
    shadows.update(
      [{ plantId: 'a', x: 0, z: 0, groundY: 0, radius: 0.4 }],
      [
        {
          plantId: 'a',
          x: 0.2,
          z: 0.1,
          radiusX: 0.3,
          radiusZ: 0.1,
          angle: 0.5,
          opacity: 0.3,
          groundY: 0,
        },
        {
          plantId: 'a',
          x: -0.2,
          z: 0.1,
          radiusX: 0.2,
          radiusZ: 0.08,
          angle: 0.5,
          opacity: 0.2,
          groundY: 0,
        },
      ],
    );
    const shade = shadeFor(group, 'a');
    assert.ok(shade);
    const parts = shade.children.filter(
      (child) => child instanceof THREE.Mesh && child.name.startsWith('plant-shadow-part-'),
    );
    assert.equal(parts.length, 2);
    assert.ok(Math.abs(parts[0].scale.x - 0.3) < 1e-6);
    shadows.update([{ plantId: 'a', x: 0, z: 0, groundY: 0, radius: 0.4 }], []);
    const after = shade.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.name.startsWith('plant-shadow-part-'),
    );
    assert.ok(
      after.every((part) => !part.visible),
      'the parts are hidden, not leaked',
    );
  });
});

const flat = () => 0;

function node(x: number, y: number, z: number, radius = 0.05, type = 2) {
  return { position: { x, y, z }, radius, type } as const;
}

describe('projected body shade', () => {
  it('throws each part down the light and never a root', () => {
    const patches = plantShadowPatches(
      [node(0, 1, 0, 0.2, 2), node(0.5, 2, 0, 0.3, 2), node(0, -0.5, 0, 0.4, 0)],
      flat,
      { x: 0, y: 1, z: 0 }, // straight overhead
    );
    assert.equal(patches.length, 2, 'the buried root casts nothing');
    // Straight overhead: a part lands exactly under itself, so the part at
    // x = 0.5 lands at x = 0.5 and nothing lands at the root's x = 0.
    const xs = patches.map((patch) => patch.x).sort((a, b) => a - b);
    assert.ok(Math.abs(xs[0] ?? -1) < 1e-9);
    assert.ok(Math.abs((xs[1] ?? -1) - 0.5) < 1e-9);
    for (const patch of patches) assert.ok(Math.abs(patch.z) < 1e-9);
  });

  it('moves the shade as the sun moves, and stretches a tall part further', () => {
    const low = plantShadowPatches([node(0, 0.3, 0, 0.1)], flat, { x: 0.6, y: 0.8, z: 0 });
    const high = plantShadowPatches([node(0, 2.4, 0, 0.1)], flat, { x: 0.6, y: 0.8, z: 0 });
    assert.equal(low.length, 1);
    assert.equal(high.length, 1);
    assert.ok(high[0].x < low[0].x, 'a taller part lands further from the sun');
    assert.ok(high[0].radiusX > low[0].radiusX, 'and smears longer');
    assert.ok(high[0].opacity < low[0].opacity, 'and is fainter');
  });

  it('casts nothing with the sun down', () => {
    assert.deepEqual(plantShadowPatches([node(0, 1, 0)], flat, { x: 0, y: -1, z: 0 }), []);
  });

  it('keys on movement at the centimetre', () => {
    const base = [{ plantId: 'a', x: 0, z: 0, radiusX: 0.2, radiusZ: 0.1, angle: 0, opacity: 0.3 }];
    assert.equal(shadowPatchKey(base), shadowPatchKey([{ ...base[0] }]));
    assert.notEqual(shadowPatchKey(base), shadowPatchKey([{ ...base[0], x: 0.4 }]));
  });
});
