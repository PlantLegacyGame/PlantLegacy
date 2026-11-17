import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  healthPhotosynthesisMultiplier,
  nodeHealth,
  plantHealth,
  tissueMassQuota,
} from './health.ts';
import type { GrowthConfig, NodeTypeDefinition, Plant, PlantNode } from './types.ts';

function def(biomassCost: number): NodeTypeDefinition {
  return {
    biomass_cost: biomassCost,
    resource_draw_water: 0,
    resource_draw_nutrients: 0,
    resource_draw_minerals: 0,
    upkeep_biomass_per_second: 0,
    stat_modifiers: {},
    growth_direction_bias: 'upward',
    growth_time_seconds: 10,
  };
}

// The real config keeps 60% of the carbon budget as mass
// (`growth_biomass_yield`), so a finished part carries 0.6 x its build cost.
const YIELD = 0.6;
const config = {
  rootNode: def(15),
  stemNode: def(12),
  leafNode: def(6),
  branchNode: def(4),
  growthBiomassYield: YIELD,
  healthPhotosynthesisFloor: 0.5,
  growthMinHealth: 0.35,
} as unknown as GrowthConfig;

function node(overrides: Partial<PlantNode>): PlantNode {
  return {
    id: 'n',
    plantId: 'p',
    type: 'stem',
    layer: 'canopy',
    x: 0,
    y: 0,
    z: 0,
    biomass: 0,
    age: 0,
    parentId: null,
    children: [],
    statModifiers: {},
    resourceDrawWater: 0,
    resourceDrawNutrients: 0,
    resourceDrawMinerals: 0,
    upkeepBiomassPerSecond: 0,
    growthDirectionBias: 'upward',
    lastGrowthTick: 0,
    growthProgress: 1,
    isSeed: false,
    ...overrides,
  } as PlantNode;
}

function plant(nodes: PlantNode[]): Plant {
  return {
    id: 'p',
    ownerId: 'o',
    worldId: 'w',
    nodes: new Map(nodes.map((n) => [n.id, n])),
    rootNodeId: nodes[0]?.id ?? null,
    totalBiomass: nodes.reduce((sum, n) => sum + n.biomass, 0),
    totalEnergy: 0,
    totalUpkeep: 0,
    storedWater: 0,
    storedMinerals: 0,
    lastGrowthTick: 0,
    growthCooldownUntil: 0,
    growthSeq: 0,
  };
}

const finishedStem = (biomass: number) =>
  node({ biomass, age: 10, growthTimeSeconds: 10, growthProgress: 1 });

describe('tissue health', () => {
  it('quotes the yield-adjusted mass a finished part carries', () => {
    assert.ok(Math.abs(tissueMassQuota(finishedStem(0), config) - 12 * YIELD) < 1e-9);
  });

  it('reads a fully grown, untouched part at full health, not at the yield fraction', () => {
    // 7.2 is 60% of a 12-cost stem: exactly what the part is built with.
    assert.equal(nodeHealth(finishedStem(12 * YIELD), config), 1);
  });

  it('reads a fully grown, untouched plant at full health', () => {
    const untouched = plant([
      node({ id: 'root', type: 'root', layer: 'root', biomass: 15 * YIELD, growthProgress: 1 }),
      finishedStem(12 * YIELD),
      node({ id: 'leaf', type: 'leaf', biomass: 6 * YIELD, growthProgress: 1 }),
    ]);
    assert.equal(plantHealth(untouched, config), 1);
  });

  it('treats a part that is still filling in as healthy', () => {
    const young = node({ biomass: 0, growthProgress: 0.4, age: 4, growthTimeSeconds: 10 });
    assert.equal(nodeHealth(young, config), 1);
  });

  it('reads a part that lost mass as damaged', () => {
    const droughtStunted = finishedStem(12 * YIELD * 0.25);
    assert.ok(nodeHealth(droughtStunted, config) < 0.3);
  });

  it('weights plant health by each tissue s own build cost', () => {
    const wiltedStem = plant([
      node({ id: 'root', type: 'root', layer: 'root', biomass: 15 * YIELD, growthProgress: 1 }),
      finishedStem(12 * YIELD * 0.5),
    ]);
    // Root 15 at full health plus stem 12 at half health, over a 27 weight.
    assert.ok(Math.abs(plantHealth(wiltedStem, config) - 21 / 27) < 1e-9);
  });

  it('ignores the seed, which has no tissue to damage', () => {
    const seedOnly = plant([
      node({ id: 'seed', type: 'seed', layer: 'root', isSeed: true, biomass: 1 }),
    ]);
    assert.equal(plantHealth(seedOnly, config), 1);
  });

  it('keeps a photosynthesis floor at zero health', () => {
    assert.equal(healthPhotosynthesisMultiplier(1, config), 1);
    assert.equal(healthPhotosynthesisMultiplier(0, config), 0.5);
    assert.equal(healthPhotosynthesisMultiplier(0.5, config), 0.75);
  });
});
