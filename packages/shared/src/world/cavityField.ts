/**
 * The cavity field: the union of underground plant envelopes and dug holes.
 *
 * Root Sight, the plant occlusion pass, the camera clamp and future terrain
 * colliders all need to answer "is this world point inside the open cavity?".
 * They used to answer it differently — the soil shader fused every root node,
 * while the plant pass tested one sphere — so roots inside the opening were
 * culled and roots outside it were drawn through dirt. This module is the one
 * answer.
 *
 * Bubbles are clustered before they are handed out. A 2000-node plant cannot
 * upload 2000 uniforms to a shader, and a hundred small bubbles describe the
 * same cavity as one large one. Clustering merges nearby nodes into a shared
 * bubble, keeping the furthest extent so no root loses its envelope.
 *
 * Pure: no THREE, no GPU types. The client uploads the bubbles; the server can
 * use the same field for tunnel/fill queries.
 */

export interface CavityPoint {
  x: number;
  y: number;
  z: number;
}

export interface CavityNodeInput extends CavityPoint {
  /** Stable id, used for priority ordering only. */
  id?: string;
  /** Drawn radius of the organ, metres. */
  radius: number;
  /** Lower sorts first; own-plant nodes are built with 0. */
  priority?: number;
}

export interface CavityBubble extends CavityPoint {
  radius: number;
}

export interface CavityFieldOptions {
  /** Hard cap on bubbles handed to shaders. */
  maxBubbles: number;
  /** Grid cell used to merge nearby nodes, metres. */
  mergeCellM: number;
  /** Extra clearance around every bubble, metres. */
  paddingM: number;
  /** Smallest bubble, so a hair-thin root still opens a visible window. */
  minBubbleRadiusM: number;
  /** Largest bubble, metres. */
  maxBubbleRadiusM: number;
  /** How far bubbles are buried below their node, as a fraction of radius. */
  buryFactor: number;
  /** Bubbles reserved for rival plants after the own plant is placed. */
  rivalBudget: number;
}

export const DEFAULT_CAVITY_OPTIONS: CavityFieldOptions = {
  maxBubbles: 64,
  mergeCellM: 0.6,
  paddingM: 0.12,
  minBubbleRadiusM: 0.12,
  maxBubbleRadiusM: 7,
  buryFactor: 0.7,
  rivalBudget: 24,
};

