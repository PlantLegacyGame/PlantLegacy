/**
 * How the resource field addresses its cells.
 *
 * `ResourceWorld` used to depend on a flat 256x256 array: a cell was an array
 * index, and its neighbours were `index +/- 1`. That topology is wrong on a
 * sphere, where the last longitude cell touches the first and the cells near a
 * pole are narrower than at the equator.
 *
 * This module separates "which cell is this point in" and "who are its
 * neighbours" from the storage. The flat addressing reproduces the old
 * rectangular behaviour exactly; the spherical addressing hands those questions
 * to `SphericalTileGrid`, so the field's topology becomes the planet's without
 * changing the tile texture the client renders.
 */

import { SphericalTileGrid } from '@plant-legacy/shared/world';

export interface TileBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TileAddressing {
  readonly kind: 'flat' | 'spherical';
  /** Stable key for the cell containing a world position. */
  keyFor(worldX: number, worldZ: number): string;
  /** Centre of a cell, in world x/z. */
  centreOf(key: string): { x: number; z: number };
  /**
   * Neighbours of a cell. Every returned key is a cell that may exist; callers
   * drop the ones outside the simulated region.
   */
  neighboursOf(key: string): string[];
}

function clampIndex(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

export function createFlatAddressing(
  bounds: TileBounds,
  width: number,
  height: number,
  tileSize: number,
): TileAddressing {
  const tileX = (worldX: number): number =>
    clampIndex(Math.floor((worldX - bounds.minX) / tileSize), width - 1);
  const tileZ = (worldZ: number): number =>
    clampIndex(Math.floor((worldZ - bounds.minZ) / tileSize), height - 1);

  return {
    kind: 'flat',
    keyFor(worldX, worldZ) {
      return `${tileX(worldX)}:${tileZ(worldZ)}`;
    },
    centreOf(key) {
      const [x, z] = key.split(':').map(Number);
      return {
        x: bounds.minX + (x + 0.5) * tileSize,
        z: bounds.minZ + (z + 0.5) * tileSize,
      };
    },
    neighboursOf(key) {
      const [x, z] = key.split(':').map(Number);
      const neighbours: string[] = [];
      // Only cells inside the grid: a flat field ends at its edge.
      if (x > 0) neighbours.push(`${x - 1}:${z}`);
      if (x < width - 1) neighbours.push(`${x + 1}:${z}`);
      if (z > 0) neighbours.push(`${x}:${z - 1}`);
      if (z < height - 1) neighbours.push(`${x}:${z + 1}`);
      return neighbours;
    },
  };
}

export function createSphericalAddressing(radiusM: number, cellSizeM: number): TileAddressing {
  const grid = new SphericalTileGrid({ radiusM, cellSizeM });

  return {
    kind: 'spherical',
    keyFor(worldX, worldZ) {
      // The surface sits at y = 0 in the simulation's pole-local frame; the
      // radius is carried by the grid, not by the caller's height.
      return grid.cellKey(grid.cellForSurfacePoint(worldX, 0, worldZ));
    },
    centreOf(key) {
      const cell = grid.parseCellKey(key);
      if (!cell) throw new Error(`not a spherical cell key: ${key}`);
      const point = grid.cellToSurface(cell);
      return { x: point.x, z: point.z };
    },
    neighboursOf(key) {
      const cell = grid.parseCellKey(key);
      if (!cell) return [];
      return grid.neighbours(cell).map((neighbour) => grid.cellKey(neighbour));
    },
  };
}

/** Planet radius of 0 (or less) means the flat field the project started with. */
export function createTileAddressing(
  bounds: TileBounds,
  width: number,
  height: number,
  tileSize: number,
  planetRadiusM: number,
): TileAddressing {
  if (planetRadiusM > 0) return createSphericalAddressing(planetRadiusM, tileSize);
  return createFlatAddressing(bounds, width, height, tileSize);
}
