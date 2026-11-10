export type PlantTier = 'active' | 'near' | 'dormant';

export interface PlantTierConfig {
  name: PlantTier;
  tickRateHz: number;
  description: string;
}

export function createPlantTierConfigs(
  activeTickRateHz: number,
  nearTickRateHz: number,
  dormantTickRateHz: number,
): ReadonlyMap<PlantTier, PlantTierConfig> {
  return new Map([
    [
      'active',
      {
        name: 'active',
        tickRateHz: activeTickRateHz,
        description: 'Player online - full simulation rate',
      },
    ],
    [
      'near',
      {
        name: 'near',
        tickRateHz: nearTickRateHz,
        description: 'Near active player - reduced rate',
      },
    ],
    [
      'dormant',
      {
        name: 'dormant',
        tickRateHz: dormantTickRateHz,
        description: 'Offline, far from others - catch-up integration',
      },
    ],
  ]);
}

// Default configs for backward compatibility
export const PLANT_TIER_CONFIGS: ReadonlyMap<PlantTier, PlantTierConfig> = createPlantTierConfigs(
  20,
  5,
  1 / 30,
);

export interface PlantTierTransitionConfig {
  nearDistance: number;
}

export interface PlantTierStateMachine {
  activePlants: Set<string>;
  nearPlants: Set<string>;
  dormantPlants: Set<string>;
  config: PlantTierTransitionConfig;
  tierConfigs: ReadonlyMap<PlantTier, PlantTierConfig>;
}

export function createPlantTierStateMachine(
  config: PlantTierTransitionConfig,
  tierConfigs?: ReadonlyMap<PlantTier, PlantTierConfig>,
): PlantTierStateMachine {
  const configs = tierConfigs ?? PLANT_TIER_CONFIGS;
  return {
    activePlants: new Set(),
    nearPlants: new Set(),
    dormantPlants: new Set(),
    config,
    tierConfigs: configs,
  };
}

export function plantTierStateMachineUpdate(
  machine: PlantTierStateMachine,
  allPlants: Map<
    string,
    { rootNodeId?: string; nodes: Map<string, { x: number; z: number }>; tier?: PlantTier }
  >,
  onlinePlantIds: Set<string>,
  _currentTick: number,
): Array<{ plantId: string; oldTier: PlantTier; newTier: PlantTier }> {
  const transitions: Array<{ plantId: string; oldTier: PlantTier; newTier: PlantTier }> = [];

  for (const [plantId, plant] of allPlants.entries()) {
    const isOnline = onlinePlantIds.has(plantId);
    const isNear = isOnline
      ? false
      : isPlantNearActive(plant, allPlants, onlinePlantIds, machine.config.nearDistance);

    let newTier: PlantTier;
    if (isOnline) {
      newTier = 'active';
    } else if (isNear) {
      newTier = 'near';
    } else {
      newTier = 'dormant';
    }

    const oldTier = plant.tier ?? 'dormant';
    if (oldTier !== newTier) {
      transitions.push({ plantId, oldTier, newTier });

      machine.activePlants.delete(plantId);
      machine.nearPlants.delete(plantId);
      machine.dormantPlants.delete(plantId);

      if (newTier === 'active') machine.activePlants.add(plantId);
      else if (newTier === 'near') machine.nearPlants.add(plantId);
      else machine.dormantPlants.add(plantId);

      plant.tier = newTier;
    }
  }

  return transitions;
}

function isPlantNearActive(
  plant: { rootNodeId?: string; nodes: Map<string, { x: number; z: number }> },
  allPlants: Map<string, { rootNodeId?: string; nodes: Map<string, { x: number; z: number }> }>,
  onlinePlantIds: Set<string>,
  nearDistance: number,
): boolean {
  const thisRootId = plant.rootNodeId;
  if (!thisRootId) return false;
  const thisRoot = plant.nodes.get(thisRootId);
  if (!thisRoot) return false;

  const nearDistanceSq = nearDistance * nearDistance;

  for (const onlineId of onlinePlantIds) {
    const onlinePlant = allPlants.get(onlineId);
    if (!onlinePlant) continue;
    const rootNodeId = onlinePlant.rootNodeId;
    if (!rootNodeId) continue;
    const rootNode = onlinePlant.nodes.get(rootNodeId);
    if (!rootNode) continue;

    const dx = rootNode.x - thisRoot.x;
    const dz = rootNode.z - thisRoot.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < nearDistanceSq) {
      return true;
    }
  }
  return false;
}

export function plantTierStateMachineGetTierStats(machine: PlantTierStateMachine): {
  active: number;
  near: number;
  dormant: number;
} {
  return {
    active: machine.activePlants.size,
    near: machine.nearPlants.size,
    dormant: machine.dormantPlants.size,
  };
}

export function plantTierStateMachineGetPlantsByTier(
  machine: PlantTierStateMachine,
  tier: PlantTier,
  allPlants: Map<string, unknown>,
): unknown[] {
  const set =
    tier === 'active'
      ? machine.activePlants
      : tier === 'near'
        ? machine.nearPlants
        : machine.dormantPlants;
  return Array.from(set)
    .map((id) => allPlants.get(id))
    .filter((p): p is unknown => p !== undefined);
}

export function plantTierStateMachineGetTickRate(
  machine: PlantTierStateMachine,
  tier: PlantTier,
): number {
  const configs = machine.tierConfigs ?? PLANT_TIER_CONFIGS;
  const config = configs.get(tier);
  return config?.tickRateHz ?? 0;
}
