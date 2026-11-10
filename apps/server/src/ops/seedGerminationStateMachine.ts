import type { NodeType } from '@plant-legacy/shared/growth';
import { hash32, mulberry32 } from '@plant-legacy/shared/math';

export type GerminationState =
  | 'seed'
  | 'checking_conditions'
  | 'germinating'
  | 'radicle_created'
  | 'cotyledons_created'
  | 'root_crown_formed'
  | 'failed_conditions'
  | 'failed_energy'
  | 'seed_destroyed';

export interface GerminationConfig {
  minLight: number;
  minMoisture: number;
  growthSpeed: number;
  seedBiomassCost: number;
  radicleBiomassCost: number;
  cotyledonBiomassCost: number;
  rootBiomassCost: number;
  maxCotyledons: number;
  failureKillsSeed: boolean;
}

export interface GerminationContext {
  seedNodeId: string;
  plantId: string;
  seedX: number;
  seedY: number;
  seedZ: number;
  direction: { x: number; y: number; z: number };
  energyAvailable: number;
  totalEnergyCost: number;
  resources: { light: number; moisture: number; minerals: number };
}

export interface GerminationNodeResult {
  id: string;
  plantId: string;
  type: NodeType;
  layer: 'root' | 'canopy';
  x: number;
  y: number;
  z: number;
  biomass: number;
  age: number;
  parentId: string | null;
  children: string[];
  statModifiers: Record<string, number>;
  resourceDrawWater: number;
  resourceDrawNutrients: number;
  upkeepBiomassPerSecond: number;
  growthDirectionBias: string;
  lastGrowthTick: number;
  growthProgress: number;
  isSeed: boolean;
}

export interface GerminationResult {
  state: GerminationState;
  newNodes?: GerminationNodeResult[];
  updatedSeedNode?: GerminationNodeResult;
  rootNodeId?: string | null;
  energySpent: number;
  biomassGained: number;
}

export interface SeedGerminationStateMachine {
  state: GerminationState;
  context: GerminationContext | null;
  config: GerminationConfig;
}

export function createSeedGerminationStateMachine(
  config: GerminationConfig,
): SeedGerminationStateMachine {
  return {
    state: 'seed',
    context: null,
    config,
  };
}

function checkGerminationConditions(
  resources: { light: number; moisture: number },
  config: GerminationConfig,
): { ok: boolean; reason?: string } {
  const moistureOk = resources.moisture >= config.minMoisture;
  const lightOk = resources.light >= config.minLight;

  if (!moistureOk && !lightOk) {
    return { ok: false, reason: 'Insufficient moisture and light for germination' };
  }
  if (!moistureOk) {
    return { ok: false, reason: 'Insufficient moisture for germination' };
  }
  if (!lightOk) {
    return { ok: false, reason: 'Insufficient light for germination' };
  }
  return { ok: true };
}

function normalizeDirection(dir: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (len === 0) return { x: 0, y: -1, z: 0 };
  return { x: dir.x / len, y: dir.y / len, z: dir.z / len };
}

