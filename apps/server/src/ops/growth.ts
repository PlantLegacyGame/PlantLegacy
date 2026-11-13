import type { ConfigFile } from '@plant-legacy/shared/config';
import { readBoolean, readInteger, readNumber, readObject } from '@plant-legacy/shared/config';
import {
  type GrowthConfig,
  type NodeRadiusProfile,
  type NodeTypeDefinition,
  setGrowthGeometryTunables,
} from '@plant-legacy/shared/growth';

/**
 * Optional reads, so a config that predates a key keeps the compiled default
 * instead of refusing to boot. Only genuinely optional geometry uses these;
 * gameplay numbers still throw when missing.
 */
function optionalNumber(
  configs: Map<string, ConfigFile>,
  system: string,
  key: string,
): number | undefined {
  const entry = configs.get(system)?.values[key];
  if (!entry || (entry.type !== 'number' && entry.type !== 'integer')) return undefined;
  return entry.value as number;
}

function optionalObject<T>(configs: Map<string, ConfigFile>, system: string, key: string) {
  const entry = configs.get(system)?.values[key];
  if (entry?.type !== 'object') return undefined;
  return entry.value as T;
}

function optionalInteger(
  configs: Map<string, ConfigFile>,
  system: string,
  key: string,
  fallback: number,
): number {
  const value = optionalNumber(configs, system, key);
  return value === undefined ? fallback : Math.round(value);
}

export function loadGrowthConfig(configs: Map<string, ConfigFile>): GrowthConfig {
  // Geometry that the server shares with every renderer: apply it before any
  // node is placed, so placement and drawing cannot disagree.
  setGrowthGeometryTunables({
    seedBodyHeightRatio: optionalNumber(configs, 'growth', 'seed_body_height_ratio'),
    nodeRadiusProfiles: optionalObject<Record<string, NodeRadiusProfile>>(
      configs,
      'growth',
      'node_radius_profiles',
    ),
    branchAttachFraction: optionalNumber(configs, 'growth', 'branch_attach_fraction'),
  });

  return {
    rootGrowthSpeed: readNumber(configs, 'growth', 'root_growth_speed'),
    canopyGrowthSpeed: readNumber(configs, 'growth', 'canopy_growth_speed'),
    nodeCostBase: readInteger(configs, 'growth', 'node_cost_base'),
    maxNodesPerPlant: readInteger(configs, 'growth', 'max_nodes_per_plant'),
    growthCooldown: readNumber(configs, 'growth', 'growth_cooldown'),
    lightBlockingPerNode: readInteger(configs, 'growth', 'light_blocking_per_node'),
    seedNode: readObject<NodeTypeDefinition>(configs, 'growth', 'seed_node'),
    radicleNode: readObject<NodeTypeDefinition>(configs, 'growth', 'radicle_node'),
    rootNode: readObject<NodeTypeDefinition>(configs, 'growth', 'root_node'),
    lateralRootNode: readObject<NodeTypeDefinition>(configs, 'growth', 'lateral_root_node'),
    stemNode: readObject<NodeTypeDefinition>(configs, 'growth', 'stem_node'),
    branchNode: readObject<NodeTypeDefinition>(configs, 'growth', 'branch_node'),
    leafNode: readObject<NodeTypeDefinition>(configs, 'growth', 'leaf_node'),
    cotyledonNode: readObject<NodeTypeDefinition>(configs, 'growth', 'cotyledon_node'),
    flowerNode: readObject<NodeTypeDefinition>(configs, 'growth', 'flower_node'),
    sporeSacNode: readObject<NodeTypeDefinition>(configs, 'growth', 'spore_sac_node'),
    vineNode: readObject<NodeTypeDefinition>(configs, 'growth', 'vine_node'),
    growthIntentCooldown: readNumber(configs, 'growth', 'growth_intent_cooldown'),
    germinationMinMoisture: readNumber(configs, 'growth', 'germination_min_moisture'),
    germinationMinLight: readNumber(configs, 'growth', 'germination_min_light'),
    germinationFailureKillsSeed: readBoolean(configs, 'growth', 'germination_failure_kills_seed'),
    // Optional so a config that predates these keys still boots; the values
    // themselves live in growth.json.
    maxCotyledons: optionalInteger(configs, 'growth', 'max_cotyledons', 2),
    cotyledonShedLeafCount: optionalInteger(configs, 'growth', 'cotyledon_shed_leaf_count', 4),
    defaultGrowthTimeSeconds: optionalNumber(configs, 'growth', 'default_growth_time_s') ?? 5,
    // ADR-019: Energy system
    photosynthesisEnergyPerSecond: readNumber(
      configs,
      'growth',
      'photosynthesis_energy_per_second',
    ),
    energyUpkeepPerBiomass: readNumber(configs, 'growth', 'energy_upkeep_per_biomass'),
    energyCapacityPerBiomass: readNumber(configs, 'growth', 'energy_capacity_per_biomass'),
    energyCapacityFloor: readNumber(configs, 'growth', 'energy_capacity_floor'),
    waterCapacityPerRootBiomass: readNumber(configs, 'growth', 'water_capacity_per_root_biomass'),
    waterCapacityFloor: readNumber(configs, 'growth', 'water_capacity_floor'),
    mineralCapacityPerRootBiomass: readNumber(
      configs,
      'growth',
      'mineral_capacity_per_root_biomass',
    ),
    mineralCapacityFloor: readNumber(configs, 'growth', 'mineral_capacity_floor'),
    initialEnergyFraction: readNumber(configs, 'growth', 'initial_energy_fraction'),
    // Growth over time resource consumption
    growthWaterConsumptionRate: readNumber(configs, 'growth', 'growth_water_consumption_rate'),
    growthNutrientConsumptionRate: readNumber(
      configs,
      'growth',
      'growth_nutrient_consumption_rate',
    ),
    growthMineralConsumptionRate: readNumber(configs, 'growth', 'growth_mineral_consumption_rate'),
    growthMinWater: readNumber(configs, 'growth', 'growth_min_water'),
    growthMinNutrients: readNumber(configs, 'growth', 'growth_min_nutrients'),
    growthMinMinerals: readNumber(configs, 'growth', 'growth_min_minerals'),
    germinationGate: configs.has('dev') ? readBoolean(configs, 'dev', 'germination_gate') : true,
  };
}
