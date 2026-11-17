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
    statModifiers: { photosynthesis: 1.5 },
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
    storedWater: 30,
    storedMinerals: 30,
    waterCapacity: 40,
    mineralCapacity: 40,
  };
}

function ringZeroSamples(world: ResourceWorld): Map<string, { tileX: number; tileZ: number }> {
  const samples = new Map<string, { tileX: number; tileZ: number }>();
  for (let tileZ = 0; tileZ < world.getHeight(); tileZ += 1) {
    for (let tileX = 0; tileX < world.getWidth(); tileX += 1) {
      const key = world.getTileCell(tileX, tileZ);
      if (!key?.startsWith('0:')) continue;
      if (!samples.has(key)) samples.set(key, { tileX, tileZ });
    }
  }
  return samples;
}

describe('ResourceWorld', () => {
  it('diffuses across the pole ring to a neighbour that is not an array neighbour', () => {
    const bounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
    const sphere = new ResourceWorld(resourcesConfig, bounds, 100000);
    const samples = [...ringZeroSamples(sphere).entries()];
    assert.ok(samples.length >= 2, 'the pole ring has at least two cells');

    // Two pole cells whose sampled tiles are diagonal in the array: the flat
    // grid never connects them, the spherical one does.
    let pair: [{ tileX: number; tileZ: number }, { tileX: number; tileZ: number }] | null = null;
    for (let i = 0; i < samples.length && !pair; i += 1) {
      for (let j = i + 1; j < samples.length; j += 1) {
        const a = samples[i][1];
        const b = samples[j][1];
        if (Math.abs(a.tileX - b.tileX) + Math.abs(a.tileZ - b.tileZ) > 1) {
          pair = [a, b];
          break;
        }
      }
    }
    assert.ok(pair, 'pole cells sample non-adjacent tiles');
    const [a, b] = pair;

    // Soak A to the cap and leave B at the configured base: only a neighbour
    // link can push B above base in one step.
    const base = resourcesConfig.tileMoistureBase;
    sphere.setTileResources(a.tileX, a.tileZ, { moisture: resourcesConfig.maxMoisture });
    sphere.step(0.25, new Map(), 0, 1.0);
    const sphereB = sphere.getTileResourcesAt(b.tileX, b.tileZ);
    assert.ok(
      sphereB !== null && sphereB.moisture > base + 1,
      `spherical neighbour did not receive water: ${sphereB?.moisture} vs base ${base}`,
    );

    const flat = new ResourceWorld(resourcesConfig, bounds, 0);
    flat.setTileResources(a.tileX, a.tileZ, { moisture: resourcesConfig.maxMoisture });
    flat.step(0.25, new Map(), 0, 1.0);
    const flatB = flat.getTileResourcesAt(b.tileX, b.tileZ);
    assert.ok(
      flatB !== null && flatB.moisture < base,
      `flat diagonal tile should only evaporate: ${flatB?.moisture}`,
    );
  });

  it('moisture evaporates without rain and minerals never drift without plants', () => {
    const world = makeWorld();
    const before = world.getAllTiles().map((t) => ({ ...t }));
    // Soil passes (moisture/minerals/diffusion) run at 4 Hz, so step a full
    // 250 ms window for them to execute.
    world.step(0.25, new Map(), 0, 1.0);
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

  it('recharges groundwater from rain and limits deep-root uptake per step', () => {
    const world = makeWorld();
    world.setRaining(true);
    for (let i = 0; i < 40; i += 1) world.step(0.25, new Map(), 0, 1.0, 0.5);
    world.setRaining(false);

    const afterStorm = world.getTileResourcesAt(0, 0);
    assert.ok(afterStorm, 'tile should exist');
    assert.ok(
      (afterStorm.groundwater ?? 0) > 0,
      `rain should collect in the groundwater cavity, got ${afterStorm.groundwater}`,
    );

    // Isolate the two water stores: a shallow root sees only soil moisture,
    // while a deep root can also reach the cavity, but cannot empty it at once.
    const tile = world.getTileCoordinates(0, 0);
    world.setTileResources(tile.tileX, tile.tileZ, { moisture: 0, groundwater: 100 });
    const shallow = world.takeFromTile(0, 0, 10, 0, false);
    assert.equal(shallow.water, 0, 'surface roots must not drink the water table');
    const deep = world.takeFromTile(0, 0, 100, 0, true);
    assert.ok(deep.water > 0, 'deep roots should reach the cavity');
    assert.ok(deep.water <= 25, `deep uptake must stay fractional, got ${deep.water}`);
    const remaining = world.getTileResourcesAt(tile.tileX, tile.tileZ);
    assert.ok((remaining?.groundwater ?? 0) > 0, 'a deep root must not drain the cavity dry');
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

  it('light follows the day/night curve instead of staying fixed', () => {
    const world = makeWorld();
    // timeOfDay is the FIFTH argument; passing it as the weather multiplier
    // (4th) left every reading sampled at the default noon and hid the phase.
    const read = (timeOfDay: number): number => {
      world.step(0.05, new Map(), 0, 1.0, timeOfDay);
      return world.getTileResourcesAt(0, 0)?.light ?? 0;
    };

    const night = read(0.0);
    const dawn = read(0.2);
    const midday = read(0.5);

    assert.ok(midday > night, `midday light ${midday} should exceed night ${night}`);
    assert.ok(
      dawn > night && dawn < midday,
      `dawn light ${dawn} should sit between night ${night} and midday ${midday}`,
    );
  });

  it('keeps the ground lit through the afternoon until sunset', () => {
    const world = makeWorld();
    const read = (timeOfDay: number): number => {
      world.step(0.05, new Map(), 0, 1.0, timeOfDay);
      return world.getTileResourcesAt(0, 0)?.light ?? 0;
    };

    const midday = read(0.5);
    const afternoon = read(0.7); // 16:48, sun still up
    const dusk = read(0.75);
    const midnight = read(0.0);

    assert.ok(
      afternoon > midday * 0.2,
      `afternoon light ${afternoon} died while the sky was still daylit (noon ${midday})`,
    );
    assert.ok(dusk < midday * 0.4, `sunset light ${dusk} should be dimmer than noon ${midday}`);
    assert.equal(midnight, 0);
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

    // Soil/diffusion passes run at 4 Hz: one 250 ms step executes them once.
    world.step(0.25, new Map(), 0, 1.0);

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

  it('a hydrated leaf in daylight fixes carbon and pays for it in stored water', () => {
    const world = makeWorld();
    const nodes = [makeNode('leaf', 'canopy', 0, 0)];
    const plant = makePlant('p1', nodes);
    const result = world.calculatePhotosynthesis(plant);
    assert.ok(Number.isFinite(result.energyGain), `energyGain not finite: ${result.energyGain}`);
    assert.ok(result.energyGain > 0, 'a hydrated leaf in daylight must fix carbon');
    assert.ok(result.waterCost > 0, 'photosynthesis must cost stored water');
    assert.ok(result.mineralCost >= 0, 'mineral cost must not be negative');
    assert.ok(!('biomassGain' in result), 'photosynthesis must not create structural biomass');
  });

  it('photosynthesises for organs that sit outside the tile grid', () => {
    // Plants spawn around the origin, but a grid can start at 0. Reading the tile
    // unclamped returned null and dropped the organ, silently zeroing all
    // photosynthesis for the plant and stranding it right after germination.
    const world = new ResourceWorld(resourcesConfig, {
      minX: 0,
      maxX: 64,
      minZ: 0,
      maxZ: 64,
    });
    world.step(0.05, new Map(), 0, 1.0, 0.33);
    world.setTileResources(0, 0, { light: 80, moisture: 38, minerals: 30 });

    const plant = makePlant('p-offgrid', [
      makeNode('c1', 'canopy', -2, 1),
      makeNode('c2', 'canopy', -2.6, 1),
    ]);
    plant.storedWater = 30;
    plant.storedMinerals = 30;

    const result = world.calculatePhotosynthesis(plant);
    assert.ok(result.energyGain > 0, `expected energy gain, got ${result.energyGain}`);
  });

  it('bounds a very long catch-up by what the plant actually holds', () => {
    const world = makeWorld();
    const plant = makePlant('p1', [makeNode('leaf', 'canopy', 0, 0)]);
    plant.storedWater = 12;
    plant.storedMinerals = 4;

    const result = world.photosynthesisOverSpan(plant, 86400 * 30);

    assert.ok(result.energyGain > 0, 'a hydrated leaf still fixes carbon');
    assert.ok(
      result.waterCost <= 12 + 1e-9,
      `water cost ${result.waterCost} must not exceed the stored water`,
    );
    assert.ok(
      result.waterCost + result.transpiration <= 12 + 1e-9,
      'photosynthesis plus transpiration must not spend water the plant does not hold',
    );
    assert.ok(
      result.mineralCost <= 4 + 1e-9,
      `mineral cost ${result.mineralCost} must not exceed the stored minerals`,
    );

    // A month of the instantaneous rate would be orders of magnitude larger.
    const rate = world.calculatePhotosynthesis(plant);
    assert.ok(result.energyGain < rate.energyGain * 86400 * 30);
  });

  it('fixes nothing for a zero, negative or non-finite span', () => {
    const world = makeWorld();
    const plant = makePlant('p1', [makeNode('leaf', 'canopy', 0, 0)]);

    for (const span of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = world.photosynthesisOverSpan(plant, span);
      assert.equal(result.energyGain, 0, `span ${span} must fix no carbon`);
      assert.equal(result.waterCost, 0);
      assert.equal(result.mineralCost, 0);
      assert.equal(result.transpiration, 0);
    }
  });

  it('a plant with no stored water cannot photosynthesise', () => {
    const world = makeWorld();
    const plant = makePlant('p1', [makeNode('leaf', 'canopy', 0, 0)]);
    plant.storedWater = 0;
    const result = world.calculatePhotosynthesis(plant);
    assert.strictEqual(result.energyGain, 0);
    assert.strictEqual(result.waterCost, 0);
  });

  it('uptake debits the tile and never takes more than it holds', () => {
    const world = makeWorld();
    // Tile (0,0) starts at the world's minimum corner, so sample its centre.
    const half = world.getTileSize() / 2;
    const worldX = -128 + half;
    const worldZ = -128 + half;
    world.setTileResources(0, 0, { moisture: 3, minerals: 1 });
    const taken = world.takeFromTile(worldX, worldZ, 100, 100);
    assert.equal(taken.water, 3);
    assert.equal(taken.minerals, 1);
    const tile = world.getTileResourcesAt(0, 0);
    assert(tile);
    assert.equal(tile.moisture, 0);
    assert.equal(tile.minerals, 0);
  });
});

describe('ResourceWorld plant tile coverage', () => {
  // Tile size is 1 and the grid starts at -128, so world x = -127 is the
  // boundary between tile 0 and tile 1. -100.5 sits inside tile 27.
  function coverageAt(world: ResourceWorld, x: number, z: number, radius: number) {
    const node = makeNode('root-1', 'root', x, z);
    (node as { radius?: number }).radius = radius;
    return world.getPlantTileCoverage(makePlant('plant-1', [node]));
  }

  it('counts both tiles when a root crosses a boundary', () => {
    const world = makeWorld();
    const coverage = coverageAt(world, -127.02, -100.5, 0.05);
    assert.equal(coverage.count, 2, 'a root straddling a boundary feeds both tiles');
  });

  it('averages exactly the tiles the root touches', () => {
    const world = makeWorld();
    world.setTileResources(0, 27, { light: 10, moisture: 60, minerals: 5 });
    world.setTileResources(1, 27, { light: 20, moisture: 40, minerals: 15 });

    const coverage = coverageAt(world, -127.02, -100.5, 0.05);
    assert.equal(coverage.count, 2);
    assert.equal(coverage.avgLight, 15);
    assert.equal(coverage.avgMoisture, 50);
    assert.equal(coverage.avgMinerals, 10);
  });

  it('still counts a tile the footprint touches by a sliver', () => {
    const world = makeWorld();
    // 0.02 m past the boundary, radius 0.028: the overlap is 0.008 m, which
    // must still count.
    const coverage = coverageAt(world, -126.98, -100.5, 0.028);
    assert.equal(coverage.count, 2);
  });

  it('excludes a diagonal tile the round footprint never reaches', () => {
    const world = makeWorld();
    // 0.02 m from the corner on both axes, radius 0.028: both edges are crossed,
    // but the diagonal tile's nearest point is 0.0283 m away - out of reach. The
    // bounding box would wrongly include it.
    const coverage = coverageAt(world, -127.02, -127.02, 0.028);
    assert.equal(coverage.count, 3);
  });

  it('reports no coverage for a plant with no parts', () => {
    const world = makeWorld();
    const coverage = world.getPlantTileCoverage(makePlant('p-empty', []));
    assert.equal(coverage.count, 0);
    assert.equal(coverage.sample, null);
  });

  it('counts the tile a canopy node is over, not just roots', () => {
    const world = makeWorld();
    const leaf = makeNode('leaf-1', 'canopy', -100.5, -100.5);
    (leaf as { radius?: number }).radius = 0.05;
    const coverage = world.getPlantTileCoverage(makePlant('p-canopy', [leaf]));
    assert.equal(coverage.count, 1);
  });

  it('unions tiles from every layer without double counting', () => {
    const world = makeWorld();
    const root = makeNode('root-1', 'root', -127.02, -100.5);
    const leaf = makeNode('leaf-1', 'canopy', -127.02, -100.5);
    (root as { radius?: number }).radius = 0.05;
    (leaf as { radius?: number }).radius = 0.05;

    const coverage = world.getPlantTileCoverage(makePlant('p-mixed', [root, leaf]));
    assert.equal(coverage.count, 2, 'two parts over the same two tiles count them once');
  });

  it('measures the water table against the undug regional ground, not a pit', () => {
    const world = makeWorld();
    world.setBaseHeightProvider(() => 0);
    // The surface provider is the *edited* terrain: a pit two metres deep at the
    // origin. The table must not follow it down, or no hole could ever fill.
    world.setSurfaceHeightProvider((x, z) => (Math.abs(x) < 2 && Math.abs(z) < 2 ? -2 : 0));
    const origin = world.getTileCoordinates(0, 0);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        world.setTileResources(origin.tileX + dx, origin.tileZ + dz, {
          groundwater: world.getGroundwaterCapacity(),
        });
      }
    }

    const table = world.getWaterTableHeightAt(0, 0);
    assert.ok(table > -2, `a saturated pit should hold water, table was ${table}`);
    assert.ok(Math.abs(table) < 0.05, `a saturated table sits at the regional level, got ${table}`);
  });

  it('treats a node over a tile and a node under it as the same tile', () => {
    const world = makeWorld();
    const root = makeNode('root-1', 'root', -100.5, -100.5);
    root.y = -4; // underground
    const leaf = makeNode('leaf-1', 'canopy', -100.5, -100.5);
    leaf.y = 6; // above the same ground

    const coverage = world.getPlantTileCoverage(makePlant('p-stack', [root, leaf]));
    assert.equal(coverage.count, 1);
  });
});

describe('tile deltas before and after the first full grid', () => {
  it('records nothing until a client has the full grid', () => {
    const world = makeWorld();
    world.setTileResources(1, 1, { moisture: 0.5 });
    // The flag exists so the first tick does not push a 65k-tile burst.
    assert.equal(world.getDirtyTileCount(), 0);
  });

  it('publishes a delta once the full grid has been sent', () => {
    const world = makeWorld();
    world.markFullGridSent();
    world.setTileResources(1, 1, { moisture: 0.5 });
    assert.ok(world.getDirtyTileCount() > 0);
    assert.ok(world.getDirtyTiles().length > 0);
    // Consumed by the send: the next tick has nothing to repeat.
    assert.equal(world.getDirtyTileCount(), 0);
  });
});

describe('setTileResources', () => {
  it('reports whether the write landed', () => {
    const world = makeWorld();
    assert.equal(world.setTileResources(1, 1, { moisture: 0.5 }), true);
    assert.equal(world.setTileResources(-1, 0, { moisture: 0.5 }), false);
    assert.equal(world.setTileResources(0, world.getHeight(), { moisture: 0.5 }), false);
    assert.equal(world.setTileResources(999999, -999999, { moisture: 0.5 }), false);
  });
});
