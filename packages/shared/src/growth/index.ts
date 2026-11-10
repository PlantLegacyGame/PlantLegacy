export type NodeType =
  | 'seed'
  | 'radicle'
  | 'root'
  | 'lateral_root'
  | 'stem'
  | 'branch'
  | 'vine'
  | 'leaf'
  | 'cotyledon'
  | 'flower'
  | 'spore_sac';

export type Layer = 'root' | 'canopy';

export type GrowthDirectionBias = 'downward' | 'upward' | 'outward' | 'horizontal';

export interface GrowthGeneConstraints {
  maxReach: number;
  minY: number;
  maxY: number;
  minHorizontal: number;
  maxHorizontal: number;
  downwardPreferred?: boolean;
  upwardPreferred?: boolean;
}

export const NODE_GROWTH_CONSTRAINTS: Record<NodeType, GrowthGeneConstraints> = {
  radicle: {
    maxReach: 1.5,
    minY: -1.0,
    maxY: -0.25,
    minHorizontal: 0.0,
    maxHorizontal: 0.968,
    downwardPreferred: true,
  },
  root: {
    maxReach: 2.0,
    minY: -1.0,
    maxY: -0.2,
    minHorizontal: 0.0,
    maxHorizontal: 0.98,
    downwardPreferred: true,
  },
  lateral_root: {
    maxReach: 1.8,
    minY: -0.9,
    maxY: -0.15,
    minHorizontal: 0.25,
    maxHorizontal: 0.99,
    downwardPreferred: true,
  },
  stem: {
    maxReach: 2.2,
    minY: 0.35,
    maxY: 1.0,
    minHorizontal: 0.0,
    maxHorizontal: 0.937,
    upwardPreferred: true,
  },
  branch: {
    maxReach: 2.0,
    minY: -0.4,
    maxY: 0.65,
    minHorizontal: 0.35,
    maxHorizontal: 1.0,
  },
  vine: {
    maxReach: 2.5,
    minY: -0.5,
    maxY: 0.65,
    minHorizontal: 0.3,
    maxHorizontal: 1.0,
  },
  leaf: {
    maxReach: 1.4,
    minY: 0.15,
    maxY: 0.75,
    minHorizontal: 0.35,
    maxHorizontal: 1.0,
  },
  cotyledon: {
    maxReach: 1.2,
    minY: 0.15,
    maxY: 0.75,
    minHorizontal: 0.35,
    maxHorizontal: 1.0,
  },
  flower: {
    maxReach: 1.5,
    minY: 0.35,
    maxY: 1.0,
    minHorizontal: 0.0,
    maxHorizontal: 0.937,
    upwardPreferred: true,
  },
  spore_sac: {
    maxReach: 1.5,
    minY: -0.2,
    maxY: 0.7,
    minHorizontal: 0.3,
    maxHorizontal: 1.0,
  },
  seed: {
    maxReach: 1.5,
    minY: -1.0,
    maxY: -0.25,
    minHorizontal: 0.0,
    maxHorizontal: 0.968,
    downwardPreferred: true,
  },
};

