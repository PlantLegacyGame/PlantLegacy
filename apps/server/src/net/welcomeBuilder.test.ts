import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Plant, PlantNode } from '@plant-legacy/shared/growth';
import { validateMessage } from '@plant-legacy/shared/protocol/messageSchemas';
import { buildWelcomePayload } from './welcomeBuilder.ts';

function makeNode(overrides: Partial<PlantNode> = {}): PlantNode {
  return {
    id: 'n1',
    plantId: 'p1',
    type: 'root',
    layer: 'root',
    x: 1,
    y: 2,
    z: 3,
    biomass: 4,
    age: 5,
    parentId: null,
    children: [],
    statModifiers: {},
    resourceDrawWater: 0,
    resourceDrawNutrients: 0,
    resourceDrawMinerals: 0,
    upkeepBiomassPerSecond: 0,
    growthDirectionBias: 'downward',
    lastGrowthTick: 0,
    growthProgress: 1,
    isSeed: false,
    ...overrides,
  };
}

function makePlant(overrides: Partial<Plant> = {}): Plant {
  const root = makeNode({ id: 'n1' });
  return {
    id: 'p1',
    ownerId: 'player_1',
    worldId: 'world_0',
    nodes: new Map([[root.id, root]]),
    rootNodeId: root.id,
    totalBiomass: 10,
    totalEnergy: 20,
    totalUpkeep: 0,
    storedWater: 0,
    storedMinerals: 0,
    lastGrowthTick: 0,
    growthCooldownUntil: 0,
    growthSeq: 0,
    ...overrides,
  };
}

describe('buildWelcomePayload', () => {
  it('describes the root and every node, carrying node health through', () => {
    const plant = makePlant({
      nodes: new Map([
        ['n1', makeNode({ id: 'n1', biomass: 4 })],
        ['n2', makeNode({ id: 'n2', parentId: 'n1', biomass: 6 })],
      ]),
    });

    const welcome = buildWelcomePayload({
      playerId: 'player_1',
      plant,
      reconnectToken: 'token_abc',
      tick: 42,
      nodeHealth: (nodeId) => (nodeId === 'n2' ? 0.5 : undefined),
    });

    assert.equal(welcome.playerId, 'player_1');
    assert.equal(welcome.plantId, 'p1');
    assert.deepEqual(welcome.rootNode, {
      id: 'n1',
      x: 1,
      y: 2,
      z: 3,
      type: 'root',
      biomass: 4,
    });
    assert.equal(welcome.nodes?.length, 2);
    assert.equal(welcome.nodes?.find((node) => node.id === 'n2')?.health, 0.5);
    assert.equal(welcome.nodes?.find((node) => node.id === 'n1')?.health, undefined);
    assert.deepEqual(validateMessage(10, welcome).issues, []);
  });

  it('passes the token and tick through instead of minting its own', () => {
    const welcome = buildWelcomePayload({
      playerId: 'player_1',
      plant: makePlant(),
      reconnectToken: 'token_abc',
      tick: 42,
      nodeHealth: () => undefined,
    });

    assert.equal(welcome.reconnectToken, 'token_abc');
    assert.equal(welcome.tick, 42);
    assert.equal(welcome.totalBiomass, 10);
    assert.equal(welcome.totalEnergy, 20);
  });

  it('falls back to a zeroed root when the plant has none', () => {
    const welcome = buildWelcomePayload({
      playerId: 'player_1',
      plant: makePlant({ nodes: new Map(), rootNodeId: 'gone' }),
      reconnectToken: 'token_abc',
      tick: 0,
      nodeHealth: () => undefined,
    });

    assert.deepEqual(welcome.rootNode, { id: 'gone', x: 0, y: 0, z: 0, type: 'root', biomass: 0 });
    assert.deepEqual(welcome.nodes, []);
    assert.deepEqual(validateMessage(10, welcome).issues, []);
  });
});
