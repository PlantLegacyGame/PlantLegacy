import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

import { DrawnGround } from './drawnGround.ts';

function tiltedPlane(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(10, 10, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  // A horizontal plane 1 m up, tipped about Z in world space so it rises
  // towards +x (its normal leans towards -x).
  mesh.position.y = 1;
  mesh.rotation.z = 0.25;
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('drawn ground', () => {
  it('seats on the drawn triangle, not on the height field under it', () => {
    const ground = new DrawnGround();
    ground.setFallback(() => 5);
    ground.setMesh(tiltedPlane());
    const y = ground.height(0, 0);
    // The mesh is at 1 m, the field says 5: the ray must win.
    assert.ok(Math.abs(y - 1) < 0.02, `height ${y}`);
  });

  it('falls back to the field where the mesh has no triangle', () => {
    const ground = new DrawnGround();
    ground.setFallback(() => 4.5);
    // No mesh at all, and then a mesh far away from the sample point.
    assert.equal(ground.height(0, 0), 4.5);
    ground.setMesh(tiltedPlane());
    assert.equal(ground.height(50, 50), 4.5);
  });

  it('takes the slope of the drawn surface, not of the field', () => {
    const ground = new DrawnGround();
    ground.setFallback(() => 1);
    ground.setMesh(tiltedPlane());
    const sample = ground.sample(0, 0);
    const normal = new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z);
    assert.ok(Math.abs(normal.length() - 1) < 1e-6, 'normal must be unit length');
    // Tipped about Z, so the surface rises with x and its normal leans to -x.
    assert.ok(normal.x < -0.2, `normal leans x=${normal.x}`);
    assert.ok(normal.y > 0.9);
    assert.ok(Math.abs(normal.z) < 1e-3);
  });
});
