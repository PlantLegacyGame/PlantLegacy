import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeType, Plant, PlantNode } from '@plant-legacy/shared/growth';
import { newId } from '@plant-legacy/shared/ids';
import { hash01, hash32, mulberry32 } from '@plant-legacy/shared/math';
import { deserializePlant, serializePlant } from './plantPersistence.ts';

function makePlant(nodeCount: number, idPrefix = 'p_'): Plant {
  const plantId = `${idPrefix}${newId('plant')}`;
  const nodes = new Map<string, PlantNode>();

  for (let i = 0; i < nodeCount; i++) {
    const nodeId = `${idPrefix}node_${i}`;
    const parentId = i === 0 ? null : `${idPrefix}node_${i - 1}`;
    const children = i < nodeCount - 1 ? [`${idPrefix}node_${i + 1}`] : [];

    const node: PlantNode = {
      id: nodeId,
      plantId,
      type: (i === 0 ? 'seed' : i === 1 ? 'radicle' : i % 3 === 0 ? 'leaf' : 'stem') as NodeType,
      layer: i <= 1 ? 'root' : 'canopy',
      x: i * 0.5,
      y: i * 0.3,
      z: i * 0.2,
      biomass: 1.0 + i * 0.1,
      age: 100 + i * 10,
      parentId,
      children,
      statModifiers: {},
      resourceDrawWater: 0.1,
      resourceDrawNutrients: 0.1,
      resourceDrawMinerals: 0.1,
      upkeepBiomassPerSecond: 0.01,
      growthDirectionBias: i <= 1 ? 'downward' : 'upward',
      lastGrowthTick: 1000 + i,
      growthProgress: 1.0,
      isSeed: i === 0,
    };
    nodes.set(nodeId, node);
  }

  return {
    id: plantId,
    ownerId: `acct_${newId('account')}`,
    worldId: `world_${newId('world')}`,
    nodes,
    rootNodeId: `${idPrefix}node_1`,
    totalBiomass: 100.5,
    totalEnergy: 500.25,
    totalUpkeep: 1.5,
    storedWater: 200.0,
    storedMinerals: 150.0,
    lastGrowthTick: 2000,
    growthCooldownUntil: 2010,
    tier: 'active',
    lastTick: 10000,
    maxNodesPerPlant: 2000,
    growthSeq: 5,
  };
}

describe('hash32', () => {
  it('produces consistent output for same input', () => {
    assert.strictEqual(hash32('test'), hash32('test'));
    assert.strictEqual(hash32('hello world'), hash32('hello world'));
  });

  it('produces different output for different inputs', () => {
    assert.notStrictEqual(hash32('a'), hash32('b'));
    assert.notStrictEqual(hash32('test1'), hash32('test2'));
  });

  it('returns unsigned 32-bit integer', () => {
    const h = hash32('anything');
    assert.ok(h >= 0 && h <= 0xffffffff);
    assert.strictEqual(h, h >>> 0);
  });
});

describe('hash01', () => {
  it('returns value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = hash01(`id_${i}`, 'salt');
      assert.ok(v >= 0 && v < 1);
    }
  });

  it('is deterministic for same id and salt', () => {
    assert.strictEqual(hash01('node_123', 'bend'), hash01('node_123', 'bend'));
    assert.strictEqual(hash01('node_456', 'leafNormalX'), hash01('node_456', 'leafNormalX'));
  });

  it('differs with different salt', () => {
    assert.notStrictEqual(hash01('same', 'salt1'), hash01('same', 'salt2'));
  });
});

describe('mulberry32', () => {
  it('produces deterministic sequence from seed', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(rng1(), rng2());
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = mulberry32(1);
    const rng2 = mulberry32(2);
    let same = true;
    for (let i = 0; i < 10; i++) {
      if (rng1() !== rng2()) {
        same = false;
        break;
      }
    }
    assert.ok(!same);
  });

  it('returns values in [0, 1)', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1);
    }
  });
});

