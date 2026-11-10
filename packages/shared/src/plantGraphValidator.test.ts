import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Plant, PlantNode } from './growth/index.ts';
import { validatePlantGraph } from './plantGraphValidator.ts';

const bounds = {
  minX: -100,
  maxX: 100,
  minY: -100,
  maxY: 100,
  minZ: -100,
  maxZ: 100,
};

function node(
  id: string,
  overrides: Partial<{
    plantId: string;
    parentId: string | null;
    children: string[];
    x: number;
    y: number;
    z: number;
    biomass: number;
    upkeepBiomassPerSecond: number;
  }> = {},
): PlantNode {
  return {
    id,
    plantId: overrides.plantId ?? 'plant_1',
    type: 'root',
    layer: 'root',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    z: overrides.z ?? 0,
    biomass: overrides.biomass ?? 1,
    age: 0,
    parentId: overrides.parentId ?? null,
    children: overrides.children ?? [],
    statModifiers: {},
    resourceDrawWater: 0,
    resourceDrawNutrients: 0,
    upkeepBiomassPerSecond: overrides.upkeepBiomassPerSecond ?? 0.1,
    growthDirectionBias: 'upward',
    lastGrowthTick: 0,
    growthProgress: 1,
    isSeed: false,
  } as PlantNode;
}

function plant(
  overrides: Partial<{
    id: string;
    rootNodeId: string | null;
    nodes: PlantNode[];
    totalBiomass: number;
    totalEnergy: number;
    totalUpkeep: number;
  }> = {},
): Plant {
  const nodes = overrides.nodes ?? [node('root_1')];
  const nodeMap = new Map<string, PlantNode>();
  for (const n of nodes) nodeMap.set(n.id, n);
  const sumUpkeep = [...nodes.values()].reduce((a, n) => a + n.upkeepBiomassPerSecond, 0);
  return {
    id: overrides.id ?? 'plant_1',
    ownerId: 'owner_1',
    worldId: 'world_0',
    nodes: nodeMap,
    rootNodeId: overrides.rootNodeId !== undefined ? overrides.rootNodeId : 'root_1',
    totalBiomass: overrides.totalBiomass !== undefined ? overrides.totalBiomass : 1,
    totalEnergy: overrides.totalEnergy !== undefined ? overrides.totalEnergy : 5,
    totalUpkeep: overrides.totalUpkeep !== undefined ? overrides.totalUpkeep : sumUpkeep,
    lastGrowthTick: 0,
    growthCooldownUntil: 0,
  } as Plant;
}

function codes(p: Plant, b = bounds): string[] {
  return validatePlantGraph(p, b).issues.map((i) => i.code);
}

