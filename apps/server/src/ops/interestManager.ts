import type { WorldConfig } from './world.ts';

export interface CellCoord {
  x: number;
  z: number;
}

export interface ClientInterest {
  playerId: string;
  cell: CellCoord;
  subscribedCells: Set<string>;
  entityCap: number;
  /**
   * False until the first tick after registration has announced the plants that
   * are already in range. Registering puts the client in its current cell, so
   * without this the first `updateClientPosition` reported "same cell, nothing
   * changed" and a player who joined next to a dozen plants was never sent any
   * of them: rivals only appeared once they walked a whole cell (64 m).
   */
  announced: boolean;
}

export interface EntityUpdate {
  entityId: string;
  entityType: 'plant';
  position: { x: number; y: number; z: number };
  detailLevel: 'L0' | 'L1' | 'L2';
  data: unknown;
}

export class InterestManager {
  private cellSize: number;
  private interestRingRadius: number;
  private readonly entityCap: number;
  private readonly detailDistances: { L0: number; L1: number; L2: number };

  private clientInterests = new Map<string, ClientInterest>();
  private cellEntities = new Map<string, Set<string>>(); // cellKey -> entityIds

  constructor(config: WorldConfig) {
    this.cellSize = config.cellSize;
    this.interestRingRadius = config.interestRingRadius;
    this.entityCap = config.perClientEntityCap;
    this.detailDistances = config.interestDetailDistances;
  }

  private getCellKey(coord: CellCoord): string {
    return `${coord.x},${coord.z}`;
  }

  private getCellCoord(x: number, z: number): CellCoord {
    return {
      x: Math.floor(x / this.cellSize),
      z: Math.floor(z / this.cellSize),
    };
  }

  private getCellKeyFromWorld(x: number, z: number): string {
    const coord = this.getCellCoord(x, z);
    return this.getCellKey(coord);
  }

  private getSubscribedCells(center: CellCoord): Set<string> {
    const cells = new Set<string>();
    for (let dx = -this.interestRingRadius; dx <= this.interestRingRadius; dx++) {
      for (let dz = -this.interestRingRadius; dz <= this.interestRingRadius; dz++) {
        const cell: CellCoord = { x: center.x + dx, z: center.z + dz };
        cells.add(this.getCellKey(cell));
      }
    }
    return cells;
  }

  registerClient(playerId: string, x: number, z: number): void {
    const cell = this.getCellCoord(x, z);
    const subscribedCells = this.getSubscribedCells(cell);

    const interest: ClientInterest = {
      playerId,
      cell,
      subscribedCells,
      entityCap: this.entityCap,
      announced: false,
    };

    this.clientInterests.set(playerId, interest);
  }

  unregisterClient(playerId: string): void {
    this.clientInterests.delete(playerId);
  }

  /**
   * Move a client's interest window. Returns true when the caller has to
   * announce the plants in range: on the first tick after registration (the
   * plants that were already there when the player joined) and whenever the
   * client's cell changes (a plant created while the player was elsewhere is
   * otherwise never sent to them).
   */
  updateClientPosition(playerId: string, x: number, z: number): boolean {
    const interest = this.clientInterests.get(playerId);
    if (!interest) return false;

    const newCell = this.getCellCoord(x, z);
    if (newCell.x === interest.cell.x && newCell.z === interest.cell.z) {
      if (interest.announced) return false;
      interest.announced = true;
      // Same cell, but nobody has announced this player's surroundings yet.
      return true;
    }

    // Update subscribed cells
    interest.cell = newCell;
    interest.subscribedCells = this.getSubscribedCells(newCell);
    interest.announced = true;
    return true;
  }

  addEntityToCell(entityId: string, x: number, z: number): void {
    const cellKey = this.getCellKeyFromWorld(x, z);
    if (!this.cellEntities.has(cellKey)) {
      this.cellEntities.set(cellKey, new Set());
    }
    this.cellEntities.get(cellKey)?.add(entityId);
  }

  removeEntityFromCell(entityId: string, x: number, z: number): void {
    const cellKey = this.getCellKeyFromWorld(x, z);
    const entities = this.cellEntities.get(cellKey);
    if (entities) {
      entities.delete(entityId);
      if (entities.size === 0) {
        this.cellEntities.delete(cellKey);
      }
    }
  }

  updateEntityPosition(
    entityId: string,
    oldX: number,
    oldZ: number,
    newX: number,
    newZ: number,
  ): void {
    this.removeEntityFromCell(entityId, oldX, oldZ);
    this.addEntityToCell(entityId, newX, newZ);
  }

  getEntitiesForClient(
    playerId: string,
    viewerX: number,
    viewerZ: number,
  ): Map<string, EntityUpdate> {
    const interest = this.clientInterests.get(playerId);
    if (!interest) return new Map();

    const entities = new Map<string, EntityUpdate>();
    let count = 0;

    for (const cellKey of interest.subscribedCells) {
      const cellEntities = this.cellEntities.get(cellKey);
      if (!cellEntities) continue;

      for (const entityId of cellEntities) {
        if (count >= interest.entityCap) break;

        // In a real implementation, we'd fetch the entity data here
        // For now, we just track that the entity is in range
        const detailLevel = this.getDetailLevel(entityId, viewerX, viewerZ);
        entities.set(entityId, {
          entityId,
          entityType: 'plant',
          position: { x: 0, y: 0, z: 0 }, // Placeholder
          detailLevel,
          data: null,
        });
        count++;
      }
      if (count >= interest.entityCap) break;
    }

    return entities;
  }

  private getDetailLevel(
    _entityId: string,
    _viewerX: number,
    _viewerZ: number,
  ): 'L0' | 'L1' | 'L2' {
    // This would need the entity's actual position
    // For now, return L0 as default
    return 'L0';
  }

  getDetailLevelFromDistance(distance: number): 'L0' | 'L1' | 'L2' {
    if (distance <= this.detailDistances.L0) return 'L0';
    if (distance <= this.detailDistances.L1) return 'L1';
    return 'L2';
  }

  /**
   * Whether a world position is inside a client's subscribed cells. Used to scope
   * broadcasts that carry a plant's geometry to the players who can see it.
   */
  isPositionInRange(playerId: string, x: number, z: number): boolean {
    const interest = this.clientInterests.get(playerId);
    if (!interest) return false;
    return interest.subscribedCells.has(this.getCellKeyFromWorld(x, z));
  }

  getSubscribedCellCount(playerId: string): number {
    const interest = this.clientInterests.get(playerId);
    return interest?.subscribedCells.size ?? 0;
  }

  getTotalTrackedEntities(): number {
    let total = 0;
    for (const entities of this.cellEntities.values()) {
      total += entities.size;
    }
    return total;
  }

  /** Get entity IDs in the player's subscribed cells. */
  getEntityIdsInRange(playerId: string): Set<string> {
    const interest = this.clientInterests.get(playerId);
    if (!interest) return new Set();

    const entityIds = new Set<string>();
    for (const cellKey of interest.subscribedCells) {
      const cellEntities = this.cellEntities.get(cellKey);
      if (cellEntities) {
        for (const entityId of cellEntities) {
          entityIds.add(entityId);
        }
      }
    }
    return entityIds;
  }

  /** D01: Dev action - set cell size */
  setCellSize(size: number): void {
    this.cellSize = size;
  }

  /** D01: Dev action - set interest ring radius */
  setRingRadius(radius: number): void {
    this.interestRingRadius = radius;
    // Recalculate subscribed cells for all clients
    for (const interest of this.clientInterests.values()) {
      interest.subscribedCells = this.getSubscribedCells(interest.cell);
    }
  }
}
