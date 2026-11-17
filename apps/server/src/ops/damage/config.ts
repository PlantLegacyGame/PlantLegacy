import type { ConfigFile } from '@plant-legacy/shared/config';
import { readBoolean, readInteger, readNumber } from '@plant-legacy/shared/config';
import type { DamageConfig, TumblingConfig, UprootConfig } from '@plant-legacy/shared/damage';

/**
 * T06 config loaders. Every threshold, rate and lifetime is read here and never
 * inlined in the pipeline (RULE_3).
 */
export function loadDamageConfig(configs: Map<string, ConfigFile>): DamageConfig {
  return {
    weatherDamagePerS: readNumber(configs, 'damage', 'weather_damage_per_s'),
    weatherMinBiomass: readNumber(configs, 'damage', 'weather_min_biomass'),
    weatherMaxBiomassFractionPerS: readNumber(
      configs,
      'damage',
      'weather_max_biomass_fraction_per_s',
    ),
    lightningMaxBiomassFraction: readNumber(configs, 'damage', 'lightning_max_biomass_fraction'),
    stormGustSpeedMps: readNumber(configs, 'damage', 'storm_gust_speed_mps'),
    lightningDamageAmount: readNumber(configs, 'damage', 'lightning_damage_amount'),
    herbivoreSwarmAutoEnabled: readBoolean(configs, 'damage', 'herbivore_swarm_auto_enabled'),
    herbivoreSwarmIntervalS: readInteger(configs, 'damage', 'herbivore_swarm_interval_s'),
    herbivoreSwarmRadiusM: readNumber(configs, 'damage', 'herbivore_swarm_radius_m'),
    herbivoreSwarmDurationS: readNumber(configs, 'damage', 'herbivore_swarm_duration_s'),
    herbivoreSwarmDamagePerS: readNumber(configs, 'damage', 'herbivore_swarm_damage_per_s'),
    herbivoreSwarmSpreadM: readNumber(configs, 'damage', 'herbivore_swarm_spread_m'),
    toolDamagePerHit: readNumber(configs, 'damage', 'tool_damage_per_hit'),
    terrainCollapseDamage: readNumber(configs, 'damage', 'terrain_collapse_damage'),
    terrainCollapseRadiusM: readNumber(configs, 'damage', 'terrain_collapse_radius_m'),
    damageMemoryDecayPerS: readNumber(configs, 'damage', 'damage_memory_decay_per_s'),
    fragmentDropChance: readNumber(configs, 'damage', 'fragment_drop_chance'),
    remainsFragmentCount: readInteger(configs, 'damage', 'remains_fragment_count'),
    fragmentLifetimeS: readInteger(configs, 'damage', 'fragment_lifetime_s'),
    dungPerDeath: readInteger(configs, 'damage', 'dung_per_death'),
    dungPerSwarm: readInteger(configs, 'damage', 'dung_per_swarm'),
    dungLifetimeS: readInteger(configs, 'damage', 'dung_lifetime_s'),
    killCreditWindowS: readInteger(configs, 'damage', 'kill_credit_window_s'),
  };
}

export function loadUprootConfig(configs: Map<string, ConfigFile>): UprootConfig {
  return {
    damageThresholdHp: readInteger(configs, 'uproot', 'damage_threshold_hp'),
    rerootWindowS: readInteger(configs, 'uproot', 'reroot_window_s'),
    rerootSoilMinMoisture: readNumber(configs, 'uproot', 'reroot_soil_min_moisture'),
    rerootSettleSeconds: readNumber(configs, 'uproot', 'reroot_settle_seconds'),
    rerootCrawlSpeedMps: readNumber(configs, 'uproot', 'reroot_crawl_speed_mps'),
    uprootedBiomassDrainPerS: readNumber(configs, 'uproot', 'uprooted_biomass_drain_per_s'),
    detachedWateredDrainMultiplier: readNumber(
      configs,
      'uproot',
      'detached_watered_drain_multiplier',
    ),
    detachedMinTileMoisture: readNumber(configs, 'uproot', 'detached_min_tile_moisture'),
    detachedPhotosynthesisMultiplier: readNumber(
      configs,
      'uproot',
      'detached_photosynthesis_multiplier',
    ),
    detachedDryGraceSeconds: readNumber(configs, 'uproot', 'detached_dry_grace_s'),
    detachedGrowthEnabled: readBoolean(configs, 'uproot', 'detached_growth_enabled'),
    saturationMoisture: readNumber(configs, 'uproot', 'saturation_uproot_moisture'),
    saturationSeconds: readNumber(configs, 'uproot', 'saturation_uproot_seconds'),
    saturationCheckIntervalS: readNumber(configs, 'uproot', 'saturation_check_interval_s'),
    gustThresholdMps: readNumber(configs, 'uproot', 'gust_uproot_threshold_mps'),
    gustHeightReferenceM: readNumber(configs, 'uproot', 'gust_height_reference_m'),
    collapseUprootRadiusM: readNumber(configs, 'uproot', 'collapse_uproot_radius_m'),
    uprootLiftM: readNumber(configs, 'uproot', 'uproot_lift_m'),
    uprootTiltDegrees: readNumber(configs, 'uproot', 'uproot_tilt_degrees'),
  };
}

export function loadTumblingConfig(configs: Map<string, ConfigFile>): TumblingConfig {
  return {
    impulseMinMps: readNumber(configs, 'tumbling', 'impulse_min_mps'),
    impulseMaxMps: readNumber(configs, 'tumbling', 'impulse_max_mps'),
    gravityMps2: readNumber(configs, 'tumbling', 'gravity_mps2'),
    groundFrictionPerS: readNumber(configs, 'tumbling', 'ground_friction_per_s'),
    bounceDamping: readNumber(configs, 'tumbling', 'bounce_damping'),
    maxTumbleSeconds: readNumber(configs, 'tumbling', 'max_tumble_seconds'),
    impactDamagePerMps: readNumber(configs, 'tumbling', 'impact_damage_per_mps'),
    impactDamageMinSpeedMps: readNumber(configs, 'tumbling', 'impact_damage_min_speed_mps'),
    rollSpeedMaxRadPerS: readNumber(configs, 'tumbling', 'roll_speed_max_rad_per_s'),
    settleSpeedMps: readNumber(configs, 'tumbling', 'settle_speed_mps'),
  };
}
