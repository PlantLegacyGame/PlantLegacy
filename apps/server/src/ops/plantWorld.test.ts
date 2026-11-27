import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigFile } from '@plant-legacy/shared/config';
import {
  type GrowthIntent,
  getAvailableGrowthTypes,
  MID_SEGMENT_BRANCH_TYPES,
  nodeAttachmentPoint,
  plantHealth,
} from '@plant-legacy/shared/growth';
import { buildGrowthOptions } from './growth/options.ts';
import { canGrow } from './growth/rules.ts';
import { loadGrowthConfig } from './growth.ts';
import type { MutationDefinition, MutationsConfig } from './mutations/types.ts';
import { PlantWorld } from './plantWorld.ts';
import { loadResourcesConfig } from './resourceWorld.ts';

function makeTestResourcesConfig(): ReturnType<typeof loadResourcesConfig> {
  const configs = new Map<string, ConfigFile>();
  const baseConfig: ConfigFile = {
    _meta: {
      system: 'resources',
      version: '0.1.0',
      schema: 'extended-1',
      owner_task: 'T00A',
      status: 'draft',
    },
    values: {
      tile_size: { type: 'number', value: 10, range: [1, 100] },
      grid_width: { type: 'integer', value: 100, range: [10, 1000] },
      grid_height: { type: 'integer', value: 100, range: [10, 1000] },
      tile_light_base: { type: 'integer', value: 80, range: [0, 100] },
      day_night_curve: { type: 'array', value: [0.0, 0.2, 0.5, 0.8, 1.0, 0.8, 0.5, 0.2] },
      tile_moisture_base: { type: 'integer', value: 40, range: [0, 100] },
      rain_gain_per_s: { type: 'number', value: 30, range: [0, 100] },
      evaporation_per_s: { type: 'number', value: 5, range: [0, 50] },
      temperature_base: { type: 'number', value: 20, range: [-20, 50] },
      temperature_amplitude: { type: 'number', value: 10, range: [0, 30] },
      temperature_sun_factor: { type: 'number', value: 5, range: [0, 20] },
      transpiration_factor: { type: 'number', value: 0.1, range: [0, 1] },
      photosynthesis_temp_optimum: { type: 'number', value: 25, range: [0, 50] },
      photosynthesis_temp_range: { type: 'number', value: 15, range: [1, 50] },
      tile_minerals_base: { type: 'integer', value: 50, range: [0, 100] },
      absorption_per_s: { type: 'number', value: 1.0, range: [0.1, 10] },
      absorption_radius: { type: 'number', value: 2, range: [1, 10] },
      dead_root_deposit: { type: 'number', value: 10, range: [0, 100] },
      dead_plant_deposit: { type: 'number', value: 50, range: [0, 500] },
      dung_deposit: { type: 'number', value: 20, range: [0, 100] },
      fertilizer_deposit: { type: 'number', value: 30, range: [0, 100] },
      photosynthesis_rate: { type: 'number', value: 0.5, range: [0, 5] },
      photosynthesis_energy_per_second: { type: 'number', value: 10.0, range: [0.1, 100] },
      photosynthesis_water_per_energy: { type: 'number', value: 0.03, range: [0, 1] },
      photosynthesis_mineral_per_energy: { type: 'number', value: 0.006, range: [0, 1] },
      water_status_full_fraction: { type: 'number', value: 0.25, range: [0.05, 1] },
      mineral_status_full_fraction: { type: 'number', value: 0.25, range: [0.05, 1] },
      night_transpiration_multiplier: { type: 'number', value: 0.15, range: [0, 1] },
      light_factor_curve: {
        type: 'array',
        value: [
          [0, 0],
          [50, 0.5],
          [100, 1],
        ],
      },
      moisture_factor_curve: {
        type: 'array',
        value: [
          [0, 0],
          [50, 0.5],
          [100, 1],
        ],
      },
      mineral_factor_curve: {
        type: 'array',
        value: [
          [0, 0],
          [50, 0.5],
          [100, 1],
        ],
      },
      light_dirty_threshold: { type: 'number', value: 0.05, range: [0, 1] },
      resource_dirty_threshold: { type: 'number', value: 0.1, range: [0, 1] },
      diffusion_rate: { type: 'number', value: 0.1, range: [0, 1] },
      soil_step_interval_s: { type: 'number', value: 0.25, range: [0.05, 2] },
      max_absorption_per_tick: { type: 'number', value: 10, range: [0, 100] },
      groundwater_base: { type: 'integer', value: 0, range: [0, 10000] },
      groundwater_capacity: { type: 'integer', value: 400, range: [0, 10000] },
      groundwater_infiltration_fraction: { type: 'number', value: 0.55, range: [0, 1] },
      groundwater_percolation_rate: { type: 'number', value: 0.04, range: [0, 1] },
      groundwater_capillary_rise_per_s: { type: 'number', value: 0.15, range: [0, 10] },
      groundwater_root_uptake_fraction: { type: 'number', value: 0.25, range: [0, 1] },
      groundwater_root_reserve_fraction: { type: 'number', value: 0.05, range: [0, 0.9] },
      canopy_shade_reduction: { type: 'number', value: 0.5, range: [0, 1] },
      max_light: { type: 'integer', value: 100, range: [50, 200] },
      max_moisture: { type: 'integer', value: 100, range: [50, 200] },
      max_minerals: { type: 'integer', value: 100, range: [50, 200] },
    },
  };
  configs.set('resources', baseConfig);
  return loadResourcesConfig(configs);
}

function makeTestGrowthConfig(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof loadGrowthConfig> {
  const configs = new Map<string, ConfigFile>();
  const baseConfig: ConfigFile = {
    _meta: {
      system: 'growth',
      version: '0.1.0',
      schema: 'extended-1',
      owner_task: 'T01',
      status: 'draft',
    },
    values: {
      root_growth_speed: { type: 'number', value: 0.5, range: [0.1, 10.0] },
      canopy_growth_speed: { type: 'number', value: 0.5, range: [0.1, 10.0] },
      node_cost_base: { type: 'integer', value: 10, range: [1, 100] },
      max_nodes_per_plant: { type: 'integer', value: 2000, range: [200, 200000] },
      growth_cooldown: { type: 'number', value: 0.5, range: [0.0, 1.0] },
      light_blocking_per_node: { type: 'integer', value: 5, range: [1, 25] },
      seed_node: {
        type: 'object',
        value: {
          biomass_cost: 25,
          resource_draw_water: 0.0,
          resource_draw_nutrients: 0.0,
          resource_draw_minerals: 0.0,
          upkeep_biomass_per_second: 0.0,
          stat_modifiers: {},
          growth_direction_bias: 'downward',
          growth_time_seconds: 0,
        },
      },
      root_node: {
        type: 'object',
        value: {
          biomass_cost: 15,
          resource_draw_water: 0.5,
          resource_draw_nutrients: 0.3,
          resource_draw_minerals: 0.4,
          upkeep_biomass_per_second: 0.001,
          stat_modifiers: {},
          growth_direction_bias: 'downward',
          growth_time_seconds: 5,
        },
      },
      stem_node: {
        type: 'object',
        value: {
          biomass_cost: 12,
          resource_draw_water: 0.2,
          resource_draw_nutrients: 0.2,
          resource_draw_minerals: 0.6,
          upkeep_biomass_per_second: 0.02,
          stat_modifiers: { structural_integrity: 1.0 },
          growth_direction_bias: 'upward',
          growth_time_seconds: 8,
        },
      },
      leaf_node: {
        type: 'object',
        value: {
          biomass_cost: 6,
          resource_draw_water: 0.1,
          resource_draw_nutrients: 0.1,
          resource_draw_minerals: 0.05,
          upkeep_biomass_per_second: 0.003,
          stat_modifiers: { photosynthesis: 1.5, light_blocking: 1.0 },
          growth_direction_bias: 'outward',
          growth_time_seconds: 4,
        },
      },
      cotyledon_node: {
        type: 'object',
        value: {
          biomass_cost: 6,
          resource_draw_water: 0.1,
          resource_draw_nutrients: 0.1,
          resource_draw_minerals: 0.05,
          upkeep_biomass_per_second: 0.003,
          stat_modifiers: { photosynthesis: 1.2, light_blocking: 0.8 },
          growth_direction_bias: 'outward',
          growth_time_seconds: 2,
        },
      },
      radicle_node: {
        type: 'object',
        value: {
          biomass_cost: 8,
          resource_draw_water: 0.8,
          resource_draw_nutrients: 0.5,
          resource_draw_minerals: 0.1,
          upkeep_biomass_per_second: 0.001,
          stat_modifiers: {},
          growth_direction_bias: 'downward',
          growth_time_seconds: 3,
        },
      },
      lateral_root_node: {
        type: 'object',
        value: {
          biomass_cost: 6,
          resource_draw_water: 0.6,
          resource_draw_nutrients: 0.4,
          resource_draw_minerals: 0.2,
          upkeep_biomass_per_second: 0.0008,
          stat_modifiers: {},
          growth_direction_bias: 'horizontal',
          growth_time_seconds: 3,
        },
      },
      branch_node: {
        type: 'object',
        value: {
          biomass_cost: 10,
          resource_draw_water: 0.2,
          resource_draw_nutrients: 0.2,
          resource_draw_minerals: 0.5,
          upkeep_biomass_per_second: 0.015,
          stat_modifiers: { structural_integrity: 0.8 },
          growth_direction_bias: 'outward',
          growth_time_seconds: 6,
        },
      },
      flower_node: {
        type: 'object',
        value: {
          biomass_cost: 25,
          resource_draw_water: 0.3,
          resource_draw_nutrients: 0.4,
          resource_draw_minerals: 0.3,
          upkeep_biomass_per_second: 0.05,
          stat_modifiers: { reproduction: 1.0, pollinator_attraction: 1.0 },
          growth_direction_bias: 'upward',
          growth_time_seconds: 15,
        },
      },
      spore_sac_node: {
        type: 'object',
        value: {
          biomass_cost: 18,
          resource_draw_water: 0.2,
          resource_draw_nutrients: 0.3,
          resource_draw_minerals: 0.2,
          upkeep_biomass_per_second: 0.04,
          stat_modifiers: { spore_production: 1.0 },
          growth_direction_bias: 'outward',
          growth_time_seconds: 10,
        },
      },
      vine_node: {
        type: 'object',
        value: {
          biomass_cost: 8,
          resource_draw_water: 0.2,
          resource_draw_nutrients: 0.1,
          resource_draw_minerals: 0.15,
          upkeep_biomass_per_second: 0.02,
          stat_modifiers: { climbing: 1.0, horizontal_spread: 1.5 },
          growth_direction_bias: 'horizontal',
          growth_time_seconds: 5,
        },
      },
      growth_intent_cooldown: { type: 'number', value: 0.2, range: [0.05, 1.0] },
      germination_min_moisture: { type: 'number', value: 30, range: [0, 100] },
      germination_min_light: { type: 'number', value: 10, range: [0, 100] },
      germination_failure_kills_seed: { type: 'boolean', value: true },
      photosynthesis_energy_per_second: { type: 'number', value: 10.0, range: [0.1, 100.0] },
      energy_upkeep_per_biomass: { type: 'number', value: 0.01, range: [0.001, 0.1] },
      max_energy_per_plant: { type: 'integer', value: 10000, range: [100, 1000000] },
      growth_water_consumption_rate: { type: 'number', value: 2.0, range: [0.1, 50.0] },
      growth_nutrient_consumption_rate: { type: 'number', value: 1.5, range: [0.1, 50.0] },
      growth_mineral_consumption_rate: { type: 'number', value: 1.0, range: [0.1, 50.0] },
      growth_min_water: { type: 'number', value: 20, range: [0, 100] },
      growth_min_nutrients: { type: 'number', value: 15, range: [0, 100] },
      growth_min_minerals: { type: 'number', value: 10, range: [0, 100] },
      energy_capacity_per_biomass: { type: 'number', value: 400, range: [50, 5000] },
      energy_capacity_floor: { type: 'number', value: 120, range: [10, 10000] },
      water_capacity_per_root_biomass: { type: 'number', value: 160, range: [10, 5000] },
      water_capacity_floor: { type: 'number', value: 40, range: [5, 5000] },
      mineral_capacity_per_root_biomass: { type: 'number', value: 160, range: [10, 5000] },
      mineral_capacity_floor: { type: 'number', value: 40, range: [5, 5000] },
      initial_energy_fraction: { type: 'number', value: 0.5, range: [0.05, 1] },
      germinationMinLight: { type: 'number', value: 10, range: [0, 100] },
      germinationMinMoisture: { type: 'number', value: 30, range: [0, 100] },
      germinationFailureKillsSeed: { type: 'boolean', value: true },
    },
  };
  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    baseConfig.values[key] = value as ConfigFile['values'][string];
  }
  configs.set('growth', baseConfig);
  return loadGrowthConfig(configs);
}

