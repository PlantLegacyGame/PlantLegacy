/**
 * The seam collar must be the bowl's own rim ring, not a second circle near it.
 *
 * The first collar drew its own circle, inset and with a different segment count.
 * Two nearly-equal polygons leave slivers wherever they disagree, and that is
 * exactly what leaked sky at the lip. These tests pin the property that fixed it:
 * one collar column per bowl rim vertex, at the same world position, on the same
 * ground.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CAVITY_PROFILE, createCavityBowl, updateCavityBowl } from './index.ts';
import { createCavitySeam, updateCavitySeam } from './seamMesh.ts';

const build = (surface: (x: number, z: number) => number, eyeY = 40) => {
  const bowl = createCavityBowl(new THREE.Color('#3a2a1c'), new THREE.Color('#6a5440'), 24, 12);
  updateCavityBowl(
    bowl,
    new THREE.Vector3(0, 0, 0),
    2,
    1,
    surface,
    new THREE.Vector3(0, eyeY, 0),
    1.2,
  );
  const seam = createCavitySeam(bowl, new THREE.Color('#3a2a1c'));
  updateCavitySeam(seam, bowl, surface);
  return { bowl, seam };
};

/** The rim ring by layout: the builder emits the profile's first ring first. */
const rimIndices = (mesh: THREE.Mesh): number[] => {
  const position = mesh.geometry.getAttribute('position');
  const columns = Math.round(position.count / CAVITY_PROFILE.length);
  return Array.from({ length: columns }, (_, i) => i);
};

describe('the seam collar follows the bowl mouth ring', () => {
  it('has exactly one column per rim vertex', () => {
    const { bowl, seam } = build(() => 0);
    const rim = rimIndices(bowl);
    const seamPosition = seam.geometry.getAttribute('position');
    assert.equal(seamPosition.count, rim.length * 2, 'the collar is not built on the rim ring');
    assert.equal(seam.userData.rimIndices.length, rim.length);
    assert.deepEqual(seam.userData.rimIndices, rim, 'the collar kept a different ring order');
  });

  it('puts every column exactly on its rim vertex, in world space', () => {
    // A slope, so the mouth plane is lifted and each rim vertex is conformed to
    // its own ground: a copy of a circle would miss this.
    const surface = (x: number, z: number): number => 0.4 * x - 0.25 * z;
    const { bowl, seam } = build(surface);
    const rim = rimIndices(bowl);
    const bowlPosition = bowl.geometry.getAttribute('position');
    const seamPosition = seam.geometry.getAttribute('position');
    for (let i = 0; i < rim.length; i += 1) {
      const index = rim[i];
      const worldX = bowl.position.x + bowlPosition.getX(index) * bowl.scale.x;
      const worldZ = bowl.position.z + bowlPosition.getZ(index) * bowl.scale.z;
      assert.ok(
        Math.abs(seamPosition.getX(i * 2) - worldX) < 1e-6 &&
          Math.abs(seamPosition.getZ(i * 2) - worldZ) < 1e-6,
        `column ${i} is not on its rim vertex`,
      );
      // The lip sits on the ground the rim cuts, not on the rim's buried height:
      // leaving that gap open is what leaked sky at oblique angles.
      assert.ok(
        Math.abs(seamPosition.getY(i * 2) - surface(worldX, worldZ)) < 1e-6,
        `column ${i} is not on the ground it cuts`,
      );
    }
  });

  it('hangs below the rim, never above it', () => {
    const { seam } = build(() => 0);
    const position = seam.geometry.getAttribute('position');
    for (let i = 0; i < position.count / 2; i += 1) {
      assert.ok(
        position.getY(i * 2 + 1) < position.getY(i * 2),
        'the collar reaches up over the lip',
      );
    }
  });

  it('follows the bowl when the mouth moves', () => {
    const { bowl, seam } = build(() => 0);
    const before = seam.userData.lastKey;
    updateCavityBowl(
      bowl,
      new THREE.Vector3(1, 0, 0),
      2,
      1,
      (x) => 0.2 * x,
      new THREE.Vector3(1, 40, 0),
      1.2,
    );
    updateCavitySeam(seam, bowl, (x) => 0.2 * x);
    assert.notEqual(seam.userData.lastKey, before, 'the collar did not follow the bowl');
  });
});

describe('the shell may not show outside the mouth from above', () => {
  it('drops the outside of the shell and keeps the pit wall', () => {
    // Measured with a FrontSide render: front faces are the exterior (the ribbed
    // dome above the hill), back faces are the pit's wall. Getting this backwards
    // once discarded the wall and left the crater a closed brown dish.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'bowlMesh.ts'),
      'utf8',
    );
    assert.match(
      source,
      /if \(gl_FrontFacing && distance\(vBowlWorldPosition\.xz, uBowlApertureCenter\) > uBowlApertureRadius\) discard;/,
    );
    // The interior wall is the back faces; dropping those emptied the pit.
    assert.doesNotMatch(source, /!gl_FrontFacing/);
  });
});
