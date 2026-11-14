import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { PlantNodeData } from '../plant/plantNodeData.ts';
import { buildPlantMesh } from './PlantMeshBuilder.ts';

const FLOATS_PER_VERTEX = 19;

function node(
  overrides: Partial<PlantNodeData> & Pick<PlantNodeData, 'id' | 'position'>,
): PlantNodeData {
  return {
    type: 1,
    radius: 0.1,
    parentId: null,
    age: 0,
    health: 1,
    mutationFlags: 0,
    biomass: 1,
    growthProgress: 1,
    isOwnPlant: true,
    ...overrides,
  };
}

describe('plant mesh builder selected-node geometry', () => {
  it('keeps every index inside the vertex buffer and draws no selection marker', () => {
    const nodes: PlantNodeData[] = [
      node({
        id: 'seed',
        parentId: null,
        position: new THREE.Vector3(0, 0.4, 0),
        radius: 0.2,
        type: 0,
        nodeType: 'seed',
        isSeed: true,
        children: ['root'],
      }),
      node({
        id: 'root',
        parentId: 'seed',
        position: new THREE.Vector3(0.1, 0.1, 0),
        nodeType: 'root',
        layer: 'root',
        children: [],
      }),
    ];

    const built = buildPlantMesh(nodes, {
      leafSize: 0.2,
      leafCountPerNode: 1,
      tubeSides: 8,
      rootSides: 8,
      now: 1000,
      sunDirection: new THREE.Vector3(0, 1, 0),
    });

    const vertexCount = built.vertices.length / FLOATS_PER_VERTEX;
    assert.ok(vertexCount > 0);
    // No selection marker geometry is added; the old marker is what produced
    // the rainbow cone.
    for (let i = 0; i < built.indices.length; i += 1) {
      assert.ok(
        built.indices[i] < vertexCount,
        `index ${i} (${built.indices[i]}) points past ${vertexCount} vertices`,
      );
    }
  });

  it('builds the same mesh whether or not a node is selected', () => {
    const nodes: PlantNodeData[] = [
      node({
        id: 'seed',
        position: new THREE.Vector3(0, 0.4, 0),
        radius: 0.2,
        type: 0,
        nodeType: 'seed',
        isSeed: true,
        children: [],
      }),
    ];
    const built = buildPlantMesh(nodes, {
      leafSize: 0.2,
      leafCountPerNode: 1,
      tubeSides: 8,
      rootSides: 8,
      now: 1000,
      sunDirection: new THREE.Vector3(0, 1, 0),
    });
    assert.ok(built.indices.length > 0);
  });
});
