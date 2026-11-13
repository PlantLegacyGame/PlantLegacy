/**
 * Latitude/longitude tile addressing on a sphere, with true neighbours.
 *
 * The flat resource grid addresses a tile by integer `x`/`z` and gets its
 * neighbours by adding or subtracting one, clamping at the array edge. On a
 * sphere that is wrong: the last longitude cell touches the first, the cells
 * near a pole are narrower than at the equator, and the "edge" wraps rather than
 * stopping.
 *
 * This module owns only the addressing. Cells are equal-angle latitude bands
 * (rings) cut into equal-longitude cells; a cell therefore has a real north,
 * south, east and west neighbour, east/west wrap around the planet and north/
 * south stop at the poles.
 *
 * Coordinates are the simulation's own: the pole is at `y = 0`, the planet's
 * centre is at `(0, -radiusM, 0)`, and `x`/`z` are metres on the tangent plane
 * at the pole. `cellToSurface` returns points in that same frame, so a caller
 * can keep flat authoring coordinates while addressing tiles on the sphere.
 */

export interface SphericalCell {
  /** Latitude band, 0 at the north pole through `ringCount - 1` at the south. */
  ring: number;
  /** Longitude cell within the ring, 0..cellsInRing(ring)-1. */
  index: number;
}

export interface SphericalGridOptions {
  /** Planet radius in metres. */
  radiusM: number;
  /** Target cell edge length in metres. */
  cellSizeM: number;
}

export interface SurfacePoint {
  x: number;
  y: number;
  z: number;
}

export class SphericalTileGrid {
  readonly radiusM: number;
  readonly cellSizeM: number;
  readonly ringCount: number;
  private readonly rings: number[];

  constructor(options: SphericalGridOptions) {
    if (!Number.isFinite(options.radiusM) || options.radiusM <= 0) {
      throw new Error('SphericalTileGrid needs a positive radius');
    }
    if (!Number.isFinite(options.cellSizeM) || options.cellSizeM <= 0) {
      throw new Error('SphericalTileGrid needs a positive cell size');
    }
    this.radiusM = options.radiusM;
    this.cellSizeM = options.cellSizeM;
    // Half a great circle is split into equal-angle bands. Because a band's
    // width shrinks toward the poles, its cell count is computed per ring
    // rather than being one global width.
    this.ringCount = Math.max(1, Math.round((Math.PI * this.radiusM) / this.cellSizeM));
    this.rings = [];
    for (let ring = 0; ring < this.ringCount; ring += 1) {
      const theta = ((ring + 0.5) / this.ringCount) * Math.PI;
      const circumference = 2 * Math.PI * this.radiusM * Math.sin(theta);
      this.rings.push(Math.max(1, Math.round(circumference / this.cellSizeM)));
    }
  }

  cellsInRing(ring: number): number {
    const clamped = this.clampRing(ring);
    return this.rings[clamped] ?? 1;
  }

  totalCells(): number {
    return this.rings.reduce((sum, count) => sum + count, 0);
  }

  /** True for a valid ring/index pair. */
  has(cell: SphericalCell): boolean {
    return (
      Number.isInteger(cell.ring) &&
      Number.isInteger(cell.index) &&
      cell.ring >= 0 &&
      cell.ring < this.ringCount &&
      cell.index >= 0 &&
      cell.index < this.cellsInRing(cell.ring)
    );
  }

  /**
   * The cell a point on the surface (or above it) belongs to. `y` is height
   * above the pole's tangent plane, so a root at negative `y` maps to the cell
   * it is underneath.
   */
  cellForSurfacePoint(x: number, y: number, z: number): SphericalCell {
    return this.cellForDirection(x, y + this.radiusM, z);
  }