describe('validatePlantGraph', () => {
  it('accepts a well-formed plant (root with reciprocal child)', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null });
    const child = node('child_1', {
      plantId: 'plant_1',
      parentId: 'root_1',
      biomass: 2,
      upkeepBiomassPerSecond: 0.2,
    });
    root.children = ['child_1'];
    const p = plant({
      nodes: [root, child],
      totalBiomass: 3,
      totalUpkeep: 0.3,
    });
    assert.deepEqual(validatePlantGraph(p, bounds).issues, []);
  });

  it('rejects a plant with no root node', () => {
    const p = plant({ rootNodeId: null });
    assert.ok(codes(p).includes('plant.missing_root'));
  });

  it('rejects a rootNodeId that names no node', () => {
    const p = plant({ rootNodeId: 'missing' });
    assert.ok(codes(p).includes('plant.root_node_missing'));
  });

  it('rejects multiple roots', () => {
    const a = node('a', { plantId: 'plant_1', parentId: null });
    const b = node('b', { plantId: 'plant_1', parentId: null });
    const p = plant({ nodes: [a, b], rootNodeId: 'a' });
    assert.ok(codes(p).includes('plant.multiple_roots'));
  });
  it('rejects node plantId mismatch', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null });
    const child = node('child_1', { plantId: 'other_plant', parentId: 'root_1' });
    root.children = ['child_1'];
    const p = plant({ nodes: [root, child], totalUpkeep: 0.2 });
    assert.ok(codes(p).includes('node.plant_id_mismatch'));
  });

  it('rejects non-reciprocal parentId (parent does not list child)', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null });
    const child = node('child_1', { plantId: 'plant_1', parentId: 'root_1' });
    const p = plant({ nodes: [root, child], rootNodeId: 'root_1', totalUpkeep: 0.2 });
    assert.ok(codes(p).includes('node.children_not_reciprocal'));
  });

  it('rejects non-reciprocal children (child lists different parent)', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null });
    root.children = ['child_1'];
    const child = node('child_1', { plantId: 'plant_1', parentId: 'other' });
    const p = plant({ nodes: [root, child], rootNodeId: 'root_1', totalUpkeep: 0.2 });
    assert.ok(codes(p).includes('node.parent_not_reciprocal'));
  });

  it('rejects a dangling parentId', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null });
    const child = node('child_1', { plantId: 'plant_1', parentId: 'ghost' });
    root.children = ['child_1'];
    const p = plant({ nodes: [root, child], rootNodeId: 'root_1', totalUpkeep: 0.2 });
    assert.ok(codes(p).includes('node.parent_missing'));
  });

  it('rejects a dangling child id', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null });
    root.children = ['ghost'];
    const p = plant({ nodes: [root], rootNodeId: 'root_1', totalUpkeep: 0.1 });
    assert.ok(codes(p).includes('node.child_missing'));
  });

  it('rejects an unreachable node (orphan)', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null });
    const orphan = node('orphan_1', { plantId: 'plant_1', parentId: null });
    const p = plant({ nodes: [root, orphan], rootNodeId: 'root_1', totalUpkeep: 0.2 });
    assert.ok(codes(p).includes('node.unreachable'));
  });

  it('rejects a node outside world bounds', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null, x: 200 });
    const p = plant({ nodes: [root], totalUpkeep: 0.1 });
    assert.ok(codes(p).includes('node.out_of_bounds'));
  });

  it('rejects negative biomass', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null, biomass: -1 });
    const p = plant({ nodes: [root], totalUpkeep: 0.1 });
    assert.ok(codes(p).includes('node.invalid_biomass'));
  });

  it('rejects non-finite upkeep', () => {
    const root = node('root_1', {
      plantId: 'plant_1',
      parentId: null,
      upkeepBiomassPerSecond: NaN,
    });
    const p = plant({ nodes: [root], totalUpkeep: 0 });
    assert.ok(codes(p).includes('node.invalid_upkeep'));
  });

  it('rejects totalUpkeep that does not equal the node sum', () => {
    const root = node('root_1', {
      plantId: 'plant_1',
      parentId: null,
      upkeepBiomassPerSecond: 0.1,
    });
    const p = plant({ nodes: [root], totalUpkeep: 0.5 });
    assert.ok(codes(p).includes('plant.total_upkeep_mismatch'));
  });

  it('accepts totalUpkeep within tolerance of the node sum', () => {
    const root = node('root_1', {
      plantId: 'plant_1',
      parentId: null,
      upkeepBiomassPerSecond: 0.1,
    });
    const p = plant({ nodes: [root], totalUpkeep: 0.1000001 });
    assert.deepEqual(codes(p), []);
  });

  it('rejects invalid totalBiomass', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null });
    const p = plant({ nodes: [root], totalBiomass: -5 });
    assert.ok(codes(p).includes('plant.invalid_total_biomass'));
  });

  it('returns issues with path, code, message and severity', () => {
    const root = node('root_1', { plantId: 'plant_1', parentId: null, x: 999 });
    const p = plant({ nodes: [root] });
    const result = validatePlantGraph(p, bounds);
    assert.ok(result.issues.length > 0);
    const issue = result.issues[0];
    assert.ok(typeof issue.path === 'string');
    assert.ok(typeof issue.code === 'string');
    assert.ok(typeof issue.message === 'string');
    assert.ok(issue.severity === 'error' || issue.severity === 'warning');
    assert.ok(!result.ok);
  });
});
