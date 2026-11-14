/**
 * Collider planning for a plant.
 *
 * The renderer already knows where every segment is drawn (`resolveSegmentFrame`
 * in the client), but the plan has to be pure so it can be unit-tested and so
 * the budget rules are one place. This module takes the node graph and returns
 * capsule/ball/cuboid shapes in world space; the Rapier layer only creates
 * bodies from them.
 *
 * The budget is the "cheat": per-segment capsules are accurate enough for
 * roots, stems, rain and the camera, but a 2000-node plant would cost 2000
 * colliders. Colliders are capped, leaf blades are dropped first, then
 * degree-2 chains are merged end-to-end. A merged chain is one capsule from the
 * start of the run to its end at the run's largest radius: it loses a wiggle,
 * never a whole branch.
 */

import type { Vec3 } from './collision.ts';

export interface ColliderNodeInput {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  z: number;
  /** Server-drawn radius, metres. */
  radius?: number;
  type?: string;
  /** Parent attachment point, if the node buds part-way along its parent. */
  parentAttachX?: number;
  parentAttachY?: number;
  parentAttachZ?: number;
  /** Only fully grown segments get colliders (a growing tip is not solid yet). */
  growthProgress?: number;
}

export type PlannedCollider =
  | {
      kind: 'capsule';
      nodeId: string;
      a: Vec3;
      b: Vec3;
      radius: number;
      /** Nodes merged into this capsule; 1 means a single segment. */
      mergedNodes: number;
    }
  | {
      kind: 'ball';
      nodeId: string;
      center: Vec3;
      radius: number;
      mergedNodes: 1;
    }
  | {
      kind: 'cuboid';
      nodeId: string;
      center: Vec3;
      /** Half extents in the blade's local frame. */
      halfExtents: Vec3;
      /** Blade direction; the collider's local +Y points along it. */
      axis: Vec3;
      mergedNodes: 1;
    };

export interface ColliderPlanOptions {
  /** Hard cap on generated colliders. */
  maxColliders: number;
  /** Radius added to every organ, metres. */
  inflationM: number;
  /** Floor for an organ radius, so nothing is infinitely thin. */
  minRadiusM: number;
  /** Add thin cuboids for leaves/cotyledons at close range. */
  includeLeafBlades: boolean;
  /** Skip segments still growing below this progress. */
  minGrowthProgress: number;
}

export const DEFAULT_COLLIDER_PLAN_OPTIONS: ColliderPlanOptions = {
  maxColliders: 192,
  inflationM: 0.005,
  minRadiusM: 0.004,
  includeLeafBlades: true,
  minGrowthProgress: 0.35,
};

export interface ColliderPlan {
  colliders: PlannedCollider[];
  /** Segments that would have existed without the budget. */
  totalSegments: number;
  /** How many chains were merged away. */
  mergedAway: number;
  /** True when even after merging the cap had to cut colliders. */
  truncated: boolean;
}

const RADIUS_FALLBACK = 0.012;

function radiusOf(node: ColliderNodeInput, options: ColliderPlanOptions): number {
  const raw = node.radius;
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : RADIUS_FALLBACK;
  return Math.max(options.minRadiusM, value) + options.inflationM;
}

function isLeaf(node: ColliderNodeInput): boolean {
  return node.type === 'leaf' || node.type === 'cotyledon';
}

function attachOf(node: ColliderNodeInput, parent: ColliderNodeInput): Vec3 {
  if (
    Number.isFinite(node.parentAttachX) &&
    Number.isFinite(node.parentAttachY) &&
    Number.isFinite(node.parentAttachZ)
  ) {
    return {
      x: node.parentAttachX as number,
      y: node.parentAttachY as number,
      z: node.parentAttachZ as number,
    };
  }
  return { x: parent.x, y: parent.y, z: parent.z };
}

function segmentLength(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function axisOf(a: Vec3, b: Vec3): Vec3 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len <= 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: dx / len, y: dy / len, z: dz / len };
}

/**
 * Plan the collider set for one plant.
 *
 * Nodes are read parent-first by walking from the roots, so a merged chain can
 * extend forwards along its run. Merging only applies to a node with exactly
 * one child, which is what keeps forks intact.
 */
