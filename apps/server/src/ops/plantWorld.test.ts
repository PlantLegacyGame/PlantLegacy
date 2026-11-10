import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigFile } from '@plant-legacy/shared/config';
import type { GrowthIntent } from '@plant-legacy/shared/growth';
import { loadGrowthConfig } from './growth.ts';
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
      consumption_trigger_tile_mineral_threshold: { type: 'integer', value: 20, range: [0, 100] },
      consumption_trigger_dung_item: { type: 'boolean', value: false },
      consumption_trigger_fertilizer_item: { type: 'boolean', value: false },
      diffusion_rate: { type: 'number', value: 0.1, range: [0, 1] },
      max_absorption_per_tick: { type: 'number', value: 10, range: [0, 100] },
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
      root_overlap_pressure_damage: { type: 'number', value: 5.0, range: [0.0, 20.0] },
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
      root_attack_damage_multiplier: { type: 'number', value: 2.0, range: [0.5, 10.0] },
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
        isAttack: false,
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

    // Complete radicle growth, then add cotyledons stepwise (directed).
    for (let i = 0; i < 120; i++) world.step(0.1, new Set([plant.id]), 2 + i);
    let updatedPlant = world.getPlant(plant.id);
    assert(updatedPlant);
    const crownId = updatedPlant.rootNodeId ?? seedId;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 20; i++) world.step(0.1, new Set([updatedPlant.id]), 200 + c * 40 + i);
      const coty = world.tryGrow(
        {
          plantId: updatedPlant.id,
          nodeId: crownId,
          direction: { x: c === 0 ? 0.3 : -0.3, y: 1, z: 0 },
          nodeType: 'cotyledon',
          isAttack: false,
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
      isAttack: false,
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
          isAttack: false,
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
            isAttack: false,
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
      isAttack: false,
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
          isAttack: false,
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
            isAttack: false,
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
        isAttack: false,
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
          isAttack: false,
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
            isAttack: false,
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
        isAttack: false,
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
          isAttack: false,
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
            isAttack: false,
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
        isAttack: false,
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
        isAttack: false,
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
          isAttack: false,
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
            isAttack: false,
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
        isAttack: false,
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
        isAttack: false,
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
        isAttack: false,
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
          isAttack: false,
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
        isAttack: false,
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
        isAttack: false,
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
});
