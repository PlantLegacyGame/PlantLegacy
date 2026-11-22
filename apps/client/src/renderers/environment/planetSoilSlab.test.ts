/**
 * The soil is a body with thickness, and these numbers are the point of it.
 *
 * A sheet has no bottom: opening the ground showed the back of one face and empty
 * space. The slab's underside must sit exactly `depth` under the surface it hangs
 * from, and there must be walls closing the gap, or the "thickness" is a number in
 * a config file rather than geometry.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { createSoilSlab } from './planetSoilSlab.ts';
import { patchLocalSurfaceY } from './planetSurface.ts';

const FIELD = {
  amplitudeM: 0,
  patchRadiusM: 90,
  seed: 1,
} as never;

function slab(depthM = 1.6, holeRadiusM = 0) {
  return createSoilSlab({
    radius: 400,
    field: FIELD as never,
    material: new THREE.MeshBasicMaterial(),
    segments: 16,
    extentM: 40,
    skinM: 0.02,
    depthM,
    holeRadiusM,
  });
}

describe('soil slab', () => {
  it('hangs a wall of real thickness off the patch it lines', () => {
    const mesh = slab(1.6);
    // Patch-local metres, placed at the body's radius, exactly like the patch.
    assert.equal(mesh.position.y, 400);
    const position = mesh.geometry.getAttribute('position');
    const half = 20;
    const segments = 16;
    const loopCount = segments * 4;
    // Top ring, then the same loop one slab lower.
    for (let i = 0; i < loopCount; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const top = patchLocalSurfaceY(400, x, z, FIELD as never, 0.02);
      // Float32 storage: millimetre agreement is what the geometry promises.
      assert.ok(Math.abs(position.getY(i) - top) < 1e-3, 'the wall top left the surface');
      const bottom = position.getY(loopCount + i);
      assert.ok(Math.abs(bottom - (top - 1.6)) < 1e-3, 'the slab is not 1.6 m thick');
      // The loop is the patch's own edge, not some inset square.
      assert.ok(Math.abs(Math.abs(x) - half) < 1e-6 || Math.abs(Math.abs(z) - half) < 1e-6);
    }
  });

  it('carries an underside, so there is earth under the roots', () => {
    const mesh = slab(1.6);
    const position = mesh.geometry.getAttribute('position');
    const loopCount = 16 * 4;
    const underCount = position.count - loopCount * 2;
    assert.ok(underCount > 0, 'the slab has no underside');
    for (let i = loopCount * 2; i < position.count; i += 1) {
      const top = patchLocalSurfaceY(400, position.getX(i), position.getZ(i), FIELD as never, 0.02);
      assert.ok(
        Math.abs(position.getY(i) - (top - 1.6)) < 1e-3,
        'the underside is not the surface minus the depth',
      );
    }
    assert.ok((mesh.geometry.getIndex()?.count ?? 0) > 0, 'the slab has no faces');
  });

  it('leaves the Root Sight cavity out of its underside', () => {
    // The earth's bottom is a sheet and the cavity is a void in the body. A
    // sheet that spans the cavity crosses the pit: a second floor inside it and
    // a flat ceiling across the hole from underneath.
    const mesh = slab(1.6, 6);
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    assert.ok(index, 'the slab has no index buffer');
    let underFaces = 0;
    for (let i = 0; i < index.count; i += 1) {
      const v = index.getX(i);
      const x = position.getX(v);
      const z = position.getZ(v);
      assert.ok(
        Math.hypot(x, z) >= 6,
        `an underside vertex sits ${Math.hypot(x, z).toFixed(2)} m from the cavity axis, inside the 6 m void`,
      );
      if (position.getY(v) < patchLocalSurfaceY(400, x, z, FIELD as never, 0.02) - 0.1)
        underFaces += 1;
    }
    assert.ok(underFaces > 0, 'the hole took the whole underside with it');
  });

  it('takes its thickness from the config, not from a constant', () => {
    const thin = slab(0.3);
    const position = thin.geometry.getAttribute('position');
    const top = patchLocalSurfaceY(400, position.getX(0), position.getZ(0), FIELD as never, 0.02);
    assert.ok(Math.abs((position.getY(64) ?? 0) - (top - 0.3)) < 1e-3);
    assert.equal(thin.name, 'planet-soil-slab');
  });
});