function makeTestPlantWorld(overrides: Record<string, unknown> = {}) {
  const config = makeTestGrowthConfig(overrides);
  const resourcesConfig = makeTestResourcesConfig();
  return new PlantWorld(
    config,
    {
      minX: -1000,
      maxX: 1000,
      minZ: -1000,
      maxZ: 1000,
      minY: -100,
      maxY: 100,
    },
    undefined,
    resourcesConfig,
  );
}

describe('PlantWorld', () => {
  it('creates a plant with a seed node', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);

    assert(plant.id.startsWith('p_'));
    assert.equal(plant.ownerId, 'player_1');
    assert.equal(plant.worldId, 'world_0');
    assert.equal(plant.nodes.size, 1);

    const seedId = Array.from(plant.nodes.keys())[0];
    assert(seedId !== null && seedId !== undefined);
    const seedNode = plant.nodes.get(seedId);
    assert.equal(seedNode?.type, 'seed');
    assert.equal(seedNode?.layer, 'root');
    assert.equal(seedNode?.parentId, null);
    assert.equal(seedNode?.biomass, 25);
    assert.equal(seedNode?.upkeepBiomassPerSecond, 0);
    assert.equal(plant.totalUpkeep, 0);
    assert.equal(plant.rootNodeId, seedId, 'seed crown is the structural root');
  });

  it('shrinks a part radius when damage takes its biomass', () => {
    const world = makeTestPlantWorld({
      node_radius_profiles: {
        type: 'object',
        value: { seed: { nominalBiomass: 25, radius: 0.15, min: 0.005, max: 0.2 } },
      },
    });
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    assert(seedId);
    const seed = plant.nodes.get(seedId);
    assert(seed);
    const before = seed.radius ?? 0;
    world.applyNodeDamage(plant.id, seedId, seed.biomass / 2);
    const after = plant.nodes.get(seedId)?.radius ?? 0;
    assert.ok(before > 0, 'the seed starts with a drawn radius');
    assert.ok(
      after < before,
      `losing half its mass must thin the part, ${before.toFixed(4)} -> ${after.toFixed(4)}`,
    );
  });

  it('flags a removed plant dead instead of only dropping it from the map', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    assert.equal(plant.dead, undefined, 'a live plant carries no death flag');
    world.killPlant(plant.id, 'removed');
    assert.equal(plant.dead, true, 'the body a caller still holds says it is dead');
    assert.equal(world.getPlant(plant.id), undefined, 'and the world no longer hands it out');
    const growth = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: Array.from(plant.nodes.keys())[0] ?? '',
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 10,
      },
      10,
    );
    assert.equal(growth.success, false, 'a dead body cannot grow');
  });

  it('gets plants by owner', () => {
    const world = makeTestPlantWorld();
    const plant1 = world.createPlant('player_1', 'world_0', 0, 0);
    const plant2 = world.createPlant('player_1', 'world_0', 10, 10);
    world.createPlant('player_2', 'world_0', 20, 20);

    const player1Plants = world.getPlantsByOwner('player_1');
    assert.equal(player1Plants.length, 2);
    assert(player1Plants.some((p) => p.id === plant1.id));
    assert(player1Plants.some((p) => p.id === plant2.id));

    const player2Plants = world.getPlantsByOwner('player_2');
    assert.equal(player2Plants.length, 1);
  });

  it('germinates seed and grows a stem node', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];

    // Set up resource provider with good conditions for germination
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));

    // Trigger germination
    const germinateResult = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 }, // downward for radicle
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );

    assert(germinateResult.success);
    assert(germinateResult.newNode, 'stepwise germination creates a radicle');
    assert.equal(germinateResult.newNode?.type, 'radicle');
    assert(germinateResult.updatedParentNode, 'germination keeps the seed crown updated');
    assert.equal(germinateResult.updatedParentNode?.type, 'seed');
    assert.equal(germinateResult.updatedParentNode?.isSeed, true);

    // The radicle leaves the coat, not the stored ground-contact point, and the
    // step it reports to clients starts where the renderer will start the tube.
    const seedCrown = plant.nodes.get(seedId);
    assert(seedCrown);
    const expectedAttach = nodeAttachmentPoint(seedCrown, { x: 0, y: -1, z: 0 });
    const radicle = germinateResult.newNode;
    assert(radicle);
    assert.equal(radicle.parentAttachX, expectedAttach.x);
    assert.equal(radicle.parentAttachY, expectedAttach.y);
    assert.equal(radicle.parentAttachZ, expectedAttach.z);
    assert.ok(
      expectedAttach.y > seedCrown.y,
      'the coat contact sits above the stored ground-contact point',
    );
    const radicleStep = Math.hypot(
      radicle.x - expectedAttach.x,
      radicle.y - expectedAttach.y,
      radicle.z - expectedAttach.z,
    );

    // Complete radicle growth, then add cotyledons stepwise (directed).
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    let updatedPlant = world.getPlant(plant.id);
    assert(updatedPlant);
    const settledRadicle = updatedPlant.nodes.get(radicle.id);
    assert(settledRadicle);
    const settledStep = Math.hypot(
      settledRadicle.x - expectedAttach.x,
      settledRadicle.y - expectedAttach.y,
      settledRadicle.z - expectedAttach.z,
    );
    assert.ok(
      Math.abs(settledStep - radicleStep) < 1e-9,
      'segment-length enforcement must measure from the coat, not the stored base',
    );
    const crownId = updatedPlant.rootNodeId ?? seedId;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([updatedPlant.id]), 200 + c * 40 + i);
      const coty = world.tryGrow(
        {
          plantId: updatedPlant.id,
          nodeId: crownId,
          direction: { x: c === 0 ? 0.3 : -0.3, y: 1, z: 0 },
          nodeType: 'cotyledon',
          tick: 250 + c,
        },
        250 + c * 20,
      );
      assert(coty.success, `cotyledon ${c + 1} should succeed: ${coty.reason ?? ''}`);
      for (let i = 0; i < 80; i++) world.step(0.1, new Set([updatedPlant.id]), 260 + c * 100 + i);
      const next = world.getPlant(updatedPlant.id);
      assert(next, 'plant should exist after stepwise germination');
      updatedPlant = next;
    }

    assert(updatedPlant.nodes.size >= 4);
    const rootNode = updatedPlant.nodes.get(crownId);
    assert.equal(rootNode?.type, 'seed');
    assert.equal(updatedPlant.rootNodeId, crownId, 'seed crown remains the structural root');
    const cotyledons = Array.from(updatedPlant.nodes.values()).filter(
      (n) => n.type === 'cotyledon',
    );
    assert(cotyledons.length >= 2, 'two cotyledons should exist');

    // E27: the first cotyledon ends the seed. The crown keeps its type and its
    // place as the structural root, but it is no longer a fresh seed - which is
    // what keeps the menu from offering a radicle and the prologue from accepting
    // one, so a plant cannot germinate twice.
    assert.equal(rootNode?.isSeed, false, 'a crown with cotyledons must not still be a seed');
    const secondRadicle = world.tryGrow(
      {
        plantId: updatedPlant.id,
        nodeId: updatedPlant.rootNodeId ?? crownId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 900,
      },
      900,
    );
    assert.equal(
      secondRadicle.success,
      false,
      'an established crown cannot sprout another radicle',
    );
    assert.equal(secondRadicle.reason, 'radicle_only_from_seed');

    // Now try to grow a stem from the established crown
    const rootId = updatedPlant.rootNodeId ?? crownId;

    // Reset resource provider for growth
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));

    // Fill plant's internal resource storage for growth
    updatedPlant.storedWater = 1000;
    updatedPlant.storedMinerals = 1000;

    // Advance time for cooldown to expire
    for (let i = 0; i < 30; i++) world.step(0.1, new Set([updatedPlant.id]), 500 + i);

    const stemIntent: GrowthIntent = {
      plantId: updatedPlant.id,
      nodeId: rootId,
      direction: { x: 0, y: 1, z: 0 }, // upward
      nodeType: 'stem',
      tick: 2,
    };

    const stemResult = world.tryGrow(stemIntent, 560);
    assert.equal(
      stemResult.success,
      true,
      stemResult.reason ?? 'stem should grow from established crown',
    );
    assert(stemResult.newNode);
    assert.equal(stemResult.newNode?.type, 'stem');
    assert.equal(stemResult.newNode?.layer, 'canopy');
    assert.equal(stemResult.newNode?.parentId, rootId);

    // An upward shoot also leaves the coat, one stem step above it.
    const stem = stemResult.newNode;
    assert(stem);
    const crown = updatedPlant.nodes.get(rootId);
    assert(crown);
    const stemAttach = nodeAttachmentPoint(crown, { x: 0, y: 1, z: 0 });
    assert.equal(stem.parentAttachX, stemAttach.x);
    assert.equal(stem.parentAttachY, stemAttach.y);
    const stemStep = Math.hypot(
      stem.x - stemAttach.x,
      stem.y - stemAttach.y,
      stem.z - stemAttach.z,
    );
    assert.ok(stemStep > 0.3, 'stem is drawn one full segment above the coat');
    assert.ok(stem.y > crown.y, 'an upward stem rises above the stored seed base');
  });

  it('rejects growth when on cooldown', () => {
    const world = makeTestPlantWorld({
      growth_cooldown: { type: 'number', value: 0.5, range: [0.0, 1.0] },
    });
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];

    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));

    // Stepwise germinate: radicle + 2 cotyledons -> establish crown
    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    const crownId = plant.rootNodeId ?? seedId;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([plant.id]), 150 + c * 60 + i);
      assert(
        world.tryGrow(
          {
            plantId: plant.id,
            nodeId: crownId,
            direction: { x: c ? -0.3 : 0.3, y: 1, z: 0 },
            nodeType: 'cotyledon',
            tick: 200 + c,
          },
          180 + c * 60,
        ).success,
      );
      for (let i = 0; i < 80; i++) world.step(0.1, new Set([plant.id]), 220 + c * 80 + i);
    }
    const updatedPlant = world.getPlant(plant.id);
    assert(updatedPlant);
    updatedPlant.storedWater = 1000;
    updatedPlant.storedMinerals = 1000;
    const rootId = updatedPlant.rootNodeId ?? crownId;
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 500 + i);

    const intent: GrowthIntent = {
      plantId: plant.id,
      nodeId: rootId,
      direction: { x: 0, y: 1, z: 0 },
      nodeType: 'stem',
      tick: 2,
    };
    assert.equal(world.tryGrow(intent, 560).success, true);
    assert.equal(world.tryGrow({ ...intent, tick: 101 }, 560).success, false);
    assert.equal(world.tryGrow({ ...intent, tick: 101 }, 560).reason, 'growth_on_cooldown');
  });

  it('rejects growth when insufficient energy', () => {
    const world = makeTestPlantWorld({
      max_energy_per_plant: { type: 'integer', value: 5000, range: [100, 1000000] },
    });
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    const crownId = plant.rootNodeId ?? seedId;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([plant.id]), 150 + c * 60 + i);
      assert(
        world.tryGrow(
          {
            plantId: plant.id,
            nodeId: crownId,
            direction: { x: c ? -0.3 : 0.3, y: 1, z: 0 },
            nodeType: 'cotyledon',
            tick: 200 + c,
          },
          180 + c * 60,
        ).success,
      );
      for (let i = 0; i < 80; i++) world.step(0.1, new Set([plant.id]), 220 + c * 80 + i);
    }
    const updatedPlant = world.getPlant(plant.id);
    assert(updatedPlant);
    updatedPlant.storedWater = 1000;
    updatedPlant.storedMinerals = 1000;
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 500 + i);
    updatedPlant.totalEnergy = 5;
    const result = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: updatedPlant.rootNodeId ?? crownId,
        direction: { x: 0, y: 1, z: 0 },
        nodeType: 'stem',
        tick: 2,
      },
      560,
    );
    assert.equal(result.success, false);
    assert.equal(result.reason, 'insufficient_energy');
  });

  it('rejects growth when max nodes reached', () => {
    // Stepwise germination: radicle + 2 cotyledons = 4 nodes total (seed crown + radicle + 2 cotyledons)
    const world = makeTestPlantWorld({
      max_nodes_per_plant: { type: 'integer', value: 4, range: [4, 200000] },
    });
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];

    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));

    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    const crownId = plant.rootNodeId ?? seedId;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([plant.id]), 150 + c * 60 + i);
      assert(
        world.tryGrow(
          {
            plantId: plant.id,
            nodeId: crownId,
            direction: { x: c ? -0.3 : 0.3, y: 1, z: 0 },
            nodeType: 'cotyledon',
            tick: 200 + c,
          },
          180 + c * 60,
        ).success,
      );
      for (let i = 0; i < 80; i++) world.step(0.1, new Set([plant.id]), 220 + c * 80 + i);
    }
    const updatedPlant = world.getPlant(plant.id);
    assert(updatedPlant);
    updatedPlant.storedWater = 1000;
    updatedPlant.storedMinerals = 1000;
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 500 + i);
    const result = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: updatedPlant.rootNodeId ?? crownId,
        direction: { x: 0, y: 1, z: 0 },
        nodeType: 'stem',
        tick: 2,
      },
      560,
    );
    assert.equal(result.success, false);
    assert.equal(result.reason, 'max_nodes_reached');
  });

  it('allows growth out of root node', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    const crownId = plant.rootNodeId ?? seedId;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([plant.id]), 150 + c * 60 + i);
      assert(
        world.tryGrow(
          {
            plantId: plant.id,
            nodeId: crownId,
            direction: { x: c ? -0.3 : 0.3, y: 1, z: 0 },
            nodeType: 'cotyledon',
            tick: 200 + c,
          },
          180 + c * 60,
        ).success,
      );
      for (let i = 0; i < 80; i++) world.step(0.1, new Set([plant.id]), 220 + c * 80 + i);
    }
    const updatedPlant = world.getPlant(plant.id);
    assert(updatedPlant);
    updatedPlant.storedWater = 1000;
    updatedPlant.storedMinerals = 1000;
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 500 + i);
    // Establish crown -> grow stem to access root/canopy transitions, then lateral root from radicle/root.
    const stemRes = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: updatedPlant.rootNodeId ?? crownId,
        direction: { x: 0, y: 1, z: 0 },
        nodeType: 'stem',
        tick: 2,
      },
      560,
    );
    assert.equal(stemRes.success, true, stemRes.reason ?? 'stem');
    const radicle = Array.from(updatedPlant.nodes.values()).find((n) => n.type === 'radicle');
    assert(radicle, 'radicle should exist');
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 600 + i);
    const lateralResult = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: radicle.id,
        direction: { x: 0.2, y: -1, z: 0 },
        nodeType: 'lateral_root',
        tick: 3,
      },
      660,
    );
    assert.equal(lateralResult.success, true, lateralResult.reason ?? 'lateral root from radicle');
    assert.equal(lateralResult.newNode?.type, 'lateral_root');
  });

  it('grows vine node horizontally', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    const crownId = plant.rootNodeId ?? seedId;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([plant.id]), 150 + c * 60 + i);
      assert(
        world.tryGrow(
          {
            plantId: plant.id,
            nodeId: crownId,
            direction: { x: c ? -0.3 : 0.3, y: 1, z: 0 },
            nodeType: 'cotyledon',
            tick: 200 + c,
          },
          180 + c * 60,
        ).success,
      );
      for (let i = 0; i < 80; i++) world.step(0.1, new Set([plant.id]), 220 + c * 80 + i);
    }
    const updatedPlant = world.getPlant(plant.id);
    assert(updatedPlant);
    updatedPlant.storedWater = 1000;
    updatedPlant.storedMinerals = 1000;
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 500 + i);
    const stemResult = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: updatedPlant.rootNodeId ?? crownId,
        direction: { x: 0, y: 1, z: 0 },
        nodeType: 'stem',
        tick: 2,
      },
      560,
    );
    assert.equal(stemResult.success, true, stemResult.reason ?? 'stem');
    for (let i = 0; i < 80; i++) world.step(0.1, new Set([plant.id]), 580 + i);
    const stemId = stemResult.newNode?.id;
    assert(stemId);
    const vineResult = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: stemId,
        direction: { x: 1, y: 0.1, z: 0 },
        nodeType: 'vine',
        tick: 3,
      },
      700,
    );
    assert.equal(vineResult.success, true, vineResult.reason ?? 'vine');
    assert.equal(vineResult.newNode?.type, 'vine');
  });

  it('rejects growth out of bounds', () => {
    const world = makeTestPlantWorld({
      max_nodes_per_plant: { type: 'integer', value: 1000, range: [200, 200000] },
    });
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];

    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));

    const germinateResult = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert(germinateResult.success);

    for (let i = 0; i < 100; i++) {
      world.step(0.1, new Set([plant.id]), 2 + i);
    }

    const updatedPlant = world.getPlant(plant.id);
    assert(updatedPlant);
    const rootId = updatedPlant.rootNodeId ?? seedId;

    // Move far out by growing many times
    let currentNodeId = rootId;
    let currentTick = 102;
    for (let i = 0; i < 150; i++) {
      const result = world.tryGrow(
        {
          plantId: plant.id,
          nodeId: currentNodeId,
          direction: { x: 1, y: 0, z: 0 },
          nodeType: 'lateral_root',
          tick: i + 10,
        },
        currentTick,
      );
      if (!result.success || !result.newNode) break;
      currentNodeId = result.newNode.id;
      currentTick++;
    }

    // Eventually should hit bounds
    const finalResult = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: currentNodeId,
        direction: { x: 1, y: 0, z: 0 },
        nodeType: 'lateral_root',
        tick: 200,
      },
      currentTick,
    );
    // May fail due to max nodes or bounds
    assert(
      finalResult.success === false ||
        finalResult.reason === 'out_of_bounds' ||
        finalResult.reason === 'max_nodes_reached',
    );
  });

  it('INV-GR-13: quoted growth costs in getGrowthOptions exactly match energy deducted in tryGrow', () => {
    const world = makeTestPlantWorld();
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    const plant = world.createPlant('p1', 'w1', 0, 0);
    const seedNodeId = plant.rootNodeId ?? '';

    // Seed germination quote
    const optionsResult = world.getGrowthOptions(plant.id, seedNodeId);
    assert.ok(optionsResult);
    const radicleOption = optionsResult.options.find((o) => o.type === 'radicle');
    assert.ok(radicleOption);

    const initialEnergy = plant.totalEnergy;
    const growResult = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedNodeId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert.equal(growResult.success, true, growResult.reason);
    const energyDeducted = initialEnergy - plant.totalEnergy;
    assert.equal(energyDeducted, radicleOption.energyCost);

    // After germination, check quote for cotyledon matches definition
    const postOptions = world.getGrowthOptions(plant.id, seedNodeId);
    assert.ok(postOptions);
    const cotyledonOption = postOptions.options.find((o) => o.type === 'cotyledon');
    assert.ok(cotyledonOption);
    assert.equal(cotyledonOption.energyCost, 6);
    assert.equal(cotyledonOption.biomassGain, 6);
  });

  it('quotes the soil and mutation charge, so a card never offers growth that is refused', () => {
    const world = makeTestPlantWorld();
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    // Deep, compacted soil charges more than the bare node cost. The menu used
    // to quote the bare figure and the charge applied the multiplier, so a card
    // said "6 energy", the server wanted 11 and refused growth for energy the
    // card had promised was enough.
    world.setGrowthResistanceProvider(() => 2.4);
    const plant = world.createPlant('p1', 'w1', 0, 0);
    const seedId = plant.rootNodeId ?? '';
    const options = world.getGrowthOptions(plant.id, seedId);
    assert.ok(options);
    const radicle = options.options.find((o) => o.type === 'radicle');
    assert.ok(radicle);
    assert.ok(
      radicle.energyCost > 6,
      `root quote must carry soil resistance, quoted ${radicle.energyCost}`,
    );

    // Pay exactly what the card asked for: growth must go through.
    plant.totalEnergy = radicle.energyCost;
    const grown = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert.equal(grown.success, true, grown.reason);

    // Canopy growth is in air: no soil multiplier, so the cotyledon quote is the
    // bare definition cost.
    const canopy = world.getGrowthOptions(plant.id, seedId);
    assert.ok(canopy);
    const cotyledon = canopy.options.find((o) => o.type === 'cotyledon');
    assert.ok(cotyledon);
    assert.equal(cotyledon.energyCost, 6);
  });

  it('keeps a leafless seedling breathing and able to grow its first cotyledon', () => {
    const world = makeTestPlantWorld();
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    const plant = world.createPlant('p1', 'w1', 0, 0);
    const seedId = plant.rootNodeId ?? '';

    const germinated = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert.equal(germinated.success, true, germinated.reason);

    // Let the radicle finish. There is still no photosynthetic organ, so this
    // span must not respire the seed reserve to zero.
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    const afterRadicle = world.getPlant(plant.id);
    assert.ok(afterRadicle, 'the seedling is still alive');
    assert.ok(!afterRadicle.dead, 'a root-first seedling does not starve');
    assert.ok(
      afterRadicle.totalEnergy >= 6,
      `the first cotyledon is affordable, energy is ${afterRadicle.totalEnergy}`,
    );

    const crown = afterRadicle.rootNodeId ?? '';
    const options = world.getGrowthOptions(plant.id, crown);
    assert.ok(options);
    const cotyledon = options.options.find((option) => option.type === 'cotyledon');
    assert.ok(cotyledon);

    // Even an older plant that arrives at zero gets the reserve floor on the
    // next tick, instead of staying inert forever.
    afterRadicle.totalEnergy = 0;
    afterRadicle.growthCooldownUntil = 0;
    world.step(0.1, new Set([plant.id]), 50);
    assert.ok(
      afterRadicle.totalEnergy >= cotyledon.energyCost,
      `the floor restores the first-leaf cost, energy is ${afterRadicle.totalEnergy}`,
    );

    afterRadicle.growthCooldownUntil = 0;
    const shoot = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: crown,
        direction: { x: 0, y: 1, z: 0 },
        nodeType: 'cotyledon',
        tick: 60,
      },
      60,
    );
    assert.equal(shoot.success, true, shoot.reason);
  });

  it('restores the germination reserve to a lone seed that reached zero energy', () => {
    const world = makeTestPlantWorld();
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    const plant = world.createPlant('p1', 'w1', 0, 0);
    plant.totalEnergy = 0;
    plant.growthCooldownUntil = 0;

    world.step(0.1, new Set([plant.id]), 1);
    const capacity = world.getPlantCapacity(plant.id);
    assert(capacity);
    assert.ok(plant.totalEnergy > 0, 'a lone seed is not left inert at zero energy');
    assert.ok(
      plant.totalEnergy <= capacity.energy + 1e-9,
      `the reserve stays inside capacity (${plant.totalEnergy} > ${capacity.energy})`,
    );

    const seedId = plant.rootNodeId ?? '';
    const germinated = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 2,
      },
      2,
    );
    assert.equal(germinated.success, true, germinated.reason);
  });

  it('refuses a root that would eat the first-leaf reserve', () => {
    const world = makeTestPlantWorld();
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    const plant = world.createPlant('p1', 'w1', 0, 0);
    const seedId = plant.rootNodeId ?? '';
    assert.equal(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
      true,
    );
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 2 + i);

    const radicle = Array.from(plant.nodes.values()).find((node) => node.type === 'radicle');
    assert.ok(radicle);
    const options = world.getGrowthOptions(plant.id, radicle.id);
    assert.ok(options);
    const lateral = options.options.find((option) => option.type === 'lateral_root');
    assert.ok(lateral);

    // Enough to pay the root, but only one unit left for a leaf. The seed's
    // first-leaf reserve must win.
    plant.totalEnergy = lateral.energyCost + 1;
    plant.growthCooldownUntil = 0;
    const refused = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: radicle.id,
        direction: { x: 0.2, y: -1, z: 0 },
        nodeType: 'lateral_root',
        tick: 60,
      },
      60,
    );
    assert.equal(refused.success, false);
    assert.equal(refused.reason, 'seed_reserve');
  });

  it('never moves a stored position while stepping', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));

    const germinated = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert(germinated.success, germinated.reason ?? 'germination');

    // Let the radicle finish so the skeleton is settled, then record it.
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    const settled = world.getPlant(plant.id);
    assert(settled);
    const before = new Map(
      [...settled.nodes].map(([id, node]) => [id, { x: node.x, y: node.y, z: node.z }]),
    );

    // Growth is a render-time scale; a tick may not rewrite a node position.
    for (let i = 0; i < 200; i++) world.step(0.1, new Set([plant.id]), 200 + i);
    const after = world.getPlant(plant.id);
    assert(after);
    for (const [id, position] of before) {
      const node = after.nodes.get(id);
      assert(node, `node ${id} should still exist`);
      assert.equal(node.x, position.x);
      assert.equal(node.y, position.y);
      assert.equal(node.z, position.z);
    }
  });

  it('repairs a drifted node on load and leaves a healthy one alone', () => {
    const radicleNode = {
      type: 'object',
      value: {
        biomass_cost: 8,
        resource_draw_water: 0.8,
        resource_draw_nutrients: 0.5,
        resource_draw_minerals: 0.1,
        upkeep_biomass_per_second: 0.001,
        stat_modifiers: {},
        growth_direction_bias: 'downward',
        growth_time_seconds: 3,
        segment_length: 0.85,
      },
    };
    const overrides = { radicle_node: radicleNode };

    const source = makeTestPlantWorld(overrides);
    const plant = source.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];
    source.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    const germinated = source.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert(germinated.success, germinated.reason ?? 'germination');
    const radicle = germinated.newNode;
    assert(radicle);
    for (let i = 0; i < 120; i++) source.step(0.1, new Set([plant.id]), 2 + i);

    const crown = plant.nodes.get(seedId);
    assert(crown);
    const attach = nodeAttachmentPoint(crown, { x: 0, y: -1, z: 0 });

    // A healthy save is loaded without a single coordinate being rewritten.
    const healthy = makeTestPlantWorld(overrides);
    healthy.loadPlant(plant);
    const untouched = healthy.getPlant(plant.id)?.nodes.get(radicle.id);
    assert(untouched);
    assert.equal(untouched.x, radicle.x);
    assert.equal(untouched.y, radicle.y);
    assert.equal(untouched.z, radicle.z);

    // A save whose node drifted off its step is snapped back onto it.
    radicle.x = attach.x;
    radicle.y = attach.y - 2.5;
    radicle.z = attach.z;
    const loaded = makeTestPlantWorld(overrides);
    loaded.loadPlant(plant);
    const restored = loaded.getPlant(plant.id)?.nodes.get(radicle.id);
    assert(restored);
    const step = Math.hypot(restored.x - attach.x, restored.y - attach.y, restored.z - attach.z);
    assert.ok(Math.abs(step - 0.85) < 1e-9, `expected one 0.85 m step, got ${step}`);
    // The drawn segment follows the repaired position, not the stale save.
    assert.equal(restored.parentAttachY, attach.y);
    assert.equal(restored.targetY, restored.y);
    assert.equal(restored.growthStartY, attach.y);
  });

  it('refuses a corrupt snapshot instead of inserting it', () => {
    const source = makeTestPlantWorld();
    const plant = source.createPlant('player_1', 'world_0', 0, 0);
    plant.rootNodeId = 'missing-root';

    const target = makeTestPlantWorld();
    assert.throws(() => target.loadPlant(plant), /Refusing to load corrupt plant/);
    assert.equal(target.getAllPlants().length, 0);
  });

  it('never offers a mid-segment part from the seed or the crown', () => {
    const config = makeTestGrowthConfig();
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    const seed = plant.nodes.get(seedId);
    assert(seed);

    // The client chooses the joint by projecting a press onto the part's own
    // segment, so a part with no parent segment has no joint to choose. The seed
    // is that part: its menu is radicle, cotyledon or stem, none of them
    // mid-segment, which is why the client's "that press missed" copy has one
    // case and no "this part has no segment" branch.
    assert.equal(seed.parentId, null, 'the seed is the plant root');

    const midSegment = new Set<string>(MID_SEGMENT_BRANCH_TYPES);
    const offered = (options: { type: string }[]): string[] =>
      options.filter((option) => midSegment.has(option.type)).map((option) => option.type);

    // The same filter finds a mid-segment part where one belongs, so an empty
    // answer below means "not offered", not "the filter never matches".
    assert.ok(
      getAvailableGrowthTypes('radicle', config).some((type) => midSegment.has(type)),
      'a radicle should offer a mid-segment part',
    );

    // Every mid-segment organ unlocked at once: a mutation can hand the menu an
    // organ the base rules never list, and the seed/crown menu is built by its own
    // rule, before unlocked types are merged.
    const unlocked = [...MID_SEGMENT_BRANCH_TYPES];

    for (const isSeed of [true, false]) {
      seed.isSeed = isSeed;
      const label = isSeed ? 'seed' : 'crown';

      const menu = world.getGrowthOptions(plant.id, seedId);
      assert(menu, `${label}: the world answers for the root node`);
      // Not vacuous: the menu really has something in it to not be mid-segment.
      assert.ok(menu.options.length > 0, `${label}: has a menu at all`);
      assert.deepEqual(offered(menu.options), [], `${label} offered a mid-segment part`);
      assert.deepEqual(
        offered(buildGrowthOptions(config, plant, seed, undefined, unlocked).options),
        [],
        `${label} offered a mid-segment part once a mutation unlocked it`,
      );
    }
  });

  it('buds a lateral root part-way along the radicle and keeps it there', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));

    const germinated = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert(germinated.success, germinated.reason ?? 'germination');
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);

    const updated = world.getPlant(plant.id);
    assert(updated);
    const radicle = Array.from(updated.nodes.values()).find((node) => node.type === 'radicle');
    assert(radicle);
    updated.storedWater = 1000;
    updated.storedMinerals = 1000;
    updated.totalEnergy = 5000;
    for (let i = 0; i < 30; i++) world.step(0.1, new Set([plant.id]), 200 + i);

    const lateral = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: radicle.id,
        direction: { x: 0.2, y: -1, z: 0 },
        nodeType: 'lateral_root',
        tick: 3,
      },
      300,
    );
    assert.equal(lateral.success, true, lateral.reason ?? 'lateral root');
    const bud = lateral.newNode;
    assert(bud);
    assert.equal(bud.attachFraction, 0.6);
    const budAttach = {
      x: bud.parentAttachX ?? bud.x,
      y: bud.parentAttachY ?? bud.y,
      z: bud.parentAttachZ ?? bud.z,
    };

    // The bud leaves the radicle at the configured fraction of its segment, not
    // at its tip, and its own step still has its own length.
    const radicleStart = {
      x: radicle.parentAttachX ?? radicle.x,
      y: radicle.parentAttachY ?? radicle.y,
      z: radicle.parentAttachZ ?? radicle.z,
    };
    const expected = {
      x: radicleStart.x + (radicle.x - radicleStart.x) * 0.6,
      y: radicleStart.y + (radicle.y - radicleStart.y) * 0.6,
      z: radicleStart.z + (radicle.z - radicleStart.z) * 0.6,
    };
    assert.ok(Math.abs(budAttach.x - expected.x) < 1e-9);
    assert.ok(Math.abs(budAttach.y - expected.y) < 1e-9);
    assert.ok(Math.abs(budAttach.z - expected.z) < 1e-9);
    const step = Math.hypot(bud.x - budAttach.x, bud.y - budAttach.y, bud.z - budAttach.z);
    assert.ok(Math.abs(step - 0.5) < 1e-9, `expected one 0.5 m lateral step, got ${step}`);

    // Neither stepping nor a reload moves the bud back onto the radicle tip.
    const budAttachY = budAttach.y;
    for (let i = 0; i < 40; i++) world.step(0.1, new Set([plant.id]), 400 + i);
    assert.equal(bud.parentAttachY, budAttachY);
    const loaded = makeTestPlantWorld();
    loaded.loadPlant(updated);
    const restored = loaded.getPlant(plant.id)?.nodes.get(bud.id);
    assert(restored);
    assert.equal(restored.attachFraction, 0.6);
    assert.ok(Math.abs((restored.parentAttachY ?? 0) - budAttachY) < 1e-9);
  });

  it('grows the lateral where the intent asked, not at the configured fraction', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = Array.from(plant.nodes.keys())[0];
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));

    const germinated = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert(germinated.success, germinated.reason ?? 'germination');
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);

    const updated = world.getPlant(plant.id);
    assert(updated);
    const radicle = Array.from(updated.nodes.values()).find((node) => node.type === 'radicle');
    assert(radicle);
    updated.storedWater = 1000;
    updated.storedMinerals = 1000;
    updated.totalEnergy = 5000;
    for (let i = 0; i < 30; i++) world.step(0.1, new Set([plant.id]), 200 + i);

    // The client sends where the gizmo drew the bud; the server must place the
    // node there rather than at the configured 0.6 (G01).
    const lateral = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: radicle.id,
        direction: { x: 0.2, y: -1, z: 0 },
        nodeType: 'lateral_root',
        tick: 3,
        attachFraction: 0.25,
      },
      300,
    );
    assert.equal(lateral.success, true, lateral.reason ?? 'lateral root');
    const bud = lateral.newNode;
    assert(bud);
    assert.equal(bud.attachFraction, 0.25);
    const start = {
      x: radicle.parentAttachX ?? radicle.x,
      y: radicle.parentAttachY ?? radicle.y,
      z: radicle.parentAttachZ ?? radicle.z,
    };
    assert.ok(Math.abs((bud.parentAttachX ?? 0) - (start.x + (radicle.x - start.x) * 0.25)) < 1e-9);
    assert.ok(Math.abs((bud.parentAttachY ?? 0) - (start.y + (radicle.y - start.y) * 0.25)) < 1e-9);
    assert.ok(Math.abs((bud.parentAttachZ ?? 0) - (start.z + (radicle.z - start.z) * 0.25)) < 1e-9);
  });

  /**
   * A world whose dormant tier integrates once per second of banked time, so a
   * dormant plant can be exercised in a handful of steps instead of 30 s worth.
   */
  function makeDormantTestWorld() {
    return new PlantWorld(
      makeTestGrowthConfig(),
      { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000, minY: -100, maxY: 100 },
      { activeTickRateHz: 20, nearTickRateHz: 5, dormantStepIntervalSec: 1 },
      makeTestResourcesConfig(),
    );
  }

  it('finishes in-flight growth while dormant, and starts nothing new', () => {
    const world = makeDormantTestWorld();
    const plant = world.createPlant('player_dormant', 'world_0', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    const seed = seedId ? plant.nodes.get(seedId) : undefined;
    assert(seed);

    // A part half-way through a 10 s growth, with 5 s left to run.
    seed.growthProgress = 0.5;
    seed.growthTimeRemaining = 5;
    seed.growthTimeSeconds = 10;
    plant.storedWater = 1000;
    plant.storedMinerals = 1000;
    plant.totalEnergy = 500;
    plant.lastTick = 1;
    const nodeCountBefore = plant.nodes.size;

    // Nobody online and no other plant nearby, so this plant is dormant.
    for (let i = 0; i < 60; i++) world.step(0.1, new Set(), 100 + i);

    const after = world.getPlant(plant.id);
    assert(after);
    assert.equal((after as { tier?: string }).tier, 'dormant', 'plant should be dormant');
    const grown = after.nodes.get(seedId);
    assert(grown);
    assert.ok(
      grown.growthProgress > 0.5,
      `dormant catch-up must advance committed growth, got ${grown.growthProgress}`,
    );
    assert.equal(after.nodes.size, nodeCountBefore, 'dormant processing must not create nodes');
  });

  it('feeds dormant plants with photosynthesis over the span they skipped', () => {
    const world = makeDormantTestWorld();
    const plant = world.createPlant('player_dormant', 'world_0', 0, 0);
    plant.totalEnergy = 0;
    plant.lastTick = 1;

    let calls = 0;
    let seconds = 0;
    world.setPhotosynthesis((_plant, span) => {
      calls += 1;
      seconds += span;
    });

    for (let i = 0; i < 40; i++) world.step(0.1, new Set(), 20 + i);

    assert.ok(calls > 0, 'a dormant plant must photosynthesise while nobody is watching');
    assert.ok(
      seconds >= 0.5,
      `the hook must receive the elapsed span, not one tick; got ${seconds}s over ${calls} calls`,
    );
  });

  it('pays dormant upkeep from the sunlight of the same span', () => {
    const world = makeDormantTestWorld();
    const plant = world.createPlant('player_dormant', 'world_0', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    const seed = seedId ? plant.nodes.get(seedId) : undefined;
    assert(seed);
    // Tissue, not a lone coat: upkeep applies from here on.
    seed.isSeed = false;
    plant.totalEnergy = 0;
    plant.lastTick = 1;
    const biomassBefore = plant.totalBiomass;

    // The span fixes more carbon than its upkeep costs, but a plant at zero
    // energy can only use that carbon if income is applied before expense.
    world.setPhotosynthesis((target) => {
      target.totalEnergy += target.totalBiomass * 0.02 * 50;
    });

    for (let i = 0; i < 60; i++) world.step(0.1, new Set(), 1000 + i);

    const after = world.getPlant(plant.id);
    assert(after, 'a dormant plant must not starve while the sun is paying for it');
    assert.equal(
      after.totalBiomass,
      biomassBefore,
      'upkeep must be paid from fixed carbon, not from structure',
    );
    assert.ok(after.totalEnergy > 0, 'the span must leave a surplus, not a deficit');
  });

  it('never photosynthesises an active plant through the hook', () => {
    const world = makeDormantTestWorld();
    const plant = world.createPlant('player_active', 'world_0', 0, 0);
    let calls = 0;
    world.setPhotosynthesis(() => {
      calls += 1;
    });

    for (let i = 0; i < 20; i++) world.step(0.1, new Set([plant.id]), 20 + i);

    const after = world.getPlant(plant.id);
    assert(after);
    assert.equal((after as { tier?: string }).tier, 'active');
    assert.equal(
      calls,
      0,
      'active plants are credited by the online loop; the hook would double-credit them',
    );
  });

  it('re-anchors a stale future lastTick instead of exempting the plant', () => {
    const world = makeDormantTestWorld();
    const plant = world.createPlant('player_stale', 'world_0', 0, 0);
    // A save restored from a longer-running process can carry a tick ahead of a
    // freshly started counter.
    plant.lastTick = 10_000;

    for (let i = 0; i < 30; i++) world.step(0.1, new Set(), 10 + i);

    const after = world.getPlant(plant.id);
    assert(after);
    assert.notEqual(after.lastTick, 10_000, 'the stale mark must not survive');
    assert.ok(
      (after.lastTick ?? Number.POSITIVE_INFINITY) <= 39,
      `the mark should track the current tick, got ${after.lastTick}`,
    );
  });

  it('rebuilds structural biomass from surviving nodes after a dormant resume', () => {
    const world = makeDormantTestWorld();
    const plant = world.createPlant('player_zeroed', 'world_0', 0, 0);
    const nodeMass = [...plant.nodes.values()].reduce(
      (sum, node) => sum + Math.max(0, node.biomass),
      0,
    );
    const nodeUpkeep = [...plant.nodes.values()].reduce(
      (sum, node) => sum + node.upkeepBiomassPerSecond,
      0,
    );
    assert.ok(nodeMass > 0, 'the seed itself is living tissue');
    // This is the saved state that produced a live plant with a 0 biomass HUD
    // and zero upkeep: the nodes survived, the separate accumulator did not.
    plant.totalBiomass = 0;
    plant.totalUpkeep = 0;
    plant.lastTick = 1;

    for (let i = 0; i < 5; i++) world.step(1, new Set(), 10 + i);

    const after = world.getPlant(plant.id);
    assert(after, 'a plant with surviving nodes must not vanish');
    assert.ok(after.totalBiomass > 0, 'biomass must be recovered from the nodes');
    assert.equal(
      after.totalUpkeep,
      nodeUpkeep,
      'upkeep must be derived from the surviving structure',
    );
  });

  it('adds exactly the quoted structural mass, not the whole carbon budget', () => {
    const yieldFraction = 0.5;
    const world = makeTestPlantWorld({
      growth_biomass_yield: { type: 'number', value: yieldFraction, range: [0.2, 1.0] },
    });
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    assert(seedId);
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    plant.totalEnergy = 5000;
    plant.storedWater = 5000;
    plant.storedMinerals = 5000;

    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );

    for (let i = 0; i < 400; i++) world.step(0.05, new Set([plant.id]), 2 + i);

    const grown = [...plant.nodes.values()].find((node) => node.type === 'radicle');
    assert(grown, 'the radicle should have finished');
    const budget = world.getConfig().radicleNode.biomass_cost;
    const quoted = budget * yieldFraction;
    assert.ok(
      Math.abs(grown.biomass - quoted) < 0.01,
      `part stored ${grown.biomass.toFixed(3)} biomass for a ${quoted.toFixed(3)} quote`,
    );
    assert.ok(
      grown.biomass < budget,
      'a part may not store the entire carbon budget it respired to build',
    );
  });

  it('spends stored water and minerals on upkeep and wilts when they run out', () => {
    const world = makeTestPlantWorld({
      upkeep_water_per_biomass_per_s: { type: 'number', value: 0.05, range: [0, 0.05] },
      upkeep_mineral_per_biomass_per_s: { type: 'number', value: 0.02, range: [0, 0.05] },
      water_deficit_biomass_loss: { type: 'number', value: 1, range: [0, 2] },
      mineral_deficit_biomass_loss: { type: 'number', value: 1, range: [0, 2] },
    });
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    assert(seedId);
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    plant.totalEnergy = 5000;
    plant.storedWater = 5000;
    plant.storedMinerals = 5000;
    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );
    for (let i = 0; i < 400; i++) world.step(0.05, new Set([plant.id]), 2 + i);

    // Tissue exists now, so the lone-seed exemption no longer applies.
    plant.storedWater = 10;
    plant.storedMinerals = 4;
    plant.totalEnergy = 10_000;
    for (let i = 0; i < 100; i++) world.step(0.05, new Set([plant.id]), 500 + i);

    const after = world.getPlant(plant.id);
    assert(after, 'the plant should still exist');
    assert.ok(
      after.storedWater < 10,
      `upkeep must actually consume stored water, still ${after.storedWater.toFixed(3)}`,
    );
    assert.ok(
      after.storedMinerals < 4,
      `upkeep must actually consume stored minerals, still ${after.storedMinerals.toFixed(3)}`,
    );

    // With nothing left to spend, the shortfall has to cost structure.
    after.storedWater = 0;
    after.storedMinerals = 0;
    after.totalEnergy = 10_000;
    const starved = after.totalBiomass;
    for (let i = 0; i < 60; i++) world.step(0.05, new Set([after.id]), 900 + i);
    const wilted = world.getPlant(after.id);
    assert(wilted, 'the plant should survive a short wilt');
    assert.ok(
      wilted.totalBiomass < starved,
      `wilting should cost structure, ${starved.toFixed(2)} -> ${wilted.totalBiomass.toFixed(2)}`,
    );
  });
});

