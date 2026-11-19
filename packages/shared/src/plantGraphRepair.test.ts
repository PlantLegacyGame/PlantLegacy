/**
 * Repair the defects a load can actually fix, and report the rest to validation.
 *
 * `parentId` is the authority for structure: a `children` list that disagrees
 * with it is rebuilt rather than trusted, and a node hanging off a parent that
 * does not exist is dropped with its subtree. A clean plant comes back
 * untouched.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Plant, PlantNode } from './growth/index.js';
import { droppedNodeCount, isCleanRepair, repairPlantGraph } from './plantGraphRepair.ts';

function node(id: string, parentId: string | null, children: string[] = []): PlantNode {
  return {
    id,
    plantId: 'plant_1',
    type: parentId === null ? 'seed' : 'stem',
    layer: 'root',
    x: 0,
    y: 0,
    z: 0,
    biomass: 1,
    age: 0,
    parentId,
    children,
    radius: 0.1,
    health: 1,
    growthProgress: 1,
    resourceDrawWater: 0,
    resourceDrawNutrients: 0,
  } as unknown as PlantNode;
}

function plant(nodes: PlantNode[], rootNodeId: string | null = 'plant_1:seed'): Plant {
  return {
    id: 'plant_1',
    ownerId: 'owner_1',
    worldId: 'world_0',
    nodes: new Map(nodes.map((n) => [n.id, n])),
    rootNodeId,
  } as unknown as Plant;
}

describe('repairPlantGraph (INV-GR-02/04/05)', () => {
  it('leaves a clean plant alone and reports nothing', () => {
    const p = plant([
      node('plant_1:seed', null, ['plant_1:stem0']),
      node('plant_1:stem0', 'plant_1:seed'),
    ]);
    const repair = repairPlantGraph(p);
    assert.equal(isCleanRepair(repair), true);
    assert.deepEqual(p.nodes.get('plant_1:seed')?.children, ['plant_1:stem0']);
  });

  it('gives a node its owning plant id back', () => {
    const stray = node('plant_1:stem0', 'plant_1:seed');
    stray.plantId = 'plant_other';
    const p = plant([node('plant_1:seed', null, ['plant_1:stem0']), stray]);

    const repair = repairPlantGraph(p);

    assert.equal(repair.plantIdFixed, 1);
    assert.equal(p.nodes.get('plant_1:stem0')?.plantId, 'plant_1');
  });

  it('rebuilds a children list from parentId rather than trusting it', () => {
    // The seed claims a child that does not exist and omits the real one.
    const p = plant([
      node('plant_1:seed', null, ['plant_gone']),
      node('plant_1:stem0', 'plant_1:seed'),
    ]);

    const repair = repairPlantGraph(p);

    assert.deepEqual(p.nodes.get('plant_1:seed')?.children, ['plant_1:stem0']);
    assert.equal(repair.childListsRebuilt, 1);
    assert.equal(repair.danglingChildrenDropped, 1);
  });

  it('drops a node whose parent is gone, and its subtree, instead of keeping a fake link', () => {
    const p = plant([
      node('plant_1:seed', null, ['plant_1:stem0']),
      node('plant_1:stem0', 'plant_1:seed', ['plant_1:leaf0']),
      node('plant_1:leaf0', 'plant_1:stem0'),
      node('plant_1:ghost', 'plant_missing'),
    ]);

    const repair = repairPlantGraph(p);

    assert.equal(p.nodes.has('plant_1:ghost'), false);
    assert.equal(repair.orphansDropped, 1);
    assert.equal(droppedNodeCount(repair), 1);
    // The healthy branch is untouched.
    assert.equal(p.nodes.has('plant_1:leaf0'), true);
  });

  it('takes the one parentless node as the root when none was recorded', () => {
    const p = plant([node('plant_1:seed', null, []), node('plant_1:stem0', 'plant_1:seed')], null);

    const repair = repairPlantGraph(p);

    assert.equal(p.rootNodeId, 'plant_1:seed');
    assert.equal(repair.rootNodeAdopted, 1);
  });

  it('refuses to guess a root when two nodes could be it', () => {
    const p = plant([node('plant_1:a', null, []), node('plant_1:b', null, [])], null);

    const repair = repairPlantGraph(p);

    assert.equal(p.rootNodeId, null);
    assert.equal(repair.rootNodeAdopted, 0);
  });
});
