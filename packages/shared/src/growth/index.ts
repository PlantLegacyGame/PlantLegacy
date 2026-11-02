export type NodeType = 'root' | 'stem' | 'leaf' | 'flower' | 'spore_sac' | 'vine';

export type Layer = 'root' | 'canopy';

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
  upkeep_biomass_per_second: number;
  stat_modifiers: NodeStatModifiers;
  growth_direction_bias: 'downward' | 'upward' | 'outward' | 'horizontal';
}

export interface GrowthConfig {
  rootGrowthSpeed: number;
  canopyGrowthSpeed: number;
  nodeCostBase: number;
  maxNodesPerPlant: number;
  growthCooldown: number;
  rootOverlapPressureDamage: number;
  lightBlockingPerNode: number;
  rootNode: NodeTypeDefinition;
  stemNode: NodeTypeDefinition;
  leafNode: NodeTypeDefinition;
  flowerNode: NodeTypeDefinition;
  sporeSacNode: NodeTypeDefinition;
  vineNode: NodeTypeDefinition;
  growthIntentCooldown: number;
  rootAttackDamageMultiplier: number;
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
  upkeepBiomassPerSecond: number;
  growthDirectionBias: 'downward' | 'upward' | 'outward' | 'horizontal';
  lastGrowthTick: number;
}

export interface Plant {
  id: string;
  ownerId: string;
  worldId: string;
  nodes: Map<string, PlantNode>;
  rootNodeId: string | null;
  totalBiomass: number;
  totalUpkeep: number;
  lastGrowthTick: number;
  growthCooldownUntil: number;
}

export interface GrowthIntent {
  plantId: string;
  nodeId: string;
  direction: { x: number; y: number; z: number };
  nodeType: NodeType;
  isAttack: boolean;
  tick: number;
}

export interface GrowthResult {
  success: boolean;
  newNode?: PlantNode;
  reason?: string;
  damageDealt?: number;
}

export function getLayerForNodeType(type: NodeType): Layer {
  return type === 'root' ? 'root' : 'canopy';
}

export function getNodeTypeDefinition(config: GrowthConfig, type: NodeType): NodeTypeDefinition {
  switch (type) {
    case 'root':
      return config.rootNode;
    case 'stem':
      return config.stemNode;
    case 'leaf':
      return config.leafNode;
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