/** T04: a mutation definition with only what the growth path reads. */
function mutationDefinition(
  id: string,
  effects: MutationDefinition['effects'],
): MutationDefinition {
  return {
    id,
    name: id,
    kind: 'stat',
    geneTags: [],
    visualSignature: 1,
    visualParams: [0, 0, 0],
    visualTarget: 'whole',
    visualStyle: {
      id,
      ordinal: 1,
      target: 'whole',
      pattern: 'none',
      patternScale: 1,
      tint: [1, 1, 1],
      tintStrength: 0,
      variegation: 0,
      variegationColor: [1, 1, 1],
      glow: 0,
      glowColor: [0.2, 0.75, 0.45],
      barkThickness: 1,
      barkDarken: 0,
      spines: 0,
    },
    triggers: { growthChanceWeight: 1 },
    maintenance: { energyPerSecond: 0, biomassPerSecond: 0 },
    effects,
    movement: { rerootSpeed: 1, translocate: false, parts: [], drift: 0 },
    shed: { cooldownS: 10, biomassPenaltyFraction: 0 },
  };
}

describe('T04 mutation effects on growth', () => {
  /** Germinate a radicle, two cotyledons and a stem; returns the stem node. */
  function growToStem(world: ReturnType<typeof makeTestPlantWorld>) {
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];

    let result = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert(result.success, result.reason ?? 'radicle');
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);

    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([plant.id]), 200 + c * 40 + i);
      result = world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: c === 0 ? 0.3 : -0.3, y: 1, z: 0 },
          nodeType: 'cotyledon',
          tick: 250 + c,
        },
        250 + c * 20,
      );
      assert(result.success, result.reason ?? `cotyledon ${c + 1}`);
      for (let i = 0; i < 80; i++) world.step(0.1, new Set([plant.id]), 260 + c * 100 + i);
    }

    const grown = world.getPlant(plant.id);
    assert(grown);
    grown.storedWater = 5000;
    grown.storedMinerals = 5000;
    grown.totalEnergy = 5000;
    for (let i = 0; i < 30; i++) world.step(0.1, new Set([plant.id]), 500 + i);

    result = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: 1, z: 0 },
        nodeType: 'stem',
        tick: 2,
      },
      560,
    );
    assert(result.success, result.reason ?? 'stem');
    assert(result.newNode);
    return { plantId: plant.id, stemId: result.newNode.id, stem: result.newNode };
  }

  it('divides growth time, scales the segment and unlocks a refused node type', () => {
    const world = makeTestPlantWorld();
    world.setMutations({
      chancePerGrowth: 0,
      adaptivePressureEnabled: false,
      decayHalfLifeTicks: 1000,
      maxPressureMultiplier: 1,
      defaultShedCooldownS: 10,
      maintenanceScale: 1,
      upkeepNodeScale: 0,
      upkeepBiomassScale: 0,
      upkeepMaxMultiplier: 10,
      upkeepBiomassFloor: 8,
      oversizeWiltPerS: 0.02,
      levelUp: {
        maxLevel: 3,
        cardsPerOffer: 3,
        baseEnergyCost: 10,
        energyCostPerLevel: 10,
        energyCostPerBiomass: 1,
        energyCostPerBiomassPerLevel: 1,
        baseBiomassFraction: 0.05,
        biomassFractionPerLevel: 0.05,
        minBiomassCost: 1,
        maxEnergyShareOfCapacity: 0.8,
        upkeepPerLevel: 0.15,
        cardSteps: { sizeMultiplier: 1.15, energyUpkeepMultiplier: 0.92 },
        cardLabels: { sizeMultiplier: 'Larger form', energyUpkeepMultiplier: 'Leaner upkeep' },
      },
      definitions: [
        mutationDefinition('quick', { growthSpeedMultiplier: 2 }),
        mutationDefinition('bulky', { sizeMultiplier: 2 }),
        mutationDefinition('bloom', { unlockNodeTypes: ['flower'] }),
      ],
      categoryForNodeType: {},
      categoryToTags: {},
    } satisfies MutationsConfig);

    const { plantId, stemId, stem } = growToStem(world);
    for (const id of ['quick', 'bulky', 'bloom']) {
      const granted = world.grantMutation(plantId, id, 561);
      assert(granted.ok, `grant ${id}: ${granted.reason ?? ''}`);
    }

    const plant = world.getPlant(plantId);
    assert(plant);
    plant.totalEnergy = 5000;
    plant.storedWater = 5000;
    plant.storedMinerals = 5000;
    for (let i = 0; i < 300; i++) world.step(0.1, new Set([plantId]), 600 + i);

    const leaf = world.tryGrow(
      {
        plantId,
        nodeId: stemId,
        direction: { x: 0.4, y: 0.6, z: 0 },
        nodeType: 'leaf',
        tick: 3,
      },
      700,
    );
    assert(leaf.success, `leaf: ${leaf.reason}`);
    assert(leaf.newNode);

    const mutatedStep = Math.hypot(
      leaf.newNode.x - stem.x,
      leaf.newNode.y - stem.y,
      leaf.newNode.z - stem.z,
    );

    // A flower is refused on a leaf by the base rules; the unlock admits it.
    for (let i = 0; i < 300; i++) world.step(0.1, new Set([plantId]), 700 + i);
    const flower = world.tryGrow(
      {
        plantId,
        nodeId: leaf.newNode.id,
        direction: { x: 0, y: 0.4, z: 0.6 },
        nodeType: 'flower',
        tick: 4,
      },
      1400,
    );
    assert(flower.success, `flower: ${flower.reason}`);

    // Drop the mutations and grow the same leaf again: the unmutated growth is
    // the baseline for both the time and the segment length.
    world.clearMutations(plantId, 702);
    const refreshed = world.getPlant(plantId);
    assert(refreshed);
    refreshed.totalEnergy = 5000;
    refreshed.storedWater = 5000;
    refreshed.storedMinerals = 5000;
    for (let i = 0; i < 300; i++) world.step(0.1, new Set([plantId]), 900 + i);
    const plain = world.tryGrow(
      {
        plantId,
        nodeId: stemId,
        direction: { x: -0.4, y: 0.6, z: 0 },
        nodeType: 'leaf',
        tick: 5,
      },
      1600,
    );
    assert(plain.success, `plain: ${plain.reason}`);
    assert(plain.newNode);
    assert.ok(
      Math.abs((plain.newNode.growthTimeSeconds ?? 0) - (leaf.newNode.growthTimeSeconds ?? 0) * 2) <
        1e-6,
      'growth speed 2 halves the quoted growth time',
    );
    const plainStep = Math.hypot(
      plain.newNode.x - stem.x,
      plain.newNode.y - stem.y,
      plain.newNode.z - stem.z,
    );
    assert.ok(
      Math.abs(plainStep * 2 - mutatedStep) < 1e-6,
      `size multiplier 2 doubles the segment (${mutatedStep} vs ${plainStep})`,
    );
  });

  it('holds an unpaid mutation bill at the floor instead of shedding or killing', () => {
    const world = makeTestPlantWorld();
    world.setMutations({
      chancePerGrowth: 0,
      adaptivePressureEnabled: false,
      decayHalfLifeTicks: 1000,
      maxPressureMultiplier: 1,
      defaultShedCooldownS: 10,
      maintenanceScale: 1,
      upkeepNodeScale: 0,
      upkeepBiomassScale: 0,
      upkeepMaxMultiplier: 10,
      upkeepBiomassFloor: 8,
      oversizeWiltPerS: 0.02,
      levelUp: {
        maxLevel: 3,
        cardsPerOffer: 3,
        baseEnergyCost: 10,
        energyCostPerLevel: 10,
        energyCostPerBiomass: 1,
        energyCostPerBiomassPerLevel: 1,
        baseBiomassFraction: 0.05,
        biomassFractionPerLevel: 0.05,
        minBiomassCost: 1,
        maxEnergyShareOfCapacity: 0.8,
        upkeepPerLevel: 0.15,
        cardSteps: { sizeMultiplier: 1.15, energyUpkeepMultiplier: 0.92 },
        cardLabels: { sizeMultiplier: 'Larger form', energyUpkeepMultiplier: 'Leaner upkeep' },
      },
      definitions: [
        {
          ...mutationDefinition('gluttonous', {}),
          maintenance: { energyPerSecond: 0.05, biomassPerSecond: 5 },
        },
      ],
      categoryForNodeType: {},
      categoryToTags: {},
    });

    const { plantId } = growToStem(world);
    const granted = world.grantMutation(plantId, 'gluttonous', 900);
    assert(granted.ok, `grant: ${granted.reason ?? ''}`);

    const plant = world.getPlant(plantId);
    assert(plant);
    plant.totalEnergy = 5000;
    plant.storedWater = 5000;
    plant.storedMinerals = 5000;
    plant.totalBiomass = 12;
    for (let i = 0; i < 200; i++) world.step(0.1, new Set([plantId]), 1000 + i);

    const after = world.getPlant(plantId);
    assert(after, 'a bill larger than the plant must not kill it');
    assert.deepEqual(
      after.mutations?.map((mutation) => mutation.id),
      ['gluttonous'],
      'unpaid upkeep must never shed a mutation on its own',
    );
    assert.ok(
      Math.abs(after.totalBiomass - 8) < 1e-9,
      `biomass stops at the floor (${after.totalBiomass})`,
    );
  });

  it("keeps a shed size mutation's tissue and wilts it back gradually", () => {
    const world = makeTestPlantWorld();
    world.setMutations({
      chancePerGrowth: 0,
      adaptivePressureEnabled: false,
      decayHalfLifeTicks: 1000,
      maxPressureMultiplier: 1,
      defaultShedCooldownS: 0,
      maintenanceScale: 1,
      upkeepNodeScale: 0,
      upkeepBiomassScale: 0,
      upkeepMaxMultiplier: 10,
      upkeepBiomassFloor: 8,
      oversizeWiltPerS: 0.02,
      levelUp: {
        maxLevel: 3,
        cardsPerOffer: 3,
        baseEnergyCost: 10,
        energyCostPerLevel: 10,
        energyCostPerBiomass: 1,
        energyCostPerBiomassPerLevel: 1,
        baseBiomassFraction: 0.05,
        biomassFractionPerLevel: 0.05,
        minBiomassCost: 1,
        maxEnergyShareOfCapacity: 0.8,
        upkeepPerLevel: 0.15,
        cardSteps: { sizeMultiplier: 1.15, energyUpkeepMultiplier: 0.92 },
        cardLabels: { sizeMultiplier: 'Larger form', energyUpkeepMultiplier: 'Leaner upkeep' },
      },
      definitions: [mutationDefinition('bulky', { sizeMultiplier: 1.25 })],
      categoryForNodeType: {},
      categoryToTags: {},
    });

    const { plantId, stemId } = growToStem(world);
    const plant = world.getPlant(plantId);
    assert(plant);
    // Let the last part finish filling in: only completed tissue has a quota.
    for (let i = 0; i < 100; i++) world.step(0.1, new Set([plantId]), 700 + i);
    const stem = plant.nodes.get(stemId);
    assert(stem);
    // Quota for a stem is `biomass_cost × growth_biomass_yield`; a 1.25× form
    // holds 1.25³ of it. The test config's yield is read rather than assumed.
    const baseMass = stem.biomass;
    assert.ok(baseMass > 1, `unmutated stem mass (${baseMass})`);

    const granted = world.grantMutation(plantId, 'bulky', 900);
    assert(granted.ok, `grant: ${granted.reason ?? ''}`);
    const grown = plant.nodes.get(stemId);
    assert(grown);
    const bigMass = grown.biomass;
    const bigRadius = grown.radius ?? 0;
    assert.ok(
      Math.abs(bigMass - baseMass * 1.25 ** 3) < 1e-6,
      `a size mutation is real tissue (${bigMass})`,
    );
    assert.ok(bigRadius > 0, 'the part is drawn');

    // Shedding must not shrink the body on the spot.
    const shedTick = 1000;
    const shed = world.shedMutation(plantId, 'bulky', shedTick);
    assert(shed.ok, `shed: ${shed.reason ?? ''}`);
    const justShed = plant.nodes.get(stemId);
    assert(justShed);
    assert.ok(
      Math.abs(justShed.biomass - bigMass) < 1e-6,
      `mass is kept at the shed (${justShed.biomass} vs ${bigMass})`,
    );
    assert.equal(justShed.radius, bigRadius, 'the drawn size is kept at the shed');

    // Feed it so only the oversize drain moves the mass, then let it wilt.
    plant.totalEnergy = 5000;
    plant.storedWater = 5000;
    plant.storedMinerals = 5000;
    world.step(0.1, new Set([plantId]), shedTick + 1);
    const shrunkCapacity = world.getPlantCapacity(plantId);
    assert(shrunkCapacity);
    assert.ok(
      plant.totalEnergy <= shrunkCapacity.energy + 1e-9,
      `energy is clamped as the body shrinks (${plant.totalEnergy} > ${shrunkCapacity.energy})`,
    );
    assert.ok(
      plant.storedWater <= shrunkCapacity.water + 1e-9,
      `water is clamped as the body shrinks (${plant.storedWater} > ${shrunkCapacity.water})`,
    );
    assert.ok(
      plant.storedMinerals <= shrunkCapacity.minerals + 1e-9,
      `minerals are clamped as the body shrinks (${plant.storedMinerals} > ${shrunkCapacity.minerals})`,
    );
    for (let i = 1; i < 100; i++) world.step(0.1, new Set([plantId]), shedTick + 1 + i);
    const midway = plant.nodes.get(stemId);
    assert(midway);
    assert.ok(midway.biomass < bigMass, 'the excess tissue starts draining');
    assert.ok(midway.biomass > baseMass, 'it is still bigger than its regular size');
    assert.ok((midway.radius ?? 0) < bigRadius, 'the part visibly thins as it drains');

    // Long enough for the exponential drain to finish: back to regular size.
    for (let i = 0; i < 4000; i++) world.step(0.1, new Set([plantId]), shedTick + 101 + i);
    const settled = plant.nodes.get(stemId);
    assert(settled);
    assert.ok(
      Math.abs(settled.biomass - baseMass) < baseMass * 0.01,
      `tissue returns to the regular size (${settled.biomass} vs ${baseMass})`,
    );
  });
  it('levels a size mutation on the card the player picks, and grows the body', () => {
    const world = makeTestPlantWorld();
    world.setMutations({
      chancePerGrowth: 0,
      adaptivePressureEnabled: false,
      decayHalfLifeTicks: 1000,
      maxPressureMultiplier: 1,
      defaultShedCooldownS: 0,
      maintenanceScale: 1,
      upkeepNodeScale: 0,
      upkeepBiomassScale: 0,
      upkeepMaxMultiplier: 10,
      upkeepBiomassFloor: 8,
      oversizeWiltPerS: 0.02,
      levelUp: {
        maxLevel: 2,
        cardsPerOffer: 3,
        baseEnergyCost: 10,
        energyCostPerLevel: 10,
        energyCostPerBiomass: 1,
        energyCostPerBiomassPerLevel: 1,
        baseBiomassFraction: 0.05,
        biomassFractionPerLevel: 0.05,
        minBiomassCost: 1,
        maxEnergyShareOfCapacity: 0.8,
        upkeepPerLevel: 0.15,
        cardSteps: { sizeMultiplier: 1.15, energyUpkeepMultiplier: 0.92 },
        cardLabels: { sizeMultiplier: 'Larger form', energyUpkeepMultiplier: 'Leaner upkeep' },
      },
      definitions: [mutationDefinition('bulky', { sizeMultiplier: 1.25 })],
      categoryForNodeType: {},
      categoryToTags: {},
    });

    const { plantId, stemId } = growToStem(world);
    const plant = world.getPlant(plantId);
    assert(plant);
    for (let i = 0; i < 100; i++) world.step(0.1, new Set([plantId]), 700 + i);
    const granted = world.grantMutation(plantId, 'bulky', 800);
    assert(granted.ok, `grant: ${granted.reason ?? ''}`);

    const stem = plant.nodes.get(stemId);
    assert(stem);
    const firstLevelMass = stem.biomass;
    plant.totalEnergy = 500;

    const deal = world.offerMutationLevel(plantId, 'bulky');
    assert(deal.ok, `deal: ${deal.reason ?? ''}`);
    assert.equal(deal.level, 1);
    const cards = deal.cards ?? [];
    const sizeCard = cards.find((card) => card.id === 'sizeMultiplier');
    assert.ok(sizeCard, 'the size mutation deals a size card');
    const state = world.getMutationState(plantId, 900);
    assert.equal(state?.levelOffer?.mutationId, 'bulky', 'the deal is visible to the owner');

    // An unoffered card is refused, and nothing is spent.
    const refused = world.chooseMutationLevel(plantId, 'bulky', 'growthSpeedMultiplier', 901);
    assert.equal(refused.ok, false);
    assert.equal(plant.totalEnergy, 500);

    const energyBefore = plant.totalEnergy;
    const levelled = world.chooseMutationLevel(plantId, 'bulky', 'sizeMultiplier', 902);
    assert(levelled.ok, `level: ${levelled.reason ?? ''}`);
    assert.equal(levelled.level, 2);
    assert.equal(plant.totalEnergy, energyBefore - (levelled.cost?.energy ?? 0));
    assert.ok(
      Math.abs((stem.biomass ?? 0) - firstLevelMass * 1.15 ** 3) < 1e-6,
      `the larger form is real tissue (${stem.biomass} vs ${firstLevelMass * 1.15 ** 3})`,
    );

    const after = world.getMutationState(plantId, 903);
    const held = after?.mutations.find((mutation) => mutation.id === 'bulky');
    assert.equal(held?.level, 2);
    assert.equal(held?.maxLevel, 2);
    assert.equal(held?.levelBlocked, 'max_level');
    assert.equal(after?.levelOffer, null, 'the deal closes once it is taken');
  });
});

