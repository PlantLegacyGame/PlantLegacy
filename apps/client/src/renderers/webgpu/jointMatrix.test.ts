import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { PlantNodeData } from '../plant/plantNodeData.ts';
import { jointMatrixFor } from './jointMatrix.ts';

function node(overrides: Partial<PlantNodeData> = {}): PlantNodeData {
  return {
    id: 'p1:stem1',
    position: new THREE.Vector3(1.29, 1.57, 3.55),
    parentId: 'p1:seed',
    growthProgress: 1,
    parentAttachX: 1.29,
    parentAttachY: 1.22,
    parentAttachZ: 3.55,
    targetX: 1.29,
    targetY: 1.57,
    targetZ: 3.55,
    radius: 0.026,
    biomass: 5,
    nodeType: 'stem',
    ...overrides,
  } as PlantNodeData;
}

const ORIGIN = new THREE.Vector3();

describe('jointMatrixFor', () => {
  it('leaves a finished part exactly where the mesh builder put it', () => {
    const part = node();
    const point = part.position.clone();
    const moved = point.clone().applyMatrix4(jointMatrixFor(part));
    assert.ok(moved.distanceTo(point) < 1e-9, `moved ${point.distanceTo(moved)} m`);
  });

  it('does not slide a part away from its parent while it grows', () => {
    for (const progress of [0, 0.25, 0.5, 0.9, 1]) {
      const part = node({ growthProgress: progress });
      const attach = new THREE.Vector3(part.parentAttachX, part.parentAttachY, part.parentAttachZ);
      const moved = attach.clone().applyMatrix4(jointMatrixFor(part));
      assert.ok(moved.distanceTo(attach) < 1e-9, `progress ${progress} moved the attach point`);
    }
  });

  it('contains no translation, so a node with no attach point cannot drift', () => {
    const part = node({
      parentAttachX: undefined,
      parentAttachY: undefined,
      parentAttachZ: undefined,
    });
    const matrix = jointMatrixFor(part);
    const translation = new THREE.Vector3().setFromMatrixPosition(matrix);
    assert.ok(translation.distanceTo(ORIGIN) < 1e-9);
  });

  it('is the identity, including for the seed', () => {
    const seed = node({
      id: 'p1:seed',
      parentId: null,
      nodeType: 'seed',
      growthProgress: 1,
      parentAttachX: undefined,
      parentAttachY: undefined,
      parentAttachZ: undefined,
    });
    const matrix = jointMatrixFor(seed);
    assert.ok(matrix.equals(new THREE.Matrix4()));
  });
});
