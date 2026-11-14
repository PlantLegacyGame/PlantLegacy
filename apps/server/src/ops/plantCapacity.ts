import type { GrowthConfig, Plant } from '@plant-legacy/shared/growth';

export interface PlantCapacity {
  /** Energy the plant can hold, scaled by its total biomass. */
  energy: number;
  /** Water the roots can hold, scaled by root biomass. */
  water: number;
  /** Minerals the roots can hold, scaled by root biomass. */
  minerals: number;
}

/**
 * Storage limits come from the plant itself (RULE_3): a bigger plant holds more.
 * The coefficients and floors are config values in `config/growth.json`, so the
 * only fixed quantity in code is "sum the plant's own biomass".
 */
export function computePlantCapacity(plant: Plant, config: GrowthConfig): PlantCapacity {
  let rootBiomass = 0;
  for (const node of plant.nodes.values()) {
    if (node.layer === 'root') rootBiomass += node.biomass;
  }

  return {
    energy: Math.max(
      config.energyCapacityFloor,
      plant.totalBiomass * config.energyCapacityPerBiomass,
    ),
    water: Math.max(config.waterCapacityFloor, rootBiomass * config.waterCapacityPerRootBiomass),
    minerals: Math.max(
      config.mineralCapacityFloor,
      rootBiomass * config.mineralCapacityPerRootBiomass,
    ),
  };
}

/** Clamps stored resources to the plant's current capacity. */
export function clampPlantStorage(plant: Plant, config: GrowthConfig): void {
  const capacity = computePlantCapacity(plant, config);
  plant.totalEnergy = Math.min(plant.totalEnergy, capacity.energy);
  plant.storedWater = Math.min(plant.storedWater, capacity.water);
  plant.storedMinerals = Math.min(plant.storedMinerals, capacity.minerals);
}