function plantHealthOf(world: ReturnType<typeof makeTestPlantWorld>, plantId: string): number {
  const plant = world.getPlant(plantId);
  assert(plant);
  return plantHealth(plant, world.getConfig());
}

describe('health baseline and the stored-resource gate', () => {
  /** Germinate a radicle and two cotyledons; leaves the crown as the seed node. */
  function germinateWithCotyledons(world: ReturnType<typeof makeTestPlantWorld>) {
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    const seedId = Array.from(plant.nodes.keys())[0];
    const radicle = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: -1, z: 0 },
        nodeType: 'radicle',
        tick: 1,
      },
      1,
    );
    assert(radicle.success, radicle.reason ?? 'radicle');
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([plant.id]), 200 + c * 40 + i);
      const cotyledon = world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: c === 0 ? 0.3 : -0.3, y: 1, z: 0 },
          nodeType: 'cotyledon',
          tick: 300 + c * 100,
        },
        400 + c * 100,
      );
      assert(cotyledon.success, cotyledon.reason ?? 'cotyledon');
    }
    return { plant, seedId };
  }

  it('grows a stem immediately after the second cotyledon', () => {
    const world = makeTestPlantWorld();
    const { plant, seedId } = germinateWithCotyledons(world);
    const current = world.getPlant(plant.id);
    assert(current);
    current.storedWater = 1000;
    current.storedMinerals = 1000;
    current.totalEnergy = 5000;

    // The browser run on 2026-11-14 refused this exact intent; a fresh part
    // with no mass yet used to read zero health, and before that the fix the
    // refusal looked like a storage problem.
    const stem = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: seedId,
        direction: { x: 0, y: 1, z: 0 },
        nodeType: 'stem',
        tick: 2,
      },
      900,
    );
    assert.equal(stem.success, true, stem.reason ?? 'stem should grow');
  });

  it('drains the stores when biomass is inflated past what the plant holds', () => {
    const world = makeTestPlantWorld({
      upkeep_water_per_biomass_per_s: { type: 'number', value: 0.005, range: [0, 1] },
      water_deficit_biomass_loss: { type: 'number', value: 0.5, range: [0, 1] },
    });
    const plant = world.createPlant('player_1', 'world_0', 0, 0);
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    const seedId = Array.from(plant.nodes.keys())[0];
    // A lone seed is exempt from upkeep; germinating gives it tissue to respire.
    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );
    // `dev_fill_biomass` sets this figure; per-biomass upkeep then scales with it.
    plant.totalBiomass = 200_000;
    plant.storedWater = 46;
    plant.totalEnergy = 5_000_000;

    world.step(0.1, new Set([plant.id]), 2);
    assert.ok(
      plant.storedWater < 12,
      `a 200k-biomass plant drains its stores in one tick (left ${plant.storedWater})`,
    );

    // That is why the browser stem intent came back insufficient_stored_resources:
    // the gate it failed was the water it had just been given.
    const gate = canGrow(plant, world.getConfig());
    assert.equal(gate.ok, false);
    assert.match(gate.reason ?? '', /stored water/);
  });

  it('lowers health when drought sheds tissue and repairs it once fed', () => {
    const world = makeTestPlantWorld({
      upkeep_water_per_biomass_per_s: { type: 'number', value: 0.02, range: [0, 1] },
      water_deficit_biomass_loss: { type: 'number', value: 1, range: [0, 1] },
      tissue_repair_per_second: { type: 'number', value: 1, range: [0, 10] },
      tissue_repair_energy_per_biomass: { type: 'number', value: 1, range: [1, 100] },
    });
    const { plant } = germinateWithCotyledons(world);
    const current = world.getPlant(plant.id);
    assert(current);
    current.storedWater = 0;
    current.storedMinerals = 0;
    for (let i = 0; i < 200; i++) world.step(0.1, new Set([plant.id]), 600 + i);
    const damaged = plantHealthOf(world, plant.id);
    assert.ok(damaged < 1, `a drought should damage tissue (health ${damaged})`);

    current.storedWater = 5000;
    current.storedMinerals = 5000;
    current.totalEnergy = 5000;
    for (let i = 0; i < 200; i++) world.step(0.1, new Set([plant.id]), 900 + i);
    const repaired = plantHealthOf(world, plant.id);
    assert.ok(repaired > damaged, `repair should raise health (${damaged} -> ${repaired})`);
  });
});

