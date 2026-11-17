import type { GrowthConfig, Layer, NodeType, NodeTypeDefinition } from './types.ts';

/** Which half of the organism a node type belongs to. */
export function getLayerForNodeType(type: NodeType): Layer {
  return type === 'seed' ||
    type === 'root' ||
    type === 'radicle' ||
    type === 'lateral_root' ||
    type === 'rhizome' ||
    type === 'pneumatophore' ||
    type === 'tuber'
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
    case 'trunk':
      return config.trunkNode;
    case 'rhizome':
      return config.rhizomeNode;
    case 'culm':
      return config.culmNode;
    case 'floating_leaf':
      return config.floatingLeafNode;
    case 'pneumatophore':
      return config.pneumatophoreNode ?? config.rootNode;
    case 'thorn':
      return config.thornNode ?? config.branchNode;
    case 'stolon':
      return config.stolonNode ?? config.vineNode;
    case 'tuber':
      return config.tuberNode ?? config.rootNode;
    default:
      return config.rootNode;
  }
}

/** Whether a parent may parent a node on the other side of the soil line. */
export function canCrossLayer(parentType: NodeType, targetType: NodeType): boolean {
  const parentLayer = getLayerForNodeType(parentType);
  const targetLayer = getLayerForNodeType(targetType);
  if (parentLayer === targetLayer) return true;
  // A stolon roots adventitiously at its own nodes, so the runner itself may
  // place a root; nothing else in the canopy reaches underground.
  if (parentType === 'stolon' && targetType === 'root') return true;
  if (parentLayer === 'root' && targetLayer === 'canopy') {
    // Stepwise germination: the seed/root crown can place cotyledons upward.
    if (parentType === 'seed') return targetType === 'cotyledon';
    return (
      parentType === 'root' ||
      parentType === 'radicle' ||
      parentType === 'lateral_root' ||
      parentType === 'rhizome' ||
      parentType === 'pneumatophore'
    );
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
      // Trunk, rhizome and culm exist only once a mutation unlocks them.
      return ['lateral_root', 'stem'];
    }
    if (parentType === 'rhizome') {
      // A runner leaves the rhizome and travels just under the surface. Without
      // this the `stolon` organ could not be grown from anything: the unlock
      // granted a part the growth rules never offered.
      return ['rhizome', 'lateral_root', 'stem', 'stolon'];
    }
    if (parentType === 'pneumatophore') {
      // Breathing roots rise out of the waterlogged layer and can keep doing so.
      return ['pneumatophore', 'lateral_root', 'stem'];
    }
    if (parentType === 'tuber') {
      // The eyes of a tuber are buds: a tuber can raise a shoot of its own.
      return ['stem', 'tuber'];
    }
    return [];
  }
  if (layer === 'canopy') {
    if (parentType === 'stem') {
      // A stem continues into another stem: that is what an internode is, and it
      // is the only way a plant that has not unlocked a trunk or a culm can get
      // taller. Without it a shoot stopped one segment above the soil and every
      // body was a fan of branches and leaves off a single stump - which is what
      // read as a bundle of tentacles rather than a plant.
      return ['stem', 'branch', 'leaf', 'flower', 'spore_sac', 'vine'];
    }
    if (parentType === 'trunk') {
      return ['branch', 'trunk', 'leaf', 'flower', 'spore_sac', 'vine'];
    }
    if (parentType === 'culm') {
      return ['culm', 'leaf', 'branch'];
    }
    if (parentType === 'branch' || parentType === 'vine') {
      return ['leaf', 'flower', 'spore_sac', 'vine'];
    }
    if (parentType === 'stolon') {
      // A runner keeps running, roots at a node, and can raise a new shoot there.
      return ['stolon', 'root', 'stem', 'leaf'];
    }
  }
  return [];
}
