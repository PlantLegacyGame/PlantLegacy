import type { ConfigFile } from '@plant-legacy/shared/config';
import { readBoolean, readInteger, readNumber, readObject } from '@plant-legacy/shared/config';
import type { GrowthConfig, NodeTypeDefinition } from '@plant-legacy/shared/growth';

export function loadGrowthConfig(configs: Map<string, ConfigFile>): GrowthConfig {
  return {
    rootGrowthSpeed: readNumber(configs, 'growth', 'root_growth_speed'),
    canopyGrowthSpeed: readNumber(configs, 'growth', 'canopy_growth_speed'),
    nodeCostBase: readInteger(configs, 'growth', 'node_cost_base'),
    maxNodesPerPlant: readInteger(configs, 'growth', 'max_nodes_per_plant'),
    growthCooldown: readNumber(configs, 'growth', 'growth_cooldown'),
    rootOverlapPressureDamage: readNumber(configs, 'growth', 'root_overlap_pressure_damage'),
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
    rootAttackDamageMultiplier: readNumber(configs, 'growth', 'root_attack_damage_multiplier'),
    germinationMinMoisture: readNumber(configs, 'growth', 'germination_min_moisture'),
    germinationMinLight: readNumber(configs, 'growth', 'germination_min_light'),
    germinationFailureKillsSeed: readBoolean(configs, 'growth', 'germination_failure_kills_seed'),
    // ADR-019: Energy system
    photosynthesisEnergyPerSecond: readNumber(
      configs,
      'growth',
      'photosynthesis_energy_per_second',
    ),
    energyUpkeepPerBiomass: readNumber(configs, 'growth', 'energy_upkeep_per_biomass'),
    maxEnergyPerPlant: readInteger(configs, 'growth', 'max_energy_per_plant'),
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
  };
}