describe('root runner growth', () => {
  it('lets a rhizome throw a stolon, but keeps other canopy off buried roots', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('runner', 'world_0', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    plant.totalEnergy = 1e6;
    plant.storedWater = 1e6;
    plant.storedMinerals = 1e6;
    plant.growthCooldownUntil = 0;
    // A rhizome, placed directly: the gallery and the clonal unlock are the only
    // things that produce one, and this test is about what may grow from it.
    const rhizome = {
      id: `${seedId}.rhizome0`,
      plantId: plant.id,
      type: 'rhizome' as const,
      layer: 'root' as const,
      x: 1,
      y: -0.2,
      z: 0,
      biomass: 4,
      age: 1,
      parentId: seedId,
      children: [],
      statModifiers: {},
      resourceDrawWater: 0,
      resourceDrawNutrients: 0,
      resourceDrawMinerals: 0,
      upkeepBiomassPerSecond: 0,
      growthProgress: 1,
      isSeed: false,
      lastGrowthTick: 0,
    };
    plant.nodes.set(rhizome.id, rhizome as never);
    plant.nodes.get(seedId)?.children.push(rhizome.id);
    world.fillPlantTissue(plant.id);

    plant.growthCooldownUntil = 0;
    const stolon = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: rhizome.id,
        direction: { x: 1, y: -0.1, z: 0 },
        nodeType: 'stolon',
        tick: 10,
      },
      10,
    );
    assert.equal(stolon.success, true, `a runner must be growable: ${stolon.reason ?? ''}`);

    // A leaf or a stem still cannot sprout from a buried root.
    plant.growthCooldownUntil = 0;
    const leaf = world.tryGrow(
      {
        plantId: plant.id,
        nodeId: rhizome.id,
        direction: { x: 0.8, y: 0.5, z: 0 },
        nodeType: 'leaf',
        tick: 20,
      },
      20,
    );
    assert.equal(leaf.success, false);
    assert.equal(leaf.reason, 'canopy_from_crown_only');
  });
});

