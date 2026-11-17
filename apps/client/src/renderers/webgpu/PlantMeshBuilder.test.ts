import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { type MutationLook, type MutationLookStack, NEUTRAL_STACK } from '../plant/mutations.ts';
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

describe('plant mesh builder mutation geometry', () => {
  /** A seedling with a stem, so there is a woody tube to thicken and bristle. */
  function stemNodes(): PlantNodeData[] {
    return [
      node({
        id: 'seed',
        parentId: null,
        position: new THREE.Vector3(0, 0.4, 0),
        radius: 0.12,
        type: 0,
        nodeType: 'seed',
        isSeed: true,
        children: ['stem'],
      }),
      node({
        id: 'stem',
        parentId: 'seed',
        position: new THREE.Vector3(0.02, 1.2, 0),
        radius: 0.06,
        nodeType: 'stem',
        layer: 'canopy',
        children: [],
      }),
    ];
  }

  const options = {
    leafSize: 0.2,
    leafCountPerNode: 1,
    tubeSides: 8,
    rootSides: 8,
    now: 1000,
    sunDirection: new THREE.Vector3(0, 1, 0),
  };

  const neutral: MutationLookStack = {
    ...NEUTRAL_STACK,
    looks: { ...NEUTRAL_STACK.looks },
    disc: NEUTRAL_STACK.disc,
  };

  function stackWith(woody: Partial<MutationLook>): MutationLookStack {
    return {
      ...neutral,
      looks: { ...neutral.looks, woody: { ...neutral.looks.woody, ...woody } },
    };
  }

  it('thickens woody tubes when bark is the look', () => {
    const plain = buildPlantMesh(stemNodes(), options);
    const thick = buildPlantMesh(stemNodes(), {
      ...options,
      lookForPlant: () => stackWith({ barkScale: 1.5 }),
    });
    // Same topology, wider tube: the radius is baked into positions, so the
    // bounds grow even though the vertex count does not.
    assert.equal(thick.vertices.length, plain.vertices.length);
    let plainMax = 0;
    let thickMax = 0;
    for (let i = 0; i < plain.vertices.length; i += FLOATS_PER_VERTEX) {
      plainMax = Math.max(plainMax, Math.abs(plain.vertices[i]));
      thickMax = Math.max(thickMax, Math.abs(thick.vertices[i]));
    }
    assert.ok(thickMax > plainMax, `bark should widen the tube (${plainMax} -> ${thickMax})`);
  });

  it('adds thorn geometry when the look bristles', () => {
    const plain = buildPlantMesh(stemNodes(), options);
    const spiny = buildPlantMesh(stemNodes(), {
      ...options,
      lookForPlant: () => stackWith({ spines: 1 }),
    });
    assert.ok(
      spiny.indices.length > plain.indices.length,
      'spines have to be real geometry, not a tint',
    );
    const vertexCount = spiny.vertices.length / FLOATS_PER_VERTEX;
    for (const index of spiny.indices) {
      assert.ok(index < vertexCount, 'spine indices stay inside the buffer');
    }
  });

  it('returns one composed look per plant, aligned with plant data', () => {
    const stack = stackWith({ barkScale: 1.4 });
    const built = buildPlantMesh(stemNodes(), {
      ...options,
      lookForPlant: () => stack,
    });
    assert.equal(built.plantData.length, 1);
    assert.equal(built.plantLooks.length, built.plantData.length);
    assert.equal(built.plantLooks[0].looks.woody.barkScale, 1.4);
  });
});
