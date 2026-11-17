/**
 * Shallow water on the ground, and the height of the water table under it.
 *
 * The environment used to have no surface water at all. Rain streaks fell and
 * the soil shader darkened, but nothing ever lay on the ground, so a storm left
 * no puddles and water never appeared unless the player opened Root Sight.
 *
 * This module is a small, deterministic shallow-water solver on a height grid,
 * plus the one function that places the underground table. Water flows from a
 * cell to lower neighbours until the head is gone, which is enough to make
 * puddles form in dips, drain down slopes and slowly soak in.
 *
 * Mass is conserved exactly between cells. Every drop that leaves a cell lands
 * in exactly one neighbour or is returned by `step` as infiltrated water, so the
 * caller can recharge groundwater with what soaked away.
 */

export interface SurfaceWaterOptions {
  cellSizeM: number;
  /** Share of the head difference that equalises per second, 0..1. */
  flowRatePerS: number;
  /** Metres of depth that soak into the soil per second. */
  infiltrationPerS: number;
  /** Metres of depth lost to the air per second. */
  evaporationPerS: number;
  /** Cap on how deep a puddle may get, metres. */
  maxDepthM: number;
}

export const DEFAULT_SURFACE_WATER_OPTIONS: SurfaceWaterOptions = {
  cellSizeM: 1.5,
  flowRatePerS: 0.6,
  infiltrationPerS: 0.02,
  evaporationPerS: 0.004,
  maxDepthM: 0.32,
};

export interface SurfaceWaterStepResult {
  /** Water that soaked into the soil this step, in cubic metres. */
  infiltratedM3: number;
  /** Water that evaporated this step, in cubic metres. */
  evaporatedM3: number;
}

/** A square grid of ground heights and the water depth lying on it. */
export class SurfaceWaterGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSizeM: number;
  readonly heights: Float32Array;
  readonly depth: Float32Array;
  private readonly scratch: Float32Array;

  constructor(heights: Float32Array, cols: number, rows: number, cellSizeM: number) {
    if (heights.length !== cols * rows) {
      throw new Error('SurfaceWaterGrid: heights length must be cols * rows');
    }
    this.cols = Math.max(2, Math.floor(cols));
    this.rows = Math.max(2, Math.floor(rows));
    this.cellSizeM = Math.max(0.1, cellSizeM);
    this.heights = heights;
    this.depth = new Float32Array(heights.length);
    this.scratch = new Float32Array(heights.length);
  }

  get cellAreaM2(): number {
    return this.cellSizeM * this.cellSizeM;
  }

  /** Total water lying on the surface, cubic metres. */
  totalVolumeM3(): number {
    let sum = 0;
    for (let i = 0; i < this.depth.length; i += 1) sum += this.depth[i];
    return sum * this.cellAreaM2;
  }

  /** Water depth at a world-space point, 0 outside the grid. */
  depthAt(worldX: number, worldZ: number, originX = 0, originZ = 0): number {
    const cx = Math.floor((worldX - originX) / this.cellSizeM + this.cols / 2);
    const cz = Math.floor((worldZ - originZ) / this.cellSizeM + this.rows / 2);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return 0;
    return this.depth[cz * this.cols + cx];
  }

  /** Add a uniform layer of rain. Returns how much the cap rejected. */
  addRain(depthM: number, options: Partial<SurfaceWaterOptions> = {}): number {
    if (!(depthM > 0)) return 0;
    const maxDepth = options.maxDepthM ?? DEFAULT_SURFACE_WATER_OPTIONS.maxDepthM;
    let rejected = 0;
    for (let i = 0; i < this.depth.length; i += 1) {
      const room = Math.max(0, maxDepth - this.depth[i]);
      const added = Math.min(room, depthM);
      this.depth[i] += added;
      rejected += depthM - added;
    }
    return rejected;
  }

  /**
   * One hydrology step.
   *
   * Cells are visited in order and water moves to each lower neighbour whose
   * surface elevation is lower. Outflow from a cell is capped by what it holds
   * and by the head, so a full cell cannot donate more water than it has and a
   * shallow film cannot accelerate downhill. The pass is repeated with the
   * raised cells included, which lets a slope drain in one step instead of
   * dribbling one cell per tick.
   */
  step(dt: number, options: Partial<SurfaceWaterOptions> = {}): SurfaceWaterStepResult {
    const opts: SurfaceWaterOptions = { ...DEFAULT_SURFACE_WATER_OPTIONS, ...options };
    if (!(dt > 0)) return { infiltratedM3: 0, evaporatedM3: 0 };
    const { cols, rows } = this;
    const maxDepth = Math.max(0, opts.maxDepthM);
    const flow = Math.max(0, Math.min(1, opts.flowRatePerS)) * dt;

    this.scratch.fill(0);
    const delta = this.scratch;

    for (let pass = 0; pass < 2; pass += 1) {
      for (let z = 0; z < rows; z += 1) {
        for (let x = 0; x < cols; x += 1) {
          const i = z * cols + x;
          const available = this.depth[i] + delta[i];
          if (!(available > 1e-6)) continue;
          const surface = this.heights[i] + available;

          let remaining = available;
          for (let n = 0; n < 4; n += 1) {
            const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0);
            const nz = z + (n === 2 ? 1 : n === 3 ? -1 : 0);
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            const j = nz * cols + nx;
            const neighbourDepth = this.depth[j] + delta[j];
            const head = surface - (this.heights[j] + neighbourDepth);
            if (head <= 1e-5) continue;
            // Move at most the water that would level the two cells, scaled by
            // the flow rate, and never more than the cell holds.
            const move = Math.min(remaining, head * 0.5 * flow, maxDepth - neighbourDepth);
            if (!(move > 1e-7)) continue;
            delta[i] -= move;
            delta[j] += move;
            remaining -= move;
            if (remaining <= 1e-7) break;
          }
        }
      }
    }

    let infiltrated = 0;
    let evaporated = 0;
    const infiltration = Math.max(0, opts.infiltrationPerS) * dt;
    const evaporation = Math.max(0, opts.evaporationPerS) * dt;
    for (let i = 0; i < this.depth.length; i += 1) {
      let value = Math.max(0, this.depth[i] + delta[i]);
      if (value > maxDepth) value = maxDepth;
      const soak = Math.min(value, infiltration);
      value -= soak;
      const dry = Math.min(value, evaporation);
      value -= dry;
      infiltrated += soak;
      evaporated += dry;
      this.depth[i] = value;
    }

    return {
      infiltratedM3: infiltrated * this.cellAreaM2,
      evaporatedM3: evaporated * this.cellAreaM2,
    };
  }

  /** Drain everything, for a dev reset or a reload of the local heightfield. */
  clear(): void {
    this.depth.fill(0);
  }
}