describe('mutation gallery', () => {
  it('builds one spaced plant per mutation, each expressing its own mutation', () => {
    const world = makeTestPlantWorld();
    world.setMutations({
      chancePerGrowth: 0,
      adaptivePressureEnabled: false,
      decayHalfLifeTicks: 1000,
      maxPressureMultiplier: 1,
      defaultShedCooldownS: 10,
      maintenanceScale: 1,
      upkeepNodeScale: 0,
      upkeepBiomassScale: 0,
      upkeepMaxMultiplier: 10,
      upkeepBiomassFloor: 8,
      oversizeWiltPerS: 0.02,
      levelUp: {
        maxLevel: 3,
        cardsPerOffer: 3,
        baseEnergyCost: 10,
        energyCostPerLevel: 10,
        energyCostPerBiomass: 1,
        energyCostPerBiomassPerLevel: 1,
        baseBiomassFraction: 0.05,
        biomassFractionPerLevel: 0.05,
        minBiomassCost: 1,
        maxEnergyShareOfCapacity: 0.8,
        upkeepPerLevel: 0.15,
        cardSteps: { sizeMultiplier: 1.15, energyUpkeepMultiplier: 0.92 },
        cardLabels: { sizeMultiplier: 'Larger form', energyUpkeepMultiplier: 'Leaner upkeep' },
      },
      definitions: [
        mutationDefinition('pale', { sizeMultiplier: 1.1 }),
        mutationDefinition('thorny', { unlockNodeTypes: ['thorn'] }),
        mutationDefinition('glow', { energyUpkeepMultiplier: 0.9 }),
      ],
      categoryForNodeType: {},
      categoryToTags: {},
    });

    const result = world.buildMutationGallery('world_0', 3, 8);
    assert.equal(result.plants, 3);
    assert.equal(result.rows, 1);

    const gallery = world
      .getAllPlants()
      .filter((plant) => plant.ownerId.startsWith('gallery:'))
      .sort((a, b) => a.ownerId.localeCompare(b.ownerId));
    assert.equal(gallery.length, 3);

    const xs: number[] = [];
    for (const plant of gallery) {
      const mutationId = plant.ownerId.replace('gallery:', '');
      assert.equal(plant.mutations?.length, 1, 'exactly one mutation per plant');
      assert.equal(plant.mutations?.[0].id, mutationId);
      // The body is mature: a seedling showed a tint and nothing else, so a
      // bark or spine mutation had no length of stem to be seen on.
      assert.ok(
        plant.nodes.size >= 15,
        `body has ${plant.nodes.size} nodes: ${result.rejected.join(', ')}`,
      );
      const types = new Set(Array.from(plant.nodes.values()).map((node) => node.type));
      for (const organ of ['radicle', 'lateral_root', 'stem', 'leaf', 'branch'] as const) {
        assert.ok(types.has(organ), `a showcase body has a ${organ}`);
      }
      for (const node of plant.nodes.values()) {
        assert.ok((node.mutationFlags ?? 0) > 0, 'every node carries the mutation look');
        // Full growth: a node caught mid-emergence would render half-sized.
        assert.equal(node.growthProgress, 1, `${node.type} is fully grown`);
        assert.ok(node.biomass > 0, `${node.type} carries tissue`);
      }
      const seed = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      if (seed) xs.push(seed.x);
    }
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) {
      assert.ok(xs[i] - xs[i - 1] >= 7.9, `plants are spaced (${xs[i - 1]} -> ${xs[i]})`);
    }

    // The mutation was granted before the body grew, so its size is already in
    // the tissue standing in the row. Each plant now has its own body plan (that
    // is the point of the per-mutation variation), so the comparison is tissue
    // per node: the 1.1x size mutation must carry more mass per part than the
    // plant whose mutation only changes its upkeep.
    const byId = new Map(gallery.map((plant) => [plant.ownerId.replace('gallery:', ''), plant]));
    const big = byId.get('pale');
    const plain = byId.get('glow');
    assert.ok(big && plain);
    const perNode = (plant: { totalBiomass: number; nodes: Map<string, unknown> }): number =>
      plant.totalBiomass / Math.max(1, plant.nodes.size);
    assert.ok(
      perNode(big) > perNode(plain),
      `the size mutation grew the tissue (${perNode(big)} vs ${perNode(plain)} per node)`,
    );

    // Rebuilding replaces the row instead of stacking a second garden on it.
    world.buildMutationGallery('world_0', 3, 8);
    const after = world.getAllPlants().filter((plant) => plant.ownerId.startsWith('gallery:'));
    assert.equal(after.length, 3);
  });
});

