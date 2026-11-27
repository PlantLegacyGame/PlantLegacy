import type { ConfigFile } from '@plant-legacy/shared/config';
import { readBoolean, readInteger, readNumber, readObject } from '@plant-legacy/shared/config';
import {
  type GrowthConfig,
  type NodeRadiusProfile,
  type NodeTypeDefinition,
  type OrganMorphologyOverride,
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
    jointFlareRatio: optionalNumber(configs, 'growth', 'joint_flare_ratio'),
    segmentTaperExponent: optionalNumber(configs, 'growth', 'segment_taper_exponent'),
    socketInsetRatio: optionalNumber(configs, 'growth', 'socket_inset_ratio'),
    organMorphology: optionalObject<Record<string, OrganMorphologyOverride>>(
      configs,
      'growth',
      'organ_morphology',
    ),
  });

  // The four newer tissues are optional so a config that predates them (and the
  // test fixtures that mirror one) still boots; they fall back to the nearest
  // existing tissue until growth.json defines them.
  const stemNode = readObject<NodeTypeDefinition>(configs, 'growth', 'stem_node');
  const rootNode = readObject<NodeTypeDefinition>(configs, 'growth', 'root_node');
  const leafNode = readObject<NodeTypeDefinition>(configs, 'growth', 'leaf_node');
  const trunkNode = optionalObject<NodeTypeDefinition>(configs, 'growth', 'trunk_node') ?? stemNode;
  const rhizomeNode =
    optionalObject<NodeTypeDefinition>(configs, 'growth', 'rhizome_node') ?? rootNode;
  const culmNode = optionalObject<NodeTypeDefinition>(configs, 'growth', 'culm_node') ?? stemNode;
  const floatingLeafNode =
    optionalObject<NodeTypeDefinition>(configs, 'growth', 'floating_leaf_node') ?? leafNode;
  const branchNode = readObject<NodeTypeDefinition>(configs, 'growth', 'branch_node');
  const pneumatophoreNode =
    optionalObject<NodeTypeDefinition>(configs, 'growth', 'pneumatophore_node') ?? rootNode;
  const thornNode =
    optionalObject<NodeTypeDefinition>(configs, 'growth', 'thorn_node') ?? branchNode;
  const stolonNode =
    optionalObject<NodeTypeDefinition>(configs, 'growth', 'stolon_node') ?? branchNode;
  const tuberNode = optionalObject<NodeTypeDefinition>(configs, 'growth', 'tuber_node') ?? rootNode;

  return {
    rootGrowthSpeed: readNumber(configs, 'growth', 'root_growth_speed'),
    canopyGrowthSpeed: readNumber(configs, 'growth', 'canopy_growth_speed'),
    nodeCostBase: readInteger(configs, 'growth', 'node_cost_base'),
    maxNodesPerPlant: readInteger(configs, 'growth', 'max_nodes_per_plant'),
    growthCooldown: readNumber(configs, 'growth', 'growth_cooldown'),
    lightBlockingPerNode: readInteger(configs, 'growth', 'light_blocking_per_node'),
    seedNode: readObject<NodeTypeDefinition>(configs, 'growth', 'seed_node'),
    radicleNode: readObject<NodeTypeDefinition>(configs, 'growth', 'radicle_node'),
    rootNode,
    lateralRootNode: readObject<NodeTypeDefinition>(configs, 'growth', 'lateral_root_node'),
    stemNode,
    branchNode,
    leafNode,
    cotyledonNode: readObject<NodeTypeDefinition>(configs, 'growth', 'cotyledon_node'),
    flowerNode: readObject<NodeTypeDefinition>(configs, 'growth', 'flower_node'),
    sporeSacNode: readObject<NodeTypeDefinition>(configs, 'growth', 'spore_sac_node'),
    vineNode: readObject<NodeTypeDefinition>(configs, 'growth', 'vine_node'),
    trunkNode,
    rhizomeNode,
    culmNode,
    floatingLeafNode,
    pneumatophoreNode,
    thornNode,
    stolonNode,
    tuberNode,
    // T04 health and aquatic gate. Optional so older configs boot unchanged.
    growthMinHealth: optionalNumber(configs, 'growth', 'growth_min_health') ?? 0.35,
    healthPhotosynthesisFloor:
      optionalNumber(configs, 'growth', 'health_photosynthesis_floor') ?? 0.5,
    floatingLeafMinGroundwater:
      optionalNumber(configs, 'growth', 'floating_leaf_min_groundwater') ?? 0,
    // Damage and slow repair: drought sheds tissue, calm weather rebuilds it.
    tissueRepairPerSecond: optionalNumber(configs, 'growth', 'tissue_repair_per_second') ?? 0,
    tissueRepairEnergyPerBiomass:
      optionalNumber(configs, 'growth', 'tissue_repair_energy_per_biomass') ?? 0,
    stemDamageWitherDelayS: optionalNumber(configs, 'growth', 'stem_damage_wither_delay_s') ?? 30,
    stemDamageWitherPerS: optionalNumber(configs, 'growth', 'stem_damage_wither_per_s') ?? 0.01,
    growthIntentCooldown: readNumber(configs, 'growth', 'growth_intent_cooldown'),
    // Optional: a fixture that predates the ceiling simply has none.
    maxChildLengthRatio: optionalNumber(configs, 'growth', 'max_child_length_ratio'),
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
    // Carbon-to-mass conversion and tissue maintenance. Optional so older
    // configs keep working; the defaults are the documented growth.json values.
    growthBiomassYield: optionalNumber(configs, 'growth', 'growth_biomass_yield') ?? 1,
    upkeepWaterPerBiomass: optionalNumber(configs, 'growth', 'upkeep_water_per_biomass_per_s') ?? 0,
    upkeepMineralPerBiomass:
      optionalNumber(configs, 'growth', 'upkeep_mineral_per_biomass_per_s') ?? 0,
    waterDeficitBiomassLoss: optionalNumber(configs, 'growth', 'water_deficit_biomass_loss') ?? 0.5,
    mineralDeficitBiomassLoss:
      optionalNumber(configs, 'growth', 'mineral_deficit_biomass_loss') ?? 0.35,
    growthMinWater: readNumber(configs, 'growth', 'growth_min_water'),
    growthMinNutrients: readNumber(configs, 'growth', 'growth_min_nutrients'),
    growthMinMinerals: readNumber(configs, 'growth', 'growth_min_minerals'),
    germinationGate: configs.has('dev') ? readBoolean(configs, 'dev', 'germination_gate') : true,
  };
}
