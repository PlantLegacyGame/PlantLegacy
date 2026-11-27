/**
 * Which plants a player is entitled to see.
 *
 * Kept separate from the server class because the visibility rule has a subtle
 * property that is easy to regress: it must not depend on whether a player is
 * connected. `PLANT_CREATED` is only sent at creation, so anything that builds a
 * plant list from `players` (instead of from the world) silently hides every
 * offline player's plant - the plant keeps simulating and blocking tiles while
 * being invisible to everyone online.
 */

export interface PlantVisibilityLike {
  id: string;
  rootNodeId?: string | null;
  nodes: Map<string, { x: number; z: number }>;
}

export function plantRootPosition(plant: PlantVisibilityLike): { x: number; z: number } | null {
  const rootId = plant.rootNodeId;
  if (!rootId) return null;
  const root = plant.nodes.get(rootId);
  return root ? { x: root.x, z: root.z } : null;
}

export interface SelectVisiblePlantsOptions<T extends PlantVisibilityLike> {
  plants: Iterable<T>;
  playerId: string;
  /** The requesting player's own plant; null before a plant exists. */
  ownPlantId: string | null;
  isInRange: (playerId: string, x: number, z: number) => boolean;
  /**
   * Set when `plants` already came from the interest-cell index. The range
   * callback is then redundant; skipping it avoids a key allocation per plant
   * on joins and cell crossings.
   */
  prefiltered?: boolean;
  /** Announcements exclude the requester's own plant; syncs include it. */
  includeOwn?: boolean;
  /** Maximum plants returned; the requester's own plant is kept first. */
  limit?: number;
}

/**
 * The player's own plant always, plus every other plant whose root sits inside
 * the player's interest cells. Connectivity is deliberately not consulted.
 */
export function selectVisiblePlants<T extends PlantVisibilityLike>(
  options: SelectVisiblePlantsOptions<T>,
): T[] {
  const includeOwn = options.includeOwn ?? true;
  const cap =
    options.limit === undefined || !Number.isFinite(options.limit)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(options.limit));
  if (cap === 0) return [];
  const visible: T[] = [];
  const plants = Array.from(options.plants);

  // Keep the owner's own plant first even when the world list reaches the cap.
  const own = includeOwn ? plants.find((plant) => plant.id === options.ownPlantId) : undefined;
  if (own) visible.push(own);
  if (visible.length >= cap) return visible;

  for (const plant of plants) {
    if (plant.id === options.ownPlantId) {
      continue;
    }
    if (!options.prefiltered) {
      const position = plantRootPosition(plant);
      if (!position) continue;
      if (!options.isInRange(options.playerId, position.x, position.z)) continue;
    }
    visible.push(plant);
    if (visible.length >= cap) break;
  }
  return visible;
}
