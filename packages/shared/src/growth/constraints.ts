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
  trunk: {
    // Woody secondary growth: upright, taller reach than a soft stem.
    maxReach: 2.6,
    minY: 0.45,
    maxY: 1.0,
    minHorizontal: 0.0,
    maxHorizontal: 0.9,
    upwardPreferred: true,
  },
  rhizome: {
    // Underground horizontal stem: shallow and flat, so new shoots surface.
    maxReach: 3.0,
    minY: -0.45,
    maxY: -0.05,
    minHorizontal: 0.75,
    maxHorizontal: 1.0,
  },
  culm: {
    // Hollow, fast, upright shoot.
    maxReach: 3.2,
    minY: 0.6,
    maxY: 1.0,
    minHorizontal: 0.0,
    maxHorizontal: 0.8,
    upwardPreferred: true,
  },
  pneumatophore: {
    // A breathing root grows *up* out of waterlogged soil, so it is a root-layer
    // part with an upward sector and almost no horizontal travel.
    maxReach: 2.2,
    minY: 0.2,
    maxY: 0.95,
    minHorizontal: 0.0,
    maxHorizontal: 0.9,
    upwardPreferred: true,
  },
  stolon: {
    // A runner lies above the soil and travels sideways: long internodes, very
    // little vertical travel.
    maxReach: 3.4,
    minY: -0.25,
    maxY: 0.3,
    minHorizontal: 0.85,
    maxHorizontal: 1.0,
  },
  tuber: {
    // A tuber is a short, thick swelling at the end of a rhizome.
    maxReach: 0.6,
    minY: -0.6,
    maxY: -0.1,
    minHorizontal: 0.0,
    maxHorizontal: 0.9,
  },
  thorn: {
    // A thorn is a short, rigid outgrowth of an existing shoot.
    maxReach: 0.9,
    minY: -0.2,
    maxY: 0.8,
    minHorizontal: 0.3,
    maxHorizontal: 1.0,
  },
  floating_leaf: {
    // A pad lies on the water surface: almost no vertical travel.
    maxReach: 1.6,
    minY: -0.15,
    maxY: 0.12,
    minHorizontal: 0.7,
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
  let clampedY = Math.max(constraints.minY, Math.min(constraints.maxY, dy));

  // The horizontal share has its own gene bounds, and clamping only Y left a
  // straight-up intent illegal: a vertical leaf became horizontal 0 while the
  // sector required at least 0.35, so the validator rejected the very vector
  // this clamp had just produced. Clamp the horizontal share too and take the
  // Y that belongs to it, then keep Y inside its own bounds.
  const yClampedH = Math.sqrt(Math.max(0, 1 - clampedY * clampedY));
  const clampedH = Math.max(
    constraints.minHorizontal,
    Math.min(constraints.maxHorizontal, yClampedH),
  );
  if (Math.abs(clampedH - yClampedH) > 1e-9) {
    const ySign = clampedY < 0 ? -1 : 1;
    const yForH = Math.sqrt(Math.max(0, 1 - clampedH * clampedH));
    clampedY = Math.max(constraints.minY, Math.min(constraints.maxY, ySign * yForH));
  }

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

/** How far a mutation bends new growth toward vertical or downward (0..1). */
export interface GrowthShapeBias {
  /** Columnar habit: canopy growth leans upright. */
  vertical: number;
  /** Drooping fronds: foliage hangs down. */
  droop: number;
}

/**
 * Bend a direction by the plant's mutation shape bias, then put it back inside
 * the gene sector for its node type.
 *
 * A mutation whose name promises a shape has to change where growth actually
 * goes, or `columnar_habit` is only a colour. The bias is applied as a lerp of
 * the vertical share and the result is clamped by the same gene rules every
 * other intent obeys, so a biased branch is still a legal branch.
 */
export function applyMutationShapeBias(
  nodeType: NodeType | string,
  dir: { x: number; y: number; z: number },
  bias: GrowthShapeBias | undefined,
  layer: 'root' | 'canopy',
): { x: number; y: number; z: number } {
  if (!bias) return { ...dir };
  const wantsVertical = layer === 'canopy' ? Math.min(1, Math.max(0, bias.vertical)) : 0;
  const isFoliage = nodeType === 'leaf' || nodeType === 'cotyledon';
  const wantsDroop = isFoliage ? Math.min(1, Math.max(0, bias.droop)) : 0;
  if (wantsVertical <= 0 && wantsDroop <= 0) return { ...dir };

  const length = Math.hypot(dir.x, dir.y, dir.z);
  let x = dir.x;
  let y = dir.y;
  let z = dir.z;
  if (length < 1e-4) {
    y = 0;
    x = 1;
    z = 0;
  } else {
    x /= length;
    y /= length;
    z /= length;
  }
  if (wantsVertical > 0) y += (1 - y) * wantsVertical;
  if (wantsDroop > 0) y -= (y + 1) * wantsDroop;

  const sign = y < 0 ? -1 : 1;
  const clampedY = Math.min(1, Math.abs(y));
  const targetH = Math.sqrt(Math.max(0, 1 - clampedY * clampedY));
  const currentH = Math.hypot(x, z);
  if (currentH > 1e-4) {
    x *= targetH / currentH;
    z *= targetH / currentH;
  } else {
    x = targetH;
    z = 0;
  }
  return clampGrowthDirectionByGene(nodeType, { x, y: sign * clampedY, z });
}
