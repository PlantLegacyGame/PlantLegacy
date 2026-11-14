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
  /** Announcements exclude the requester's own plant; syncs include it. */
  includeOwn?: boolean;
}

/**
 * The player's own plant always, plus every other plant whose root sits inside
 * the player's interest cells. Connectivity is deliberately not consulted.
 */
export function selectVisiblePlants<T extends PlantVisibilityLike>(
  options: SelectVisiblePlantsOptions<T>,
): T[] {
  const includeOwn = options.includeOwn ?? true;
  const visible: T[] = [];
  for (const plant of options.plants) {
    if (plant.id === options.ownPlantId) {
      if (includeOwn) visible.push(plant);
      continue;
    }
    const position = plantRootPosition(plant);
    if (!position) continue;
    if (options.isInRange(options.playerId, position.x, position.z)) {
      visible.push(plant);
    }
  }
  return visible;
}
