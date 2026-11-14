import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigDir } from '@plant-legacy/shared/config';
import { loadGrowthConfig } from './growth.ts';
import { computePlantCapacity } from './plantCapacity.ts';
import { PlantWorld } from './plantWorld.ts';
import { loadResourcesConfig, ResourceWorld } from './resourceWorld.ts';

const configDir = fileURLToPath(new URL('../../../../config', import.meta.url));
const loaded = await loadConfigDir(configDir);
if (!loaded.ok) throw new Error('config load failed');

const growthConfig = loadGrowthConfig(loaded.configs);
const resourcesConfig = loadResourcesConfig(loaded.configs);

const bounds = { minX: -128, maxX: 128, minZ: -128, maxZ: 128, minY: -100, maxY: 100 };

function makeWorlds() {
  const plantWorld = new PlantWorld(
    growthConfig,
    bounds,
    { activeTickRateHz: 20 },
    resourcesConfig,
  );
  const resourceWorld = new ResourceWorld(resourcesConfig, bounds);
  plantWorld.setResourceProvider((x, z) => resourceWorld.getTileResources(x, z));
  plantWorld.setResourceSink({
    takeResources: (x, z, water, minerals, allowGroundwater) =>
      resourceWorld.takeFromTile(x, z, water, minerals, allowGroundwater),
  });
  return { plantWorld, resourceWorld };
}

const DT = 0.05;

/**
 * One economy tick, mirroring the server loop: roots capture first, then the
 * plant steps, then photosynthesis spends the plant's own stores.
 */
function economyTick(
  plantWorld: PlantWorld,
  resourceWorld: ResourceWorld,
  plantId: string,
  tick: number,
  timeOfDay: number,
): number {
  plantWorld.absorbResourcesFromTiles(DT, (x, z) => resourceWorld.getTileResources(x, z));
  plantWorld.step(DT, new Set([plantId]), tick);

  const plant = plantWorld.getPlant(plantId);
  assert.ok(plant, 'plant should still exist');
  const capacity = computePlantCapacity(plant, growthConfig);
  const view = {
    id: plant.id,
    ownerId: plant.ownerId,
    worldId: plant.worldId,
    nodes: plant.nodes,
    totalBiomass: plant.totalBiomass,
    totalUpkeep: plant.totalUpkeep,
    rootNodeId: plant.rootNodeId ?? '',
    storedWater: plant.storedWater,
    storedMinerals: plant.storedMinerals,
    waterCapacity: capacity.water,
    mineralCapacity: capacity.minerals,
  };

  const photo = resourceWorld.calculatePhotosynthesis(view);
  if (photo.energyGain > 0) plantWorld.addPhotosynthesisEnergy(plant.id, photo.energyGain * DT);
  plant.storedWater = Math.max(
    0,
    plant.storedWater - photo.waterCost * DT - resourceWorld.calculateTranspiration(view, DT),
  );
  plant.storedMinerals = Math.max(0, plant.storedMinerals - photo.mineralCost * DT);

  resourceWorld.step(DT, new Map([[plant.id, view]]), 0, 1.0, timeOfDay);
  return photo.energyGain;
}

function runSeconds(
  plantWorld: PlantWorld,
  resourceWorld: ResourceWorld,
  plantId: string,
  startTick: number,
  seconds: number,
  timeOfDay = 0.5,
): number {
  let tick = startTick;
  for (let i = 0; i < seconds * 20; i++) {
    economyTick(plantWorld, resourceWorld, plantId, tick, timeOfDay);
    tick++;
  }
  return tick;
}

describe('growth economy', () => {
  it('a seed establishes on its own reserves, then pays for a stem from what it captured', () => {
    const { plantWorld, resourceWorld } = makeWorlds();
    const plant = plantWorld.createPlant('owner', 'world_0', 0, 0);
    const seedId = plant.rootNodeId;
    assert.ok(seedId);
    let tick = 0;

    const grow = (
      nodeType: 'radicle' | 'cotyledon' | 'stem',
      dir: { x: number; y: number; z: number },
    ) =>
      plantWorld.tryGrow(
        { plantId: plant.id, nodeId: seedId, direction: dir, nodeType, tick },
        tick,
      );

    assert.equal(
      grow('radicle', { x: 0, y: -1, z: 0 }).success,
      true,
      'radicle from seed reserves',
    );
    tick = runSeconds(plantWorld, resourceWorld, plant.id, tick, 4);
    assert.equal(grow('cotyledon', { x: 1, y: 1, z: 0 }).success, true, 'first cotyledon');
    tick = runSeconds(plantWorld, resourceWorld, plant.id, tick, 4);
    assert.equal(grow('cotyledon', { x: -1, y: 1, z: 0 }).success, true, 'second cotyledon');

    // Roots must actually capture water and minerals from the soil.
    tick = runSeconds(plantWorld, resourceWorld, plant.id, tick, 40);
    assert.ok(plant.storedWater > growthConfig.growthMinWater, 'roots capture stored water');
    assert.ok(
      plant.storedMinerals > growthConfig.growthMinMinerals,
      'roots capture stored minerals',
    );

    // Photosynthesis must be producing energy, not merely draining upkeep.
    const before = plant.totalEnergy;
    tick = runSeconds(plantWorld, resourceWorld, plant.id, tick, 10);
    assert.ok(plant.totalEnergy > before, 'a lit, hydrated seedling gains energy');

    const stem = grow('stem', { x: 0, y: 1, z: 0 });
    assert.equal(stem.success, true, `stem should be affordable, got ${stem.reason ?? 'ok'}`);
  });

  it('photosynthesis never invents structural biomass', () => {
    const { plantWorld, resourceWorld } = makeWorlds();
    const plant = plantWorld.createPlant('owner', 'world_0', 0, 0);
    const seedId = plant.rootNodeId;
    assert.ok(seedId);
    let tick = 0;
    plantWorld.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick,
      },
      tick,
    );
    tick = runSeconds(plantWorld, resourceWorld, plant.id, tick, 6);
    plantWorld.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 1, y: 1, z: 0 },
        nodeType: 'cotyledon',
        tick,
      },
      tick,
    );
    tick = runSeconds(plantWorld, resourceWorld, plant.id, tick, 60);

    let nodeBiomass = 0;
    for (const node of plant.nodes.values()) nodeBiomass += node.biomass;
    assert.ok(
      Math.abs(nodeBiomass - plant.totalBiomass) <= plant.totalBiomass * 0.05,
      `totalBiomass ${plant.totalBiomass.toFixed(2)} must track node biomass ${nodeBiomass.toFixed(2)}`,
    );
  });

  it('stops photosynthesising at night while upkeep keeps draining energy', () => {
    const { plantWorld, resourceWorld } = makeWorlds();
    const plant = plantWorld.createPlant('owner', 'world_0', 0, 0);
    const seedId = plant.rootNodeId;
    assert.ok(seedId);
    let tick = 0;
    for (const dir of [
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 1, z: 0 },
    ] as const) {
      plantWorld.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: dir,
          nodeType: dir.y < 0 ? 'radicle' : 'cotyledon',
          tick,
        },
        tick,
      );
      tick = runSeconds(plantWorld, resourceWorld, plant.id, tick, 4);
    }

    const energyAtDusk = plant.totalEnergy;
    runSeconds(plantWorld, resourceWorld, plant.id, tick, 30, 0);

    const gain = economyTick(plantWorld, resourceWorld, plant.id, 999, 0);
    assert.equal(gain, 0, 'no light, no photosynthesis');
    assert.ok(plant.totalEnergy < energyAtDusk, 'night must draw the energy store down');
  });
});
