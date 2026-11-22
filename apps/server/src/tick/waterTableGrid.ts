/**
 * The water-table height field around a plant's root, built a slice per tick.
 *
 * The field is 48x48 samples of terrain, and each sample is a five-tap regional
 * average, so a whole grid is 2,304 terrain evaluations - every one of them
 * fractal noise plus a river-path search. Built in one go (twice a second, in
 * the root readout) it was the last thing stopping the server's event loop:
 * measured as a ~100 ms stall each time it ran, seen from the outside as a ping
 * that drifted up to 150 ms on a loopback socket.
 *
 * The terrain does not move, so the work is not wrong - only the shape of it.
 * This builder pays one slice per tick (twenty calls a second instead of one),
 * and hands out whatever complete grid it last finished. While the root walks,
 * the newest finished grid is at most a few ticks behind the root's position,
 * and it carries its own origin, so a reader can never draw it in the wrong
 * place.
 */

export interface WaterTableGrid {
  originX: number;
  originZ: number;
  cellSizeM: number;
  cells: number;
  heightsBase64: string;
}

export interface WaterTableGridOptions {
  /** Samples along one side of the square field. */
  cells?: number;
  /** Spacing between samples, metres. */
  cellSizeM?: number;
  /** Samples taken per `advance`, so one call's cost is bounded. */
  chunkCells?: number;
  /** How far the centre may drift before a new field is started, metres. */
  moveToleranceM?: number;
}

const DEFAULTS = {
  cells: 48,
  cellSizeM: 2,
  // 576 samples is a quarter of a 48x48 field: four ticks (0.2 s at 20 Hz) from
  // an empty grid to a finished one, so a walking root never sees a stale table
  // it could notice. A tenth of that per tick would read as a lagging surface.
  chunkCells: 576,
  moveToleranceM: 0.5,
} as const;

interface Build {
  originX: number;
  originZ: number;
  heights: Float32Array;
  filled: number;
}

export class WaterTableGridBuilder {
  private readonly sample: (x: number, z: number) => number;
  private readonly cells: number;
  private readonly cellSizeM: number;
  private readonly chunkCells: number;
  private readonly moveToleranceM: number;
  private build: Build | null = null;
  private latest: WaterTableGrid | null = null;

  // Fields are assigned rather than declared as constructor parameter
  // properties: the server runs TypeScript through Node's strip-only mode, which
  // rejects that syntax.
  constructor(sample: (x: number, z: number) => number, options: WaterTableGridOptions = {}) {
    this.sample = sample;
    this.cells = Math.max(1, Math.round(options.cells ?? DEFAULTS.cells));
    this.cellSizeM = Math.max(0.01, options.cellSizeM ?? DEFAULTS.cellSizeM);
    this.chunkCells = Math.max(1, Math.round(options.chunkCells ?? DEFAULTS.chunkCells));
    this.moveToleranceM = Math.max(0, options.moveToleranceM ?? DEFAULTS.moveToleranceM);
  }

  /** The last finished field, or null before the first one is complete. */
  get grid(): WaterTableGrid | null {
    return this.latest;
  }

  /**
   * Take one slice of work toward the field centred on (centreX, centreZ).
   *
   * Returns the finished field when this call completed one, so a caller that
   * wants to act on "a new table is ready" does not have to compare identity.
   */
  advance(centreX: number, centreZ: number): WaterTableGrid | null {
    if (!Number.isFinite(centreX) || !Number.isFinite(centreZ)) return null;
    const originX = centreX - (this.cells / 2) * this.cellSizeM;
    const originZ = centreZ - (this.cells / 2) * this.cellSizeM;

    let build = this.build;
    if (!build) {
      // Nothing to do when the field already covers where the root is standing.
      const latest = this.latest;
      if (
        latest &&
        Math.abs(latest.originX - originX) <= this.moveToleranceM &&
        Math.abs(latest.originZ - originZ) <= this.moveToleranceM
      ) {
        return null;
      }
      // A build finishes where it started. Restarting on every step of a walking
      // root would mean never finishing one: at walking pace the root leaves a
      // 0.5 m tolerance in about three ticks, and a field takes four.
      build = {
        originX,
        originZ,
        heights: new Float32Array(this.cells * this.cells),
        filled: 0,
      };
      this.build = build;
    }

    const total = this.cells * this.cells;
    const end = Math.min(total, build.filled + this.chunkCells);
    for (let index = build.filled; index < end; index += 1) {
      const i = index % this.cells;
      const j = Math.floor(index / this.cells);
      build.heights[index] = this.sample(
        build.originX + (i + 0.5) * this.cellSizeM,
        build.originZ + (j + 0.5) * this.cellSizeM,
      );
    }
    build.filled = end;
    if (build.filled < total) return null;

    // A copy of the bytes, not the scratch buffer: the next field reuses it.
    const heightsBase64 = Buffer.from(
      new Uint8Array(build.heights.buffer, build.heights.byteOffset, build.heights.byteLength),
    ).toString('base64');
    this.latest = {
      originX: build.originX,
      originZ: build.originZ,
      cellSizeM: this.cellSizeM,
      cells: this.cells,
      heightsBase64,
    };
    this.build = null;
    return this.latest;
  }
}
