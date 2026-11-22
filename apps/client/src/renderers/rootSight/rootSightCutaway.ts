/**
 * Root Sight cutaway sizing.
 *
 * A fixed 50-unit cutaway around a seed was a crater with a speck in the
 * middle, so the pit is sized to the plant and capped by the configured radius.
 * Only underground growth counts: the old version measured the whole plant, so
 * growing a tall stem enlarged the root cavity even though the roots had not
 * moved. That sizing is pure geometry, kept out of the transition code so the
 * same numbers can be reused by any pass that needs to know how big the hole is.
 */
import type { PlantNodeData } from '../plant/plantNodeData.js';

/**
 * Sizing rules for the cutaway, all from `config/root_sight.json`.
 *
 * They used to be four literals in this file (RULE_3): the configured radius
 * capped the pit but the floor, the extent factor and the smallest radius a
 * seedling could open were compiled in, so tuning the file could not change
 * the shape of the hole.
 */
export interface RootSightSizing {
  /** Smallest extent reported for a plant, metres (`min_extent_m`). */
  minExtentM: number;
  /** Inside this progress the plant is treated as still on the surface. */
  surfaceProgress: number;
  /** Smallest cutaway, so a germinated seed still opens a usable view. */
  minCutawayRadiusM: number;
  /**
   * The pit is drawn this many root-extents wide. The bowl mouth is only 70% of
   * this radius, so the factor leaves room for the full root spread.
   */
  extentToRadius: number;
}

/** Fallbacks matching `config/root_sight.json`, for tests and a failed load. */
export const DEFAULT_ROOT_SIGHT_SIZING: RootSightSizing = {
  minExtentM: 0.05,
  surfaceProgress: 0.001,
  minCutawayRadiusM: 0.7,
  extentToRadius: 1.6,
};

/**
 * True for the parts that live under the soil line. Client nodes are placed in
 * world space, where a buried root still has a positive y because the whole
 * planet surface is lifted; relying on y < 0 made every root invisible to the
 * cavity sizing and pinned the pit at its minimum radius no matter how far the
 * roots spread.
 */
function underground(node: PlantNodeData): boolean {
  // Type and layer only. The last test used to be `position.y < -0.01`, the
  // same absolute-world-Y assumption that was fixed for underground detection:
  // on a planet the soil line is not Y = 0, so a buried root on a rise has a
  // positive Y and a surface node near the pole can sit below zero. The type
  // flags describe the part; the height frame must come from the terrain.
  return (
    node.layer === 'root' ||
    node.isSeed === true ||
    node.nodeType === 'seed' ||
    node.nodeType === 'radicle' ||
    node.nodeType === 'root' ||
    node.nodeType === 'lateral_root' ||
    node.type === 0
  );
}

/**
 * How far the player's underground growth reaches from its seed, in metres.
 *
 * Canopy nodes are deliberately excluded: a stem reaching two metres up must
 * not widen the root cavity by five metres. The seed itself is the anchor even
 * though it sits on the surface.
 */
function ownRootExtent(
  nodes: Iterable<PlantNodeData>,
  sizing: RootSightSizing,
  horizontalOnly: boolean,
): number {
  const minExtent = Math.max(0.001, sizing.minExtentM);
  const own: PlantNodeData[] = [];
  for (const node of nodes) {
    if (node.isOwnPlant) own.push(node);
  }
  if (own.length === 0) return minExtent;

  const root = own.find((node) => node.parentId === null) ?? own[0];
  const roots = own.filter(underground);
  if (roots.length === 0) return minExtent;

  let extent = minExtent;
  for (const node of roots) {
    // A newly requested node is in the plant graph at its full target position
    // before its growth animation starts. Sizing the cavity from that target
    // opened the pit while the root was still a speck at the parent. The
    // server's growthProgress describes how much of the path is actually drawn,
    // so both reach and thickness wait for the node to grow.
    const grown = Math.min(1, Math.max(0, node.growthProgress ?? 1));
    if (grown <= 0) continue;
    const dx = node.position.x - root.position.x;
    const dz = node.position.z - root.position.z;
    const reach =
      (horizontalOnly
        ? Math.hypot(dx, dz)
        : Math.hypot(dx, node.position.y - root.position.y, dz)) * grown;
    extent = Math.max(extent, reach + Math.max(0, node.radius || 0) * grown);
  }
  return extent;
}

export function plantExtent(
  nodes: Iterable<PlantNodeData>,
  sizing: RootSightSizing = DEFAULT_ROOT_SIGHT_SIZING,
): number {
  return ownRootExtent(nodes, sizing, false);
}

/**
 * The same reach as `plantExtent`, measured horizontally.
 *
 * The cavity is a sphere and wants the 3D reach. The mouth is a circle in plan,
 * and sizing it from the 3D reach counted a taproot's depth as spread: a root
 * 1.7 m down with a 0.7 m spread opened a hole 2 m in radius, so the plant stood
 * at the edge of a crater instead of in a hole around its roots. Horizontal
 * reach, plus each part's own radius, is what the opening has to contain.
 */
export function plantLateralExtent(
  nodes: Iterable<PlantNodeData>,
  sizing: RootSightSizing = DEFAULT_ROOT_SIGHT_SIZING,
): number {
  return ownRootExtent(nodes, sizing, true);
}

/**
 * Radius of the Root Sight cutaway for a transition progress.
 *
 * While the cutaway is closed the configured radius is reported unchanged; once
 * it starts opening, the pit grows to fit the actual root spread but never past
 * the cap.
 */
export function resolveCutawayRadius(
  extent: number,
  easedProgress: number,
  configuredRadius: number,
  sizing: RootSightSizing = DEFAULT_ROOT_SIGHT_SIZING,
): number {
  if (easedProgress <= sizing.surfaceProgress) return configuredRadius;
  return Math.min(
    configuredRadius,
    Math.max(sizing.minCutawayRadiusM, extent * sizing.extentToRadius),
  );
}