export function planPlantColliders(
  nodes: readonly ColliderNodeInput[],
  overrides: Partial<ColliderPlanOptions> = {},
): ColliderPlan {
  const options: ColliderPlanOptions = { ...DEFAULT_COLLIDER_PLAN_OPTIONS, ...overrides };
  const byId = new Map<string, ColliderNodeInput>();
  for (const node of nodes) byId.set(node.id, node);

  const childCount = new Map<string, number>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
  }

  const capsules: Array<Extract<PlannedCollider, { kind: 'capsule' }>> = [];
  const balls: Array<Extract<PlannedCollider, { kind: 'ball' }>> = [];
  const blades: Array<Extract<PlannedCollider, { kind: 'cuboid' }>> = [];
  let totalSegments = 0;

  for (const node of nodes) {
    const progress = Number.isFinite(node.growthProgress) ? (node.growthProgress as number) : 1;
    if (progress < options.minGrowthProgress) continue;
    const radius = radiusOf(node, options);
    const parent = node.parentId ? byId.get(node.parentId) : undefined;

    if (!parent) {
      // A root node (seed or the post-germination crown) is a point collider.
      balls.push({
        kind: 'ball',
        nodeId: node.id,
        center: { x: node.x, y: node.y, z: node.z },
        radius,
        mergedNodes: 1,
      });
      continue;
    }

    const a = attachOf(node, parent);
    const b = { x: node.x, y: node.y, z: node.z };
    if (segmentLength(a, b) < 1e-4) continue;
    totalSegments += 1;
    capsules.push({
      kind: 'capsule',
      nodeId: node.id,
      a,
      b,
      radius,
      mergedNodes: 1,
    });

    if (options.includeLeafBlades && isLeaf(node)) {
      // A leaf is a paper-thin blade: a flattened box reads as a surface to the
      // rain and to a camera probe without the cost of a hull.
      const bladeLength = Math.min(0.45, Math.max(0.08, radius * 8));
      blades.push({
        kind: 'cuboid',
        nodeId: node.id,
        center: { x: b.x, y: b.y, z: b.z },
        halfExtents: {
          x: bladeLength * 0.35,
          y: 0.008,
          z: bladeLength * 0.5,
        },
        axis: axisOf(a, b),
        mergedNodes: 1,
      });
    }
  }

  // Leaf blades are the cheapest thing to lose: drop them before touching a
  // structural segment. Then merge degree-2 runs until the cap holds.
  let mergedAway = 0;
  const budget = Math.max(1, Math.round(options.maxColliders));
  let count = capsules.length + balls.length + blades.length;

  while (count > budget && blades.length > 0) {
    blades.pop();
    count -= 1;
  }

  if (count > budget) {
    // Chain merging walks each run forwards and retires the follow-on capsule.
    // A naive one-step merge leaves the parent pointing at a child that no
    // longer exists, so long chains collapsed into pairs and the cap then cut
    // live branches. Following the run to its end keeps whole branches.
    const byNode = new Map<string, Extract<PlannedCollider, { kind: 'capsule' }>>();
    for (const capsule of capsules) byNode.set(capsule.nodeId, capsule);
    const childrenOf = new Map<string, string[]>();
    for (const node of nodes) {
      if (!node.parentId) continue;
      const siblings = childrenOf.get(node.parentId);
      if (siblings) siblings.push(node.id);
      else childrenOf.set(node.parentId, [node.id]);
    }

    const removed = new Set<string>();
    for (const capsule of [...capsules]) {
      if (count <= budget) break;
      if (removed.has(capsule.nodeId)) continue;
      let currentId = capsule.nodeId;
      while (count > budget) {
        const children = (childrenOf.get(currentId) ?? []).filter(
          (id) => byNode.has(id) && !removed.has(id),
        );
        if (children.length !== 1) break;
        const childId = children[0];
        if (!childId) break;
        const childCapsule = byNode.get(childId);
        if (!childCapsule) break;
        capsule.b = childCapsule.b;
        capsule.radius = Math.max(capsule.radius, childCapsule.radius);
        capsule.mergedNodes += childCapsule.mergedNodes;
        removed.add(childId);
        byNode.delete(childId);
        count -= 1;
        mergedAway += 1;
        currentId = childId;
      }
    }
    for (let i = capsules.length - 1; i >= 0; i -= 1) {
      const capsule = capsules[i];
      if (capsule && removed.has(capsule.nodeId)) capsules.splice(i, 1);
    }
  }

  const truncated = balls.length + capsules.length + blades.length > budget;
  if (truncated) {
    // Last resort: keep the thickest (most structurally important) capsules.
    const sorted = [...capsules].sort((a, b) => b.radius - a.radius);
    const kept = sorted.slice(0, Math.max(0, budget - balls.length));
    capsules.length = 0;
    capsules.push(...kept);
  }

  return {
    colliders: [...balls, ...capsules, ...blades],
    totalSegments,
    mergedAway,
    truncated,
  };
}
