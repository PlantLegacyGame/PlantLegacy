import assert from 'node:assert';
import { describe, it } from 'node:test';
import { loadConfigDir } from '@plant-legacy/shared/config';
import type { PlantNode } from '@plant-legacy/shared/growth';
import { loadResourcesConfig, type PlantForResource, ResourceWorld } from './resourceWorld.ts';

const configDir = process.env.CONFIG_DIR ?? 'C:\\Users\\khmer\\PlantLegacy\\config';
const configs = await loadConfigDir(configDir);
if (!configs.ok) throw new Error('config load failed');

const resourcesConfig = loadResourcesConfig(configs.configs);

function makeWorld(): ResourceWorld {
  return new ResourceWorld(resourcesConfig, {
    minX: -128,
    maxX: 128,
    minZ: -128,
    maxZ: 128,
  });
}

function makeNode(id: string, layer: 'root' | 'canopy', x: number, z: number): PlantNode {
  return {
    id,
    plantId: 'p',
    type: layer === 'root' ? 'root' : 'leaf',
    layer,
    x,
    y: 0,
    z,
    biomass: 10,
    age: 0,
    parentId: null,
    children: [],
    statModifiers: {},
    resourceDrawWater: 1.0,
    resourceDrawNutrients: 1.0,
    resourceDrawMinerals: 1.0,
    upkeepBiomassPerSecond: 0.01,
    growthDirectionBias: 'outward',
    lastGrowthTick: 0,
    growthProgress: 1.0,
    isSeed: false,
  };
}

function makePlant(id: string, nodes: PlantNode[]): PlantForResource {
  const nodeMap = new Map<string, PlantNode>();
  for (const n of nodes) nodeMap.set(n.id, n);
  return {
    id,
    ownerId: 'owner',
    worldId: 'world_0',
    nodes: nodeMap,
    totalBiomass: 100,
    totalUpkeep: 0.1,
    rootNodeId: nodes[0]?.id ?? null,
  };
}

describe('ResourceWorld', () => {
  it('moisture evaporates without rain and minerals never drift without plants', () => {
    const world = makeWorld();
    const before = world.getAllTiles().map((t) => ({ ...t }));
    world.step(0.05, new Map(), 0, 1.0);
    const after = world.getAllTiles();
    // Evaporation is unconditional (weather-independent) — moisture must drop.
    assert.ok(after[0].moisture < before[0].moisture, 'moisture should evaporate');
    assert.ok(after[0].moisture >= 0, 'moisture must not go negative');
    // Minerals have no source/sink without plants — must stay exactly equal.
    for (let i = 0; i < after.length; i++) {
      assert.strictEqual(after[i].minerals, before[i].minerals, `minerals drift at ${i}`);
    }
  });

  it('absorption clamps moisture and minerals at 0 and never goes negative', () => {
    const world = makeWorld();
    const nodes = [makeNode('root', 'root', 0, 0)];
    const plant = makePlant('p1', nodes);
    for (let i = 0; i < 50; i++) {
      world.step(0.05, new Map([[plant.id, plant]]), 0, 1.0);
      const t = world.getTileResourcesAt(0, 0);
      assert.ok(t, 'tile should exist');
      assert.ok(t.moisture >= 0, `moisture negative: ${t.moisture}`);
      assert.ok(t.minerals >= 0, `minerals negative: ${t.minerals}`);
    }
  });

  it('dayNightCurve index never exceeds bounds (no NaN light)', () => {
    const world = makeWorld();
    for (let timeOfDay = 0; timeOfDay <= 1.0; timeOfDay += 0.01) {
      world.step(0.05, new Map(), 0, timeOfDay);
    }
    const tiles = world.getAllTiles();
    for (const t of tiles) {
      assert.ok(Number.isFinite(t.light), `light not finite: ${t.light}`);
    }
  });

  it('getTileResourcesAt returns null outside grid', () => {
    const world = makeWorld();
    assert.strictEqual(world.getTileResourcesAt(-1, 0), null);
    assert.strictEqual(world.getTileResourcesAt(resourcesConfig.gridWidth, 0), null);
    assert.strictEqual(world.getTileResourcesAt(0, -1), null);
    assert.strictEqual(world.getTileResourcesAt(0, resourcesConfig.gridHeight), null);
  });

  it('maps world coordinates to the containing tile', () => {
    const world = makeWorld();
    const tileSize = world.getTileSize();
    const coords = world.getTileCoordinates(-128 + tileSize * 2.5, -128 + tileSize * 3.5);
    assert.equal(coords.tileX, 2);
    assert.equal(coords.tileZ, 3);
  });

  it('diffuses toward the mean of all neighbours, not just the last one', () => {
    const world = makeWorld();
    const tx = 10;
    const tz = 10;

    // Clear the 3x3 neighbourhood so the only source is the centre tile.
    for (let x = tx - 1; x <= tx + 1; x++) {
      for (let z = tz - 1; z <= tz + 1; z++) {
        world.setTileResources(x, z, { minerals: 0 });
      }
    }
    world.setTileResources(tx, tz, { minerals: 100 });
    world.setTileResources(tx, tz - 1, { minerals: 80 });

    world.step(0.05, new Map(), 0, 1.0);

    const centre = world.getTileResourcesAt(tx, tz);
    assert(centre);
    const rate = resourcesConfig.diffusionRate;
    const neighbourMean = 80 / 4; // left, right, north, south
    const expected = 100 + rate * (neighbourMean - 100);
    assert.ok(
      Math.abs(centre.minerals - expected) < 1e-6,
      `expected ${expected}, got ${centre.minerals}`,
    );
  });

  it('photosynthesis is finite and non-negative', () => {
    const world = makeWorld();
    const nodes = [makeNode('leaf', 'canopy', 0, 0)];
    const plant = makePlant('p1', nodes);
    const { biomassGain, energyGain } = world.calculatePhotosynthesis(plant);
    assert.ok(Number.isFinite(biomassGain), `biomassGain not finite: ${biomassGain}`);
    assert.ok(biomassGain >= 0, `biomassGain negative: ${biomassGain}`);
    assert.ok(Number.isFinite(energyGain), `energyGain not finite: ${energyGain}`);
    assert.ok(energyGain >= 0, `energyGain negative: ${energyGain}`);
  });
});
