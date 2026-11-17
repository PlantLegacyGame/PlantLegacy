/**
 * The skirt must be its own mesh, and it must hang off the conformed rim.
 *
 * Every consumer of the bowl's geometry counts rings; the first version of this
 * added a hidden sixth ring to the bowl's buffer and silently moved the floor
 * depth and the rim indices. These guards keep the skirt out of that buffer and
 * keep its top edge on the rim.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { createCavityBowl } from './bowlMesh.ts';
import { CAVITY_PROFILE, CAVITY_SKIRT_DEPTH_M } from './profile.ts';
import { createCavitySkirt, updateCavitySkirt } from './skirtMesh.ts';

describe('cavity skirt', () => {
  const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'));

  it('lives in its own mesh, not in the bowl ring buffer', () => {
    const before = bowl.geometry.getAttribute('position').count;
    const skirt = createCavitySkirt(bowl);
    const after = bowl.geometry.getAttribute('position').count;
    assert.equal(after, before, 'creating the skirt changed the bowl geometry');
    assert.notEqual(skirt, bowl);
    assert.equal(skirt.name, 'root-sight-skirt');
    assert.equal(bowl.geometry.getAttribute('position').count % CAVITY_PROFILE.length, 0);
    assert.equal(skirt.geometry.getAttribute('position').count % 2, 0, 'the skirt is a ring pair');
  });

  it('hangs its top edge off the bowl rim and its wall down by the skirt depth', () => {
    const skirt = createCavitySkirt(bowl);
    // Move the bowl's rim the way the conform does, then hang the skirt.
    const rim = bowl.geometry.getAttribute('position') as THREE.BufferAttribute;
    rim.setY(0, 0.42);
    rim.setY(1, -0.31);
    updateCavitySkirt(skirt, bowl);
    const position = skirt.geometry.getAttribute('position');
    for (const c of [0, 1]) {
      assert.equal(position.getX(c * 2), rim.getX(c), 'the skirt left the rim');
      assert.equal(position.getY(c * 2), rim.getY(c), 'the skirt top is off the rim height');
      assert.equal(position.getZ(c * 2), rim.getZ(c), 'the skirt left the rim');
      assert.ok(
        Math.abs(position.getY(c * 2 + 1) - (rim.getY(c) - CAVITY_SKIRT_DEPTH_M)) < 1e-6,
        'the skirt wall is the wrong depth',
      );
    }
  });

  it('hangs the same depth of earth whatever the rim fit stretches the bowl by', () => {
    // The rim conform stretches the shell to follow ground that falls away
    // under the mouth, and the skirt is built in the bowl's local units. Left
    // in profile units it became a 9 m cylinder of shell on a 2 m hole - the
    // black wall the pit appeared to grow into as the camera orbited.
    const stretched = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'));
    const skirt = createCavitySkirt(stretched);
    updateCavitySkirt(skirt, stretched);
    const flatTop = skirt.geometry.getAttribute('position').getY(0);
    const flatBottom = skirt.geometry.getAttribute('position').getY(1);
    assert.ok(
      Math.abs(flatTop - flatBottom - CAVITY_SKIRT_DEPTH_M) < 1e-6,
      'the unstretched skirt is the wrong depth',
    );

    stretched.scale.y = 9;
    updateCavitySkirt(skirt, stretched);
    const rim = stretched.geometry.getAttribute('position');
    const bottom = skirt.geometry.getAttribute('position');
    for (const c of [1, 2, 3]) {
      const localDepth = rim.getY(c * 2) - bottom.getY(c * 2 + 1);
      const worldDepth = localDepth * stretched.scale.y;
      assert.ok(
        Math.abs(worldDepth - CAVITY_SKIRT_DEPTH_M) < 1e-6,
        `the stretched skirt hangs ${worldDepth.toFixed(2)} m of earth, not ${CAVITY_SKIRT_DEPTH_M} m`,
      );
    }
  });
});