export function seedGerminationStateMachineAdvance(
  machine: SeedGerminationStateMachine,
  context: GerminationContext,
): GerminationResult {
  machine.context = context;
  const config = machine.config;

  if (machine.state === 'seed') {
    machine.state = 'checking_conditions';
  }

  if (machine.state === 'checking_conditions') {
    const conditions = checkGerminationConditions(
      { light: context.resources.light, moisture: context.resources.moisture },
      config,
    );

    if (!conditions.ok) {
      if (config.failureKillsSeed) {
        machine.state = 'seed_destroyed';
        return {
          state: 'seed_destroyed',
          energySpent: 0,
          biomassGained: 0,
        };
      }
      machine.state = 'failed_conditions';
      return {
        state: 'failed_conditions',
        energySpent: 0,
        biomassGained: 0,
      };
    }

    machine.state = 'germinating';
  }

  if (machine.state === 'germinating') {
    if (context.energyAvailable < context.totalEnergyCost) {
      machine.state = 'failed_energy';
      return {
        state: 'failed_energy',
        energySpent: 0,
        biomassGained: 0,
      };
    }

    const speed = config.growthSpeed;
    const dir = normalizeDirection(context.direction);

    // Deterministic RNG from plantId + seedNodeId for reproducible germination
    const germinationSeed = hash32(`${context.plantId}:${context.seedNodeId}:germination`);
    const rng = mulberry32(germinationSeed);

    const radicleId = `node_${germinationSeed.toString(16)}_${rng().toString(36).slice(2, 9)}`;
    const radicleX = context.seedX + dir.x * speed;
    const radicleY = context.seedY + dir.y * speed;
    const radicleZ = context.seedZ + dir.z * speed;

    const newNodes: GerminationNodeResult[] = [
      {
        id: radicleId,
        plantId: context.plantId,
        type: 'radicle',
        layer: 'root',
        x: radicleX,
        y: radicleY,
        z: radicleZ,
        biomass: config.radicleBiomassCost,
        age: 0,
        parentId: context.seedNodeId,
        children: [],
        statModifiers: {},
        resourceDrawWater: 0.8,
        resourceDrawNutrients: 0.5,
        upkeepBiomassPerSecond: 0.001,
        growthDirectionBias: 'downward',
        lastGrowthTick: 0,
        growthProgress: 1.0,
        isSeed: false,
      },
    ];

    const cotyledonCount = Math.min(config.maxCotyledons, 2);
    for (let i = 0; i < cotyledonCount; i++) {
      // Deterministic per-cotyledon RNG
      const cotyledonSeed = hash32(`${context.plantId}:${context.seedNodeId}:cotyledon:${i}`);
      const cotyledonRng = mulberry32(cotyledonSeed);
      const cotyledonId = `node_${cotyledonSeed.toString(16)}_${cotyledonRng().toString(36).slice(2, 9)}`;
      const cotyledonX = context.seedX + (cotyledonRng() - 0.5) * 0.5;
      const cotyledonY = context.seedY + 0.3 + i * 0.1;
      const cotyledonZ = context.seedZ + (cotyledonRng() - 0.5) * 0.5;

      newNodes.push({
        id: cotyledonId,
        plantId: context.plantId,
        type: 'cotyledon',
        layer: 'canopy',
        x: cotyledonX,
        y: cotyledonY,
        z: cotyledonZ,
        biomass: config.cotyledonBiomassCost,
        age: 0,
        parentId: context.seedNodeId,
        children: [],
        statModifiers: { photosynthesis: 1.2, light_blocking: 0.8 },
        resourceDrawWater: 0.1,
        resourceDrawNutrients: 0.1,
        upkeepBiomassPerSecond: 0.003,
        growthDirectionBias: 'upward',
        lastGrowthTick: 0,
        growthProgress: 1.0,
        isSeed: false,
      });
    }

    const updatedSeedNode: GerminationNodeResult = {
      id: context.seedNodeId,
      plantId: context.plantId,
      type: 'root',
      layer: 'root',
      x: context.seedX,
      y: context.seedY,
      z: context.seedZ,
      biomass: config.rootBiomassCost,
      age: 0,
      parentId: null,
      children: [radicleId, ...newNodes.slice(1).map((n) => n.id)],
      statModifiers: {},
      resourceDrawWater: 0.5,
      resourceDrawNutrients: 0.3,
      upkeepBiomassPerSecond: 0.001,
      growthDirectionBias: 'downward',
      lastGrowthTick: 0,
      growthProgress: 1.0,
      isSeed: false,
    };

    machine.state = 'root_crown_formed';

    return {
      state: 'root_crown_formed',
      newNodes,
      updatedSeedNode,
      rootNodeId: context.seedNodeId,
      energySpent: context.totalEnergyCost,
      biomassGained:
        config.radicleBiomassCost +
        cotyledonCount * config.cotyledonBiomassCost +
        config.rootBiomassCost -
        config.seedBiomassCost,
    };
  }

  return {
    state: machine.state,
    energySpent: 0,
    biomassGained: 0,
  };
}

export function seedGerminationStateMachineGetState(
  machine: SeedGerminationStateMachine,
): GerminationState {
  return machine.state;
}

export function seedGerminationStateMachineReset(machine: SeedGerminationStateMachine): void {
  machine.state = 'seed';
  machine.context = null;
}