describe('serializePlant / deserializePlant round-trip', () => {
  it('round-trips a 1-node plant', () => {
    const plant = makePlant(1);
    const serialized = serializePlant(plant);
    const snapshot = deserializePlant(serialized);

    assert.strictEqual(snapshot.id, plant.id);
    assert.strictEqual(snapshot.worldId, plant.worldId);
    assert.strictEqual(snapshot.ownerId, plant.ownerId);
    assert.strictEqual(snapshot.rootNodeId, plant.rootNodeId);
    assert.strictEqual(snapshot.totalBiomass, plant.totalBiomass);
    assert.strictEqual(snapshot.totalEnergy, plant.totalEnergy);
    assert.strictEqual(snapshot.totalUpkeep, plant.totalUpkeep);
    assert.strictEqual(snapshot.storedWater, plant.storedWater);
    assert.strictEqual(snapshot.storedMinerals, plant.storedMinerals);
    assert.strictEqual(snapshot.lastGrowthTick, plant.lastGrowthTick);
    assert.strictEqual(snapshot.growthCooldownUntil, plant.growthCooldownUntil);
    assert.strictEqual(snapshot.tier, plant.tier);
    assert.strictEqual(snapshot.lastTick, plant.lastTick);
    assert.strictEqual(snapshot.nodes.size, 1);
  });

  it('round-trips a 10-node plant', () => {
    const plant = makePlant(10);
    const serialized = serializePlant(plant);
    const snapshot = deserializePlant(serialized);

    assert.strictEqual(snapshot.nodes.size, 10);
    for (const [id, node] of plant.nodes) {
      const loaded = snapshot.nodes.get(id);
      assert.ok(loaded, `missing node ${id}`);
      assert.strictEqual(loaded.type, node.type);
      assert.strictEqual(loaded.layer, node.layer);
      assert.strictEqual(loaded.x, node.x);
      assert.strictEqual(loaded.y, node.y);
      assert.strictEqual(loaded.z, node.z);
      assert.strictEqual(loaded.biomass, node.biomass);
      assert.strictEqual(loaded.age, node.age);
      assert.strictEqual(loaded.parentId, node.parentId);
      assert.deepStrictEqual(loaded.children, node.children);
      assert.strictEqual(loaded.resourceDrawWater, node.resourceDrawWater);
      assert.strictEqual(loaded.resourceDrawNutrients, node.resourceDrawNutrients);
      assert.strictEqual(loaded.upkeepBiomassPerSecond, node.upkeepBiomassPerSecond);
      assert.strictEqual(loaded.growthDirectionBias, node.growthDirectionBias);
      assert.strictEqual(loaded.lastGrowthTick, node.lastGrowthTick);
      assert.strictEqual(loaded.growthProgress, node.growthProgress);
      assert.strictEqual(loaded.isSeed, node.isSeed);
    }
  });

  it('round-trips a 100-node plant', () => {
    const plant = makePlant(100, 'p_big_');
    const serialized = serializePlant(plant);
    const snapshot = deserializePlant(serialized);

    assert.strictEqual(snapshot.nodes.size, 100);
    assert.strictEqual(snapshot.totalBiomass, plant.totalBiomass);
  });

  it('round-trips a 2000-node plant', () => {
    const plant = makePlant(2000, 'p_huge_');
    const serialized = serializePlant(plant);
    const snapshot = deserializePlant(serialized);

    assert.strictEqual(snapshot.nodes.size, 2000);
  });

  it('rejects corrupted data (wrong magic)', () => {
    const plant = makePlant(1);
    const serialized = serializePlant(plant);
    const corrupted = new Uint8Array(serialized);
    corrupted[0] = 0xff; // corrupt magic
    assert.throws(() => deserializePlant(corrupted), /Invalid snapshot magic/);
  });

  it('rejects corrupted data (wrong CRC)', () => {
    const plant = makePlant(1);
    const serialized = serializePlant(plant);
    const corrupted = new Uint8Array(serialized);
    corrupted[corrupted.length - 1] ^= 0xff; // flip last byte
    assert.throws(() => deserializePlant(corrupted), /CRC32 mismatch/);
  });

  it('rejects truncated data', () => {
    const plant = makePlant(1);
    const serialized = serializePlant(plant);
    const truncated = serialized.slice(0, serialized.length - 10);
    assert.throws(() => deserializePlant(truncated), /Snapshot truncated/);
  });

  it('preserves fractional age values', () => {
    const plant = makePlant(1);
    const node = plant.nodes.values().next().value;
    if (node) {
      node.age = 123.456; // fractional age
    }
    const serialized = serializePlant(plant);
    const snapshot = deserializePlant(serialized);
    const loadedNode = snapshot.nodes.values().next().value;
    assert.ok(loadedNode);
    assert.strictEqual(loadedNode.age, 123.456);
  });
});

describe('serializePlant with UUID-style IDs', () => {
  it('handles long UUID-like node IDs without overflow', () => {
    const plantId = `p_${'a'.repeat(36)}`;
    const nodes = new Map<string, PlantNode>();
    const nodeId = `node_${'b'.repeat(60)}`; // ~60 char UUID-style ID

    const node: PlantNode = {
      id: nodeId,
      plantId,
      type: 'stem',
      layer: 'canopy',
      x: 1,
      y: 2,
      z: 3,
      biomass: 1.5,
      age: 0,
      parentId: null,
      children: [],
      statModifiers: {},
      resourceDrawWater: 0.1,
      resourceDrawNutrients: 0.1,
      resourceDrawMinerals: 0.1,
      upkeepBiomassPerSecond: 0.01,
      growthDirectionBias: 'upward',
      lastGrowthTick: 100,
      growthProgress: 1.0,
      isSeed: false,
    };
    nodes.set(nodeId, node);

    const plant: Plant = {
      id: plantId,
      ownerId: `acct_${'c'.repeat(20)}`,
      worldId: `world_${'d'.repeat(20)}`,
      nodes,
      rootNodeId: nodeId,
      totalBiomass: 1.5,
      totalEnergy: 100,
      totalUpkeep: 0.01,
      storedWater: 50,
      storedMinerals: 30,
      lastGrowthTick: 100,
      growthCooldownUntil: 110,
      tier: 'active',
      lastTick: 5000,
      maxNodesPerPlant: 2000,
      growthSeq: 0,
    };

    const serialized = serializePlant(plant);
    const snapshot = deserializePlant(serialized);

    assert.strictEqual(snapshot.nodes.size, 1);
    const loaded = snapshot.nodes.get(nodeId);
    assert.ok(loaded);
    assert.strictEqual(loaded.id, nodeId);
  });
});