export function clampGrowthDirectionByGene(
  nodeType: NodeType | string,
  dir: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const constraints = NODE_GROWTH_CONSTRAINTS[nodeType as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;

  let dx = dir.x;
  let dy = dir.y;
  let dz = dir.z;
  const len = Math.hypot(dx, dy, dz);

  if (len < 1e-4) {
    if (constraints.downwardPreferred) {
      dx = 0.05;
      dy = -0.998;
      dz = 0.05;
    } else if (constraints.upwardPreferred) {
      dx = 0.05;
      dy = 0.998;
      dz = 0.05;
    } else {
      dx = 0.95;
      dy = 0.3;
      dz = 0.05;
    }
  } else {
    dx /= len;
    dy /= len;
    dz /= len;
  }

  // Clamp Y within gene bounds
  const clampedY = Math.max(constraints.minY, Math.min(constraints.maxY, dy));

  // Re-scale horizontal components to maintain unit vector
  const targetH = Math.sqrt(Math.max(0, 1 - clampedY * clampedY));
  const currentH = Math.hypot(dx, dz);

  if (currentH > 1e-4) {
    const scale = targetH / currentH;
    dx *= scale;
    dz *= scale;
  } else {
    dx = targetH;
    dz = 0;
  }

  return { x: dx, y: clampedY, z: dz };
}

export interface NodeStatModifiers {
  structural_integrity?: number;
  photosynthesis?: number;
  light_blocking?: number;
  reproduction?: number;
  pollinator_attraction?: number;
  spore_production?: number;
  climbing?: number;
  horizontal_spread?: number;
  [key: string]: number | undefined;
}

export interface NodeTypeDefinition {
  biomass_cost: number;
  resource_draw_water: number;
  resource_draw_nutrients: number;
  resource_draw_minerals: number;
  upkeep_biomass_per_second: number;
  stat_modifiers: NodeStatModifiers;
  growth_direction_bias: GrowthDirectionBias;
  growth_time_seconds: number;
  // Minerals are used for structural components: cell walls (cellulose/lignin),
  // enzyme cofactors, structural proteins. Higher for woody nodes (stem, branch, root).
}

export interface GrowthConfig {
  rootGrowthSpeed: number;
  canopyGrowthSpeed: number;
  nodeCostBase: number;
  maxNodesPerPlant: number;
  growthCooldown: number;
  rootOverlapPressureDamage: number;
  lightBlockingPerNode: number;
  seedNode: NodeTypeDefinition;
  radicleNode: NodeTypeDefinition;
  rootNode: NodeTypeDefinition;
  lateralRootNode: NodeTypeDefinition;
  stemNode: NodeTypeDefinition;
  branchNode: NodeTypeDefinition;
  leafNode: NodeTypeDefinition;
  cotyledonNode: NodeTypeDefinition;
  flowerNode: NodeTypeDefinition;
  sporeSacNode: NodeTypeDefinition;
  vineNode: NodeTypeDefinition;
  growthIntentCooldown: number;
  rootAttackDamageMultiplier: number;
  germinationMinMoisture: number;
  germinationMinLight: number;
  germinationFailureKillsSeed: boolean;
  photosynthesisEnergyPerSecond: number;
  energyUpkeepPerBiomass: number;
  maxEnergyPerPlant: number;
  // Resource consumption during growth (per second of growth time)
  growthWaterConsumptionRate: number;
  growthNutrientConsumptionRate: number;
  growthMineralConsumptionRate: number;
  // Minimum resource levels required for growth to proceed
  growthMinWater: number;
  growthMinNutrients: number;
  growthMinMinerals: number;
}

export interface PlantNode {
  id: string;
  plantId: string;
  type: NodeType;
  layer: Layer;
  x: number;
  y: number;
  z: number;
  biomass: number;
  age: number;
  parentId: string | null;
  children: string[];
  statModifiers: NodeStatModifiers;
  resourceDrawWater: number;
  resourceDrawNutrients: number;
  resourceDrawMinerals: number;
  upkeepBiomassPerSecond: number;
  growthDirectionBias: GrowthDirectionBias;
  lastGrowthTick: number;
  growthProgress: number;
  // Growth over time fields
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  growthTimeRemaining?: number;
  growthWaterConsumed?: number;
  growthNutrientsConsumed?: number;
  growthMineralsConsumed?: number;
  isSeed: boolean;
}

export interface Plant {
  id: string;
  ownerId: string;
  worldId: string;
  nodes: Map<string, PlantNode>;
  rootNodeId: string | null;
  totalBiomass: number;
  totalEnergy: number;
  totalUpkeep: number;
  // Internal resource storage - filled by root absorption, consumed by growth
  storedWater: number;
  storedMinerals: number;
  lastGrowthTick: number;
  growthCooldownUntil: number;
  tier?: 'active' | 'near' | 'dormant';
  lastTick?: number;
  maxNodesPerPlant?: number;
  // Growth sequence number for client mirror gap detection
  growthSeq: number;
}

export type GrowthMode = 'apical' | 'lateral';

export interface GrowthIntent {
  plantId: string;
  nodeId: string;
  direction: { x: number; y: number; z: number };
  nodeType: NodeType;
  isAttack: boolean;
  tick: number;
  growthMode?: GrowthMode;
}

export interface GrowthResult {
  success: boolean;
  newNode?: PlantNode;
  newNodes?: PlantNode[];
  updatedParentNode?: PlantNode;
  reason?: string;
  damageDealt?: number;
  plantDied?: boolean;
}

export interface GrowthConditions {
  // Tile-based (for germination)
  light: number;
  moisture: number;
  minLight: number;
  minMoisture: number;
  // Plant storage-based (for growth)
  storedWater?: number;
  storedMinerals?: number;
  growthMinWater?: number;
  growthMinMinerals?: number;
  ok: boolean;
  // For germination: check tile light/moisture; for growth: check stored water/minerals
  growthOk?: boolean;
}

export interface GrowthOption {
  type: NodeType;
  label: string;
  energyCost: number;
  biomassGain: number;
  expectedSeconds: number;
  available: boolean;
  reason?: string;
  risk?: string;
  // Resource costs for growth over time
  waterCost?: number;
  nutrientCost?: number;
  mineralCost?: number;
}

export interface GrowthOptionsResult {
  nodeId: string;
  nodeType: NodeType;
  isSeed: boolean;
  energy: number;
  biomass: number;
  options: GrowthOption[];
  conditions?: GrowthConditions;
}

export function getLayerForNodeType(type: NodeType): Layer {
  return type === 'seed' || type === 'root' || type === 'radicle' || type === 'lateral_root'
    ? 'root'
    : 'canopy';
}

export function getNodeTypeDefinition(config: GrowthConfig, type: NodeType): NodeTypeDefinition {
  switch (type) {
    case 'seed':
      return config.seedNode;
    case 'radicle':
      return config.radicleNode;
    case 'root':
      return config.rootNode;
    case 'lateral_root':
      return config.lateralRootNode;
    case 'stem':
      return config.stemNode;
    case 'branch':
      return config.branchNode;
    case 'leaf':
      return config.leafNode;
    case 'cotyledon':
      return config.cotyledonNode;
    case 'flower':
      return config.flowerNode;
    case 'spore_sac':
      return config.sporeSacNode;
    case 'vine':
      return config.vineNode;
    default:
      return config.rootNode;
  }
}

export function canCrossLayer(parentType: NodeType, targetType: NodeType): boolean {
  const parentLayer = getLayerForNodeType(parentType);
  const targetLayer = getLayerForNodeType(targetType);
  if (parentLayer === targetLayer) return true;
  if (parentLayer === 'root' && targetLayer === 'canopy') {
    // Stepwise germination: the seed/root crown can place cotyledons upward.
    if (parentType === 'seed') return targetType === 'cotyledon';
    return parentType === 'root' || parentType === 'radicle' || parentType === 'lateral_root';
  }
  return false;
}

export function getAvailableGrowthTypes(parentType: NodeType, _config: GrowthConfig): NodeType[] {
  const layer = getLayerForNodeType(parentType);
  // Stepwise germination (one directed action at a time): radicle first, then cotyledons from the seed/root crown.
  if (parentType === 'seed') {
    return ['radicle', 'cotyledon'];
  }
  if (layer === 'root') {
    if (parentType === 'root' || parentType === 'radicle' || parentType === 'lateral_root') {
      return ['lateral_root', 'stem'];
    }
    return [];
  }
  if (layer === 'canopy') {
    if (parentType === 'stem') {
      return ['branch', 'leaf', 'flower', 'spore_sac', 'vine'];
    }
    if (parentType === 'branch') {
      return ['leaf', 'flower', 'spore_sac', 'vine'];
    }
    if (parentType === 'vine') {
      return ['leaf', 'flower', 'spore_sac', 'vine'];
    }
  }
  return [];
}
