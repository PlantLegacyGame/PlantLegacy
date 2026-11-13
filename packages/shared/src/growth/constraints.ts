import type { GrowthGeneConstraints, NodeType } from './types.ts';

/**
 * Gene-owned direction limits per node type.
 *
 * These are the authoritative bounds the server validates a growth direction
 * against and the client draws its growth cone from, so they must live in one
 * place rather than being restated by each side.
 */
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

/**
 * Clamp a requested direction into the gene sector for a node type.
 *
 * The returned vector is unit length, so callers can treat it as a direction
 * and multiply by a segment length.
 */
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
