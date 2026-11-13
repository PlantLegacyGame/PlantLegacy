/**
 * Root Sight cutaway sizing.
 *
 * A fixed 50-unit cutaway around a seed was a crater with a speck in the
 * middle, so the pit is sized to the plant and capped by the configured radius.
 * That sizing is pure geometry, kept out of the transition code so the same
 * numbers can be reused by any pass that needs to know how big the hole is.
 */
import type { PlantNodeData } from '../plant/plantNodeData.js';

/** Smallest extent reported for a plant, in world units. */
const MIN_EXTENT = 0.05;
/** Inside this progress the plant is treated as still on the surface. */
const SURFACE_PROGRESS = 0.001;
/** Smallest cutaway, so a newly germinated seed still opens a usable view. */
const MIN_CUTAWAY_RADIUS = 1.2;
/** The pit is drawn this many plant-extents wide. */
const EXTENT_TO_RADIUS = 2.5;

/** How far the player's own plant reaches from its root, in world units. */
export function plantExtent(nodes: Iterable<PlantNodeData>): number {
  const own: PlantNodeData[] = [];
  for (const node of nodes) {
    if (node.isOwnPlant) own.push(node);
  }
  if (own.length === 0) return MIN_EXTENT;

  const root = own.find((node) => node.parentId === null) ?? own[0];
  let extent = MIN_EXTENT;
  for (const node of own) {
    extent = Math.max(
      extent,
      Math.hypot(
        node.position.x - root.position.x,
        node.position.y - root.position.y,
        node.position.z - root.position.z,
      ),
    );
  }
  return extent;
}

/**
 * Radius of the Root Sight cutaway for a transition progress.
 *
 * While the cutaway is closed the configured radius is reported unchanged; once
 * it starts opening, the pit grows to fit the plant but never past the cap.
 */
export function resolveCutawayRadius(
  extent: number,
  easedProgress: number,
  configuredRadius: number,
): number {
  if (easedProgress <= SURFACE_PROGRESS) return configuredRadius;
  return Math.min(configuredRadius, Math.max(MIN_CUTAWAY_RADIUS, extent * EXTENT_TO_RADIUS));
}