  /** The cell a direction from the planet's centre belongs to. */
  cellForDirection(x: number, y: number, z: number): SphericalCell {
    const length = Math.hypot(x, y, z);
    if (length < 1e-9) return { ring: 0, index: 0 };

    const polar = Math.acos(clamp(y / length, -1, 1));
    const ring = Math.min(
      this.ringCount - 1,
      Math.max(0, Math.floor((polar / Math.PI) * this.ringCount)),
    );

    const longitude = Math.atan2(z, x);
    const u = (longitude + Math.PI) / (2 * Math.PI);
    const cells = this.cellsInRing(ring);
    const index = Math.min(cells - 1, Math.max(0, Math.floor(u * cells)));
    return { ring, index };
  }

  /** Centre of a cell, in the simulation's pole-local frame. */
  cellToSurface(cell: SphericalCell): SurfacePoint {
    const direction = this.cellCentreDirection(cell);
    return {
      x: direction.x * this.radiusM,
      y: direction.y * this.radiusM - this.radiusM,
      z: direction.z * this.radiusM,
    };
  }

  /** Unit direction from the planet's centre to the centre of a cell. */
  cellCentreDirection(cell: SphericalCell): SurfacePoint {
    const ring = this.clampRing(cell.ring);
    const cells = this.cellsInRing(ring);
    const index = ((cell.index % cells) + cells) % cells;
    const theta = ((ring + 0.5) / this.ringCount) * Math.PI;
    const phi = ((index + 0.5) / cells) * 2 * Math.PI - Math.PI;
    const sinTheta = Math.sin(theta);
    return {
      x: sinTheta * Math.cos(phi),
      y: Math.cos(theta),
      z: sinTheta * Math.sin(phi),
    };
  }

  /**
   * The four neighbours a cell has on the sphere. East and west wrap around the
   * planet; north and south stop at the poles, where the neighbour is the pole
   * ring itself. Duplicates are removed (a one-cell pole ring can only have one
   * northern neighbour).
   */
  neighbours(cell: SphericalCell): SphericalCell[] {
    const ring = this.clampRing(cell.ring);
    const cells = this.cellsInRing(ring);
    const index = ((cell.index % cells) + cells) % cells;

    const east = { ring, index: (index + 1) % cells };
    const west = { ring, index: (index - 1 + cells) % cells };
    const northRing = Math.max(0, ring - 1);
    const southRing = Math.min(this.ringCount - 1, ring + 1);
    const north = { ring: northRing, index: this.alignedIndex(ring, index, northRing) };
    const south = { ring: southRing, index: this.alignedIndex(ring, index, southRing) };

    const result: SphericalCell[] = [];
    const seen = new Set<string>();
    for (const candidate of [north, south, east, west]) {
      const key = this.cellKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(candidate);
    }
    return result;
  }

  /** Same longitude in another ring, so moving poleward does not spin the cell. */
  private alignedIndex(fromRing: number, index: number, toRing: number): number {
    if (toRing === fromRing) return index;
    const fromCells = this.cellsInRing(fromRing);
    const toCells = this.cellsInRing(toRing);
    if (toCells <= 1) return 0;
    const u = (index + 0.5) / fromCells;
    return Math.min(toCells - 1, Math.max(0, Math.floor(u * toCells)));
  }

  cellKey(cell: SphericalCell): string {
    return `${cell.ring}:${cell.index}`;
  }

  parseCellKey(key: string): SphericalCell | null {
    const match = /^(\d+):(\d+)$/.exec(key);
    if (!match) return null;
    const cell = { ring: Number(match[1]), index: Number(match[2]) };
    return this.has(cell) ? cell : null;
  }

  /** Metres along the surface between two cell centres, for tests and tooling. */
  cellCentreDistance(a: SphericalCell, b: SphericalCell): number {
    const da = this.cellCentreDirection(a);
    const db = this.cellCentreDirection(b);
    const dot = clamp(da.x * db.x + da.y * db.y + da.z * db.z, -1, 1);
    return Math.acos(dot) * this.radiusM;
  }

  private clampRing(ring: number): number {
    return Math.min(this.ringCount - 1, Math.max(0, Math.trunc(ring)));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