export interface CavityField {
  bubbles: CavityBubble[];
  /** Sphere containing every bubble: a cheap conservative bound. */
  coveringSphere: CavityBubble;
  /** Nodes that were dropped by the budget, for diagnostics/tests. */
  dropped: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

interface Cluster {
  x: number;
  y: number;
  z: number;
  radius: number;
  weight: number;
  priority: number;
  firstId: string | undefined;
}

function cellKey(x: number, y: number, z: number, cell: number): string {
  return `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
}

/**
 * Cluster nodes into bubbles.
 *
 * Clusters are keyed on a 3D grid, so two branches that pass within one cell
 * share one opening instead of z-fighting two envelopes at the same place. A
 * cluster's radius is the largest node radius seen plus the padding, not the
 * average: shrinking it would leave the thicker root poking through soil.
 */
function clusterNodes(nodes: readonly CavityNodeInput[], options: CavityFieldOptions): Cluster[] {
  const cell = Math.max(0.05, options.mergeCellM);
  const clusters = new Map<string, Cluster>();
  for (const node of nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) {
      continue;
    }
    const radius = Math.max(0, Number.isFinite(node.radius) ? node.radius : 0);
    const key = cellKey(node.x, node.y, node.z, cell);
    const existing = clusters.get(key);
    if (existing) {
      // Weighted centre: thicker organs pull the bubble towards themselves,
      // which keeps a trunk's opening centred on the trunk.
      const weight = existing.weight + Math.max(0.05, radius);
      existing.x = (existing.x * existing.weight + node.x * Math.max(0.05, radius)) / weight;
      existing.y = (existing.y * existing.weight + node.y * Math.max(0.05, radius)) / weight;
      existing.z = (existing.z * existing.weight + node.z * Math.max(0.05, radius)) / weight;
      existing.weight = weight;
      existing.radius = Math.max(existing.radius, radius);
      existing.priority = Math.min(existing.priority, node.priority ?? 1);
    } else {
      clusters.set(key, {
        x: node.x,
        y: node.y,
        z: node.z,
        radius,
        weight: Math.max(0.05, radius),
        priority: node.priority ?? 1,
        firstId: node.id,
      });
    }
  }
  return Array.from(clusters.values());
}

/**
 * Build the cavity for one frame of plant data.
 *
 * Own-plant nodes are placed first, then rivals up to `rivalBudget`, then any
 * remaining slots are filled by the largest clusters. A plant's own roots must
 * never be the ones dropped by the cap.
 */
export function buildCavityField(
  ownNodes: readonly CavityNodeInput[],
  rivalNodes: readonly CavityNodeInput[] = [],
  overrides: Partial<CavityFieldOptions> = {},
): CavityField {
  const options: CavityFieldOptions = { ...DEFAULT_CAVITY_OPTIONS, ...overrides };
  const maxBubbles = Math.max(1, Math.round(options.maxBubbles));
  const ownClusters = clusterNodes(
    ownNodes.map((node) => ({ ...node, priority: 0 })),
    options,
  );
  const rivalClusters = clusterNodes(
    rivalNodes.map((node) => ({ ...node, priority: node.priority ?? 1 })),
    options,
  );

  const sortBySize = (a: Cluster, b: Cluster): number => b.radius - a.radius;
  ownClusters.sort(sortBySize);
  rivalClusters.sort(sortBySize);

  const ownSlots = Math.max(1, maxBubbles - Math.max(0, options.rivalBudget));
  const selected: Cluster[] = [];
  selected.push(...ownClusters.slice(0, ownSlots));
  const remaining = maxBubbles - selected.length;
  if (remaining > 0) {
    selected.push(...rivalClusters.slice(0, Math.min(remaining, options.rivalBudget)));
  }
  if (selected.length < maxBubbles) {
    const rest = [...ownClusters.slice(ownSlots), ...rivalClusters.slice(options.rivalBudget)];
    rest.sort(sortBySize);
    selected.push(...rest.slice(0, maxBubbles - selected.length));
  }

  const dropped =
    ownClusters.length +
    rivalClusters.length -
    Math.min(selected.length, ownClusters.length + rivalClusters.length);

  const bubbles: CavityBubble[] = selected.map((cluster) => {
    const radius = clamp(
      cluster.radius + options.paddingM,
      options.minBubbleRadiusM,
      options.maxBubbleRadiusM,
    );
    return {
      x: cluster.x,
      // A bubble centred exactly on the node at the surface is half above the
      // ground and reads as a dome of sky. Burying most of it turns the same
      // sphere into a dug cavity whose mouth meets the surface.
      y: cluster.y - radius * clamp(options.buryFactor, 0, 1),
      z: cluster.z,
      radius,
    };
  });

  return {
    bubbles,
    coveringSphere: coveringSphereOf(bubbles),
    dropped: Math.max(0, dropped),
  };
}

/** Sphere containing every bubble. Radius 0 when the field is empty. */
export function coveringSphereOf(bubbles: readonly CavityBubble[]): CavityBubble {
  if (bubbles.length === 0) return { x: 0, y: 0, z: 0, radius: 0 };
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const bubble of bubbles) {
    cx += bubble.x;
    cy += bubble.y;
    cz += bubble.z;
  }
  cx /= bubbles.length;
  cy /= bubbles.length;
  cz /= bubbles.length;
  let radius = 0;
  for (const bubble of bubbles) {
    radius = Math.max(
      radius,
      Math.hypot(bubble.x - cx, bubble.y - cy, bubble.z - cz) + bubble.radius,
    );
  }
  return { x: cx, y: cy, z: cz, radius };
}

/**
 * Polynomial smooth-minimum distance to the cavity surface: negative inside,
 * zero at the wall. Matches the fusion the soil shader uses, so a point the CPU
 * calls "inside" is the point the shader cuts open.
 */
export function cavityDistance(
  field: CavityField,
  x: number,
  y: number,
  z: number,
  blendM = 0.5,
): number {
  if (field.bubbles.length === 0) return Number.POSITIVE_INFINITY;
  const k = Math.max(0.0001, blendM);
  let distance = Number.POSITIVE_INFINITY;
  for (const bubble of field.bubbles) {
    const d = Math.hypot(x - bubble.x, y - bubble.y, z - bubble.z) - bubble.radius;
    if (!Number.isFinite(distance)) {
      // First bubble: the smooth minimum is just d. Feeding Infinity into the
      // blend evaluates Infinity * 0 and turns the whole field into NaN.
      distance = d;
      continue;
    }
    const h = clamp(0.5 + (0.5 * (d - distance)) / k, 0, 1);
    distance = d + (distance - d) * h - k * h * (1 - h);
  }
  return distance;
}

/** True when the point is inside the open cavity, with optional clearance. */
export function cavityContains(field: CavityField, point: CavityPoint, clearanceM = 0): boolean {
  if (field.bubbles.length === 0) return false;
  return cavityDistance(field, point.x, point.y, point.z) <= -Math.max(0, clearanceM);
}

/**
 * Approximate entry/exit interval of a ray through the cavity.
 *
 * Used by the camera clamp and by tests. Sampling at a fraction of the smallest
 * bubble is exact enough for a clamp and far cheaper than solving every fused
 * surface; the result is conservative in both directions (it may report a
 * slightly longer span than the true fused surface).
 */
export function cavityRayRange(
  field: CavityField,
  origin: CavityPoint,
  direction: CavityPoint,
  maxDistanceM: number,
): { enter: number; exit: number } | null {
  if (field.bubbles.length === 0) return null;
  let smallest = Number.POSITIVE_INFINITY;
  for (const bubble of field.bubbles) smallest = Math.min(smallest, bubble.radius);
  const step = Math.max(0.05, Math.min(0.5, smallest * 0.25));
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!(length > 0) || !(maxDistanceM > 0)) return null;
  const dx = direction.x / length;
  const dy = direction.y / length;
  const dz = direction.z / length;

  let enter = -1;
  let exit = -1;
  for (let t = 0; t <= maxDistanceM; t += step) {
    const x = origin.x + dx * t;
    const y = origin.y + dy * t;
    const z = origin.z + dz * t;
    if (cavityDistance(field, x, y, z) <= 0) {
      if (enter < 0) enter = t;
      exit = t;
    } else if (enter >= 0) {
      break;
    }
  }
  return enter >= 0 ? { enter, exit } : null;
}
