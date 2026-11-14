import type { PlantNode } from '@plant-legacy/shared/growth';

/** Edge length of one index cell, in world units. */
const DEFAULT_CELL_SIZE = 10;

/** Only the fields the index needs; a PlantNode satisfies this. */
export type IndexedNode = Pick<PlantNode, 'id' | 'x' | 'y' | 'z'>;

/**
 * Uniform-grid index of plant node ids.
 *
 * Roots from different plants compete by proximity, so every growth step needs
 * "which nodes are near this point" without walking all plants. This used to be
 * five private methods inside `PlantWorld`; it is world-independent, so it lives
 * on its own and can be tested or replaced without touching simulation code.
 */
export class NodeSpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly cellSize: number;

  constructor(cellSize: number = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize > 0 ? cellSize : DEFAULT_CELL_SIZE;
  }

  private key(x: number, y: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cy},${cz}`;
  }

  add(node: IndexedNode): void {
    const key = this.key(node.x, node.y, node.z);
    const cell = this.cells.get(key);
    if (cell) {
      cell.add(node.id);
    } else {
      this.cells.set(key, new Set([node.id]));
    }
  }

  remove(node: IndexedNode): void {
    const key = this.key(node.x, node.y, node.z);
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.delete(node.id);
    if (cell.size === 0) this.cells.delete(key);
  }

  /** Ids of every node in the cells overlapping the given sphere. */
  nearby(x: number, y: number, z: number, radius: number): string[] {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);

    const ids = new Set<string>();
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const cell = this.cells.get(`${cx},${cy},${cz}`);
          if (!cell) continue;
          for (const id of cell) ids.add(id);
        }
      }
    }
    return Array.from(ids);
  }
}
