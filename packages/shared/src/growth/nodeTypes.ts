import type { GrowthConfig, Layer, NodeType, NodeTypeDefinition } from './types.ts';

/** Which half of the organism a node type belongs to. */
export function getLayerForNodeType(type: NodeType): Layer {
  return type === 'seed' || type === 'root' || type === 'radicle' || type === 'lateral_root'
    ? 'root'
    : 'canopy';
}

/** The configured definition for one node type. */
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

/** Whether a parent may parent a node on the other side of the soil line. */
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

/**
 * Node types that may be grown from a parent of the given type.
 *
 * Stepwise germination is deliberate: one directed action at a time, radicle
 * first, then cotyledons from the seed/root crown.
 */
export function getAvailableGrowthTypes(parentType: NodeType, _config: GrowthConfig): NodeType[] {
  const layer = getLayerForNodeType(parentType);
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
