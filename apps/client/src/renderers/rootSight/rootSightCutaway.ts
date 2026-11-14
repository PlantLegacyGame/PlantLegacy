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

/** Smallest extent reported for a plant, in world units. */
const MIN_EXTENT = 0.05;
/** Inside this progress the plant is treated as still on the surface. */
const SURFACE_PROGRESS = 0.001;
/** Smallest cutaway, so a newly germinated seed still opens a usable view. */
const MIN_CUTAWAY_RADIUS = 0.7;
/**
 * The pit is drawn this many root-extents wide. The bowl mouth is only 70% of
 * this radius (see CAVITY_MOUTH_FRACTION), so the extent factor has to leave
 * room for the full root spread, not just the tip distance.
 */
const EXTENT_TO_RADIUS = 1.6;

/**
 * True for the parts that live under the soil line. Client nodes are placed in
 * world space, where a buried root still has a positive y because the whole
 * planet surface is lifted; relying on y < 0 made every root invisible to the
 * cavity sizing and pinned the pit at its minimum radius no matter how far the
 * roots spread.
 */
function underground(node: PlantNodeData): boolean {
  return (
    node.layer === 'root' ||
    node.isSeed === true ||
    node.nodeType === 'seed' ||
    node.nodeType === 'radicle' ||
    node.nodeType === 'root' ||
    node.nodeType === 'lateral_root' ||
    node.type === 0 ||
    node.position.y < -0.01
  );
}

/**
 * How far the player's underground growth reaches from its seed, in metres.
 *
 * Canopy nodes are deliberately excluded: a stem reaching two metres up must
 * not widen the root cavity by five metres. The seed itself is the anchor even
 * though it sits on the surface.
 */
export function plantExtent(nodes: Iterable<PlantNodeData>): number {
  const own: PlantNodeData[] = [];
  for (const node of nodes) {
    if (node.isOwnPlant) own.push(node);
  }
  if (own.length === 0) return MIN_EXTENT;

  const root = own.find((node) => node.parentId === null) ?? own[0];
  const roots = own.filter(underground);
  if (roots.length === 0) return MIN_EXTENT;

  let extent = MIN_EXTENT;
  for (const node of roots) {
    // A newly requested node is in the plant graph at its full target position
    // before its growth animation starts. Sizing the cavity from that target
    // opened the pit while the root was still a speck at the parent. The
    // server's growthProgress describes how much of the path is actually drawn,
    // so both reach and thickness wait for the node to grow.
    const grown = Math.min(1, Math.max(0, node.growthProgress ?? 1));
    if (grown <= 0) continue;
    const reach =
      Math.hypot(
        node.position.x - root.position.x,
        node.position.y - root.position.y,
        node.position.z - root.position.z,
      ) * grown;
    extent = Math.max(extent, reach + Math.max(0, node.radius || 0) * grown);
  }
  return extent;
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
): number {
  if (easedProgress <= SURFACE_PROGRESS) return configuredRadius;
  return Math.min(configuredRadius, Math.max(MIN_CUTAWAY_RADIUS, extent * EXTENT_TO_RADIUS));
}
