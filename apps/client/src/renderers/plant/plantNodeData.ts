import type * as THREE from 'three';

/**
 * PlantNodeData represents a single node in a plant's graph as the client
 * receives it.
 *
 * Supports the legacy (type: number) format for backward compatibility. It is
 * declared here, rather than in `PlantRenderer.ts`, so the visual tables, the
 * GPU packer and the renderers can share it without importing the renderer
 * class back.
 */
export interface PlantNodeData {
  id: string;
  position: THREE.Vector3;
  /** Legacy: 0 = root, 1 = stem/trunk/branch, 2 = leaf */
  type: number;
  /** New: exact server node type (e.g. 'seed', 'radicle', 'root', 'stem', 'leaf', etc.) */
  nodeType?: string;
  radius: number;
  parentId: string | null;
  children?: string[];
  age: number;
  health: number;
  /** Server bitmask of acquired mutations; see renderers/plant/mutations.ts. */
  mutationFlags: number;
  /** Mutation ids, when the server sends names instead of the bitmask. */
  mutations?: string[];
  biomass: number;
  isOwnPlant?: boolean;
  spawnTime?: number;
  growthProgress?: number;
  isSeed?: boolean;
  layer?: 'root' | 'canopy';
  // Server-authoritative parent attachment position for growth animation sync
  parentAttachX?: number;
  parentAttachY?: number;
  parentAttachZ?: number;
  /** Where along the parent's own segment this node leaves it (1 = its end). */
  attachFraction?: number;
  // Server-authoritative target position where a growing node ends up.
  // When present and growthProgress < 1, the connector tube/segment runs from
  // the parent to this target (scaled by growthProgress), so new growth is
  // drawn connected to its parent instead of as a zero-length blob.
  targetX?: number;
  targetY?: number;
  targetZ?: number;
}
