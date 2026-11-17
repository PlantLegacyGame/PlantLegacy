/**
 * Atlas tile bookkeeping for the impostor baker.
 *
 * Tiles are keyed by plant id, not by the plant's index in the frame's plant
 * array. That array loses a plant whenever it dies or leaves interest, and every
 * plant after it shifts down by one; with index keys, plant N inherited plant
 * N-1's tile and drew its silhouette until it happened to be re-baked, and the
 * tile of a plant that was gone was never handed back, so the atlas slowly
 * filled with ghosts and then started evicting plants that were still on screen.
 */

export interface AtlasSlot {
  /** Tile column in the atlas. */
  column: number;
  /** Tile row in the atlas. */
  row: number;
}

export interface SlotGrant extends AtlasSlot {
  /** True when this call created the assignment. */
  assigned: boolean;
  /** Plant whose tile was taken; it no longer has an impostor. */
  evictedPlantId?: string;
}

interface Assignment extends AtlasSlot {
  lastUsed: number;
}

export class ImpostorAtlasSlots {
  private readonly assignments = new Map<string, Assignment>();
  /** One flag per tile, so a freed tile is reused before one is evicted. */
  private readonly occupied: boolean[];
  private readonly columns: number;
  private readonly rows: number;

  constructor(columns: number, rows: number) {
    this.columns = Math.max(1, Math.floor(columns));
    this.rows = Math.max(1, Math.floor(rows));
    this.occupied = new Array<boolean>(this.columns * this.rows).fill(false);
  }

  get capacity(): number {
    return this.columns * this.rows;
  }

  get size(): number {
    return this.assignments.size;
  }

  /** The tile `plantId` holds, without allocating one. */
  slotOf(plantId: string): AtlasSlot | undefined {
    const assignment = this.assignments.get(plantId);
    return assignment ? { column: assignment.column, row: assignment.row } : undefined;
  }

  /**
   * The tile for `plantId`, reusing the one it already holds.
   *
   * A full atlas takes the least recently used tile, and the result names its
   * previous owner. Returns null only when nothing can be evicted, which cannot
   * happen while the atlas has capacity.
   */
  acquire(plantId: string, now: number): SlotGrant | null {
    const existing = this.assignments.get(plantId);
    if (existing) {
      existing.lastUsed = now;
      return { column: existing.column, row: existing.row, assigned: false };
    }

    const free = this.occupied.indexOf(false);
    if (free >= 0) {
      return this.assign(plantId, free, now);
    }

    let lruId: string | null = null;
    let lruTime = Number.POSITIVE_INFINITY;
    for (const [id, assignment] of this.assignments) {
      if (assignment.lastUsed < lruTime) {
        lruTime = assignment.lastUsed;
        lruId = id;
      }
    }
    if (lruId === null) return null;

    const evicted = this.assignments.get(lruId);
    if (!evicted) return null;
    this.assignments.delete(lruId);
    const index = evicted.row * this.columns + evicted.column;
    return { ...this.assign(plantId, index, now), evictedPlantId: lruId };
  }

  /** Gives back the tiles of every plant that is not in `plantIds`. */
  retain(plantIds: ReadonlySet<string>): string[] {
    const released: string[] = [];
    for (const [id, assignment] of this.assignments) {
      if (plantIds.has(id)) continue;
      this.occupied[assignment.row * this.columns + assignment.column] = false;
      this.assignments.delete(id);
      released.push(id);
    }
    return released;
  }

  clear(): void {
    this.assignments.clear();
    this.occupied.fill(false);
  }

  private assign(plantId: string, index: number, now: number): SlotGrant {
    this.occupied[index] = true;
    const column = index % this.columns;
    const row = Math.floor(index / this.columns);
    this.assignments.set(plantId, { column, row, lastUsed: now });
    return { column, row, assigned: true };
  }
}