describe('PlantWorld tier rates', () => {
  it('runs the active tier at the one simulation rate', () => {
    const world = makeTestPlantWorld();
    assert.equal(world.getTickRateHz(), 20);
    world.setTierRates({ activeTickRateHz: 45 });
    assert.equal(world.getTickRateHz(), 45);
  });
});

describe('tissue loss is reported, growth never is', () => {
  it('a growing, fed plant never queues shed damage', () => {
    const world = makeTestPlantWorld();
    const plant = world.createPlant('p1', 'w1', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    assert.ok(seedId);
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    plant.totalEnergy = 5000;
    plant.storedWater = 5000;
    plant.storedMinerals = 5000;
    assert.ok(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ),
    );
    for (let i = 0; i < 40; i += 1) world.step(0.1, new Set([plant.id]), 10 + i);
    // Growth spends energy and opens a new part; none of that is damage. Roots
    // are not a damage source (ADR-051), so the shed queue must stay empty.
    assert.deepEqual(world.drainShedDamage(), []);
  });

  it('batches a tick of drought loss into one entry and clears it', () => {
    const world = makeTestPlantWorld({
      upkeep_water_per_biomass_per_s: { type: 'number', value: 0.05, range: [0, 0.05] },
      water_deficit_biomass_loss: { type: 'number', value: 1, range: [0, 2] },
    });
    const plant = world.createPlant('p1', 'w1', 0, 0);
    const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
    assert.ok(seedId);
    world.setResourceProvider(() => ({ light: 50, moisture: 50, minerals: 50 }));
    plant.totalEnergy = 5000;
    plant.storedWater = 5000;
    plant.storedMinerals = 5000;
    assert(
      world.tryGrow(
        {
          plantId: plant.id,
          nodeId: seedId,
          direction: { x: 0, y: -1, z: 0 },
          nodeType: 'radicle',
          tick: 1,
        },
        1,
      ).success,
    );
    // Dry the plant out: every part that pays the water bill is now in deficit.
    plant.storedWater = 0;
    for (let i = 0; i < 20; i++) world.step(0.05, new Set([plant.id]), 10 + i);
    const drained = world.drainShedDamage();
    assert.equal(drained.length, 1, 'one entry per plant per tick, not one per part');
    assert.equal(drained[0]?.plantId, plant.id);
    assert.ok((drained[0]?.amount ?? 0) > 0, 'the loss is reported, not swallowed');
    assert.deepEqual(world.drainShedDamage(), [], 'draining clears the batch');
  });
});
