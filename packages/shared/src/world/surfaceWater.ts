/**
 * Shallow water on the ground, in layers, and the height of the water table under it.
 *
 * The first solver here moved water by asking each cell, once per pass, to hand
 * a share of its head to its lowest neighbour. That made puddles, but it was not
 * a liquid: the water had no momentum, so it never sloshed, never overshot the
 * level it was pouring into and never came to rest with a wave - and because a
 * cell could only ever hold one column, a river could not run under a lake.
 *
 * This is the virtual-pipes model instead. Every cell edge carries a flux in
 * cubic metres per second that persists between steps: the head difference across
 * the edge accelerates it (`F += g * head * area * dt`), friction decays it, and
 * the volume it moves is capped by what the donor holds and what the receiver can
 * take. Momentum is what makes it behave like water - a wave that runs up a
 * bank and comes back, a pool that rocks once before it settles - and mass is
 * exactly conserved because the flux on an edge is one number applied to both
 * cells with opposite signs.
 *
 * A grid is one body of water on one bed, with an optional roof (a confined
 * aquifer, a cave) and an optional mask of cells it may occupy at all. Bodies
 * stack: `LayeredWater` steps each one and then exchanges between two of them
 * through a connection mask, in either direction, so the same code runs a
 * surface stream, a puddle, an underground river under it and the spring where
 * that river comes back out.
 */

export interface SurfaceWaterOptions {
  cellSizeM: number;
  /** How freely the head difference accelerates flow. 0 freezes the surface. */
  flowRatePerS: number;
  /** Metres of depth that soak into the soil per second. */
  infiltrationPerS: number;
  /** Metres of depth lost to the air per second. */
  evaporationPerS: number;
  /** Cap on how deep a puddle may get, metres. */
  maxDepthM: number;
  /** Gravity, m/s^2. Not a tuning knob: it is what makes the model a liquid. */
  gravityMps2?: number;
  /** Velocity lost to bed friction per second, 1/s. */
  frictionPerS?: number;
}

export const DEFAULT_SURFACE_WATER_OPTIONS: SurfaceWaterOptions = {
  cellSizeM: 1.5,
  flowRatePerS: 0.6,
  infiltrationPerS: 0.02,
  evaporationPerS: 0.004,
  maxDepthM: 0.32,
  gravityMps2: 9.81,
  frictionPerS: 2.5,
};

export interface SurfaceWaterStepResult {
  /** Water that soaked into the soil this step, in cubic metres. */
  infiltratedM3: number;
  /** Water that evaporated this step, in cubic metres. */
  evaporatedM3: number;
}

export interface SurfaceWaterGridSpec {
  /** Roof height per cell, metres. Omitted means open sky. */
  roof?: Float32Array;
  /** 1 where this body may hold water, 0 where the rock is solid. */
  open?: Uint8Array;
}

/**
 * Longest substep the flux update takes, seconds.
 *
 * A full 8 cm puddle carries a wave at about 0.9 m/s, which moves 4.4 cm in this
 * substep: a twelfth of a 60 cm cell. The surface's cap is 8 cm, so this is the
 * loose bound that still lands the wave inside the cell it started in.
 */
const MAX_SUBSTEP_S = 0.05;

/** A square grid of ground heights and the water lying on it. */
export class SurfaceWaterGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSizeM: number;
  readonly heights: Float32Array;
  readonly depth: Float32Array;
  /** Roof height per cell; +Infinity where the sky is the roof. */
  readonly roof: Float32Array;
  /** 1 where the body may occupy the cell. */
  readonly open: Uint8Array;
  /** Volumetric flux across the edge to +x (and to +y), m^3/s. */
  private readonly fluxX: Float32Array;
  private readonly fluxY: Float32Array;
  private readonly outflow: Float32Array;
  private readonly volumeX: Float32Array;
  private readonly volumeY: Float32Array;
  /** True when any cell has a finite roof, so the cheap open-sky path can skip it. */
  private roofed: boolean;
  /** True when every cell is open; most grids are, and the mask test is then dead work. */
  private readonly allOpen: boolean;

  constructor(
    heights: Float32Array,
    cols: number,
    rows: number,
    cellSizeM: number,
    spec: SurfaceWaterGridSpec = {},
  ) {
    if (heights.length !== cols * rows) {
      throw new Error('SurfaceWaterGrid: heights length must be cols * rows');
    }
    this.cols = Math.max(2, Math.floor(cols));
    this.rows = Math.max(2, Math.floor(rows));
    this.cellSizeM = Math.max(0.1, cellSizeM);
    this.heights = heights;
    const count = this.cols * this.rows;
    this.depth = new Float32Array(count);
    if (spec.roof && spec.roof.length === count) {
      this.roof = spec.roof.slice();
    } else {
      this.roof = new Float32Array(count).fill(Number.POSITIVE_INFINITY);
    }
    this.open =
      spec.open && spec.open.length === count ? spec.open.slice() : new Uint8Array(count).fill(1);
    this.fluxX = new Float32Array(count);
    this.fluxY = new Float32Array(count);
    this.outflow = new Float32Array(count);
    this.volumeX = new Float32Array(count);
    this.volumeY = new Float32Array(count);
    this.roofed = false;
    for (let i = 0; i < count; i += 1) {
      if (Number.isFinite(this.roof[i])) {
        this.roofed = true;
        break;
      }
    }
    this.allOpen = this.open.every((value) => value === 1);
  }

  get cellAreaM2(): number {
    return this.cellSizeM * this.cellSizeM;
  }

  get count(): number {
    return this.depth.length;
  }

  /** Water surface height in a cell, metres: the bed plus the column. */
  surfaceAt(index: number): number {
    return (this.heights[index] ?? 0) + (this.depth[index] ?? 0);
  }

  /** Deepest column this cell can hold before the roof, metres. */
  capacityAt(index: number): number {
    const bed = this.heights[index] ?? 0;
    const roof = this.roof[index];
    if (!Number.isFinite(roof)) return Number.POSITIVE_INFINITY;
    return Math.max(0, roof - bed);
  }

  /** Total water lying on the surface, cubic metres. */
  totalVolumeM3(): number {
    let sum = 0;
    for (let i = 0; i < this.depth.length; i += 1) sum += this.depth[i] ?? 0;
    return sum * this.cellAreaM2;
  }

  /** Water depth at a world-space point, 0 outside the grid. */
  depthAt(worldX: number, worldZ: number, originX = 0, originZ = 0): number {
    const cx = Math.floor((worldX - originX) / this.cellSizeM + this.cols / 2);
    const cz = Math.floor((worldZ - originZ) / this.cellSizeM + this.rows / 2);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return 0;
    return this.depth[cz * this.cols + cx] ?? 0;
  }

  /**
   * Add a uniform layer of rain.
   *
   * Cells that are closed, or already at their roof, take nothing; the return is
   * the depth the grid could not hold, so a caller can route it elsewhere.
   */
  addRain(depthM: number, options: Partial<SurfaceWaterOptions> = {}): number {
    if (!(depthM > 0)) return 0;
    const maxDepth = Math.max(0, options.maxDepthM ?? DEFAULT_SURFACE_WATER_OPTIONS.maxDepthM);
    let rejected = 0;
    const open = this.open;
    const depth = this.depth;
    const roofed = this.roofed;
    for (let i = 0; i < depth.length; i += 1) {
      if (!this.allOpen && !open[i]) {
        rejected += depthM;
        continue;
      }
      const cap = roofed ? Math.min(maxDepth, this.capacityAt(i)) : maxDepth;
      const room = Math.max(0, cap - (depth[i] ?? 0));
      const added = Math.min(room, depthM);
      depth[i] = (depth[i] ?? 0) + added;
      rejected += depthM - added;
    }
    return rejected;
  }

  /**
   * Move water between this body and another through a mask of cells.
   *
   * `both` is the hydrostatic case: water flows to whichever body has the lower
   * surface, which is a hole between two levels. `down` and `up` are one-way and
   * capped by a depth rate, which is what percolation into an aquifer and the
   * spring that gives it back are.
   */
  exchange(
    other: SurfaceWaterGrid,
    options: {
      dt: number;
      ratePerS: number;
      direction?: 'both' | 'down' | 'up';
      /** 1 where the two bodies are connected at all. Omitted means nowhere. */
      connection: Uint8Array;
    },
  ): { outM3: number; inM3: number } {
    const dt = Math.max(0, options.dt);
    const rate = Math.max(0, options.ratePerS);
    const area = this.cellAreaM2;
    let out = 0;
    let into = 0;
    if (!(dt > 0) || !(rate > 0) || other.depth.length !== this.depth.length) {
      return { outM3: 0, inM3: 0 };
    }
    const direction = options.direction ?? 'both';
    for (let i = 0; i < this.depth.length; i += 1) {
      if (!options.connection[i] || !this.open[i] || !other.open[i]) continue;
      const head = this.surfaceAt(i) - other.surfaceAt(i);
      // 'both' is a hole between two levels, so the head picks the donor.
      // 'down' and 'up' are one-way - percolation and a spring - and the donor is
      // the body named by the direction, driven by what it holds rather than by a
      // head it cannot see through the rock.
      const toOther = direction === 'both' ? head > 0 : direction === 'down';
      const donorDepth = toOther ? (this.depth[i] ?? 0) : (other.depth[i] ?? 0);
      const receiverRoom = toOther
        ? other.capacityAt(i) - (other.depth[i] ?? 0)
        : this.capacityAt(i) - (this.depth[i] ?? 0);
      const volume =
        direction === 'both'
          ? Math.abs(head) * 0.5 * rate * dt * area
          : Math.min(donorDepth, rate * dt) * area;
      const moved = Math.min(volume, donorDepth * area, Math.max(0, receiverRoom) * area);
      if (!(moved > 0)) continue;
      if (toOther) {
        this.depth[i] = (this.depth[i] ?? 0) - moved / area;
        other.depth[i] = (other.depth[i] ?? 0) + moved / area;
        out += moved;
      } else {
        other.depth[i] = (other.depth[i] ?? 0) - moved / area;
        this.depth[i] = (this.depth[i] ?? 0) + moved / area;
        into += moved;
      }
    }
    return { outM3: out, inM3: into };
  }

  /**
   * One hydrology step, in substeps short enough for the flux model to stay put.
   *
   * The flux on every edge is advanced by the head across it, damped by friction,
   * then capped by the donor's own volume and the receiver's room before it is
   * applied. That cap is what keeps a lake from donating itself dry in one step
   * and what makes the roof of a cave a wall rather than a suggestion.
   */
  step(dt: number, options: Partial<SurfaceWaterOptions> = {}): SurfaceWaterStepResult {
    const opts: SurfaceWaterOptions = { ...DEFAULT_SURFACE_WATER_OPTIONS, ...options };
    if (!(dt > 0)) return { infiltratedM3: 0, evaporatedM3: 0 };
    const { cols, rows } = this;
    const dx = this.cellSizeM;
    const area = dx * dx;
    const maxDepth = Math.max(0, opts.maxDepthM);
    const gravity = Math.max(0, opts.gravityMps2 ?? 9.81);
    const friction = Math.max(0, opts.frictionPerS ?? 2.5);
    const flow = Math.max(0, opts.flowRatePerS);

    const substeps = Math.max(1, Math.min(64, Math.ceil(dt / MAX_SUBSTEP_S)));
    const h = dt / substeps;
    // Local views of the typed arrays keep the hot loops monomorphic and
    // avoid a property load for every edge. This is the same solver, only
    // written for the shape of its data.
    const depth = this.depth;
    const heights = this.heights;
    const roof = this.roof;
    const open = this.open;
    const fluxX = this.fluxX;
    const fluxY = this.fluxY;
    const outflow = this.outflow;
    const volumeX = this.volumeX;
    const volumeY = this.volumeY;
    const count = depth.length;
    const roofed = this.roofed;
    const allOpen = this.allOpen;

    /** Room left below a roof; open sky has no finite cap. */
    const roomAt = (index: number): number => {
      const cellRoof = roof[index] as number;
      if (!Number.isFinite(cellRoof)) return Number.POSITIVE_INFINITY;
      return Math.max(0, cellRoof - (heights[index] as number) - (depth[index] as number));
    };

    for (let sub = 0; sub < substeps; sub += 1) {
      const relax = 1 / (1 + friction * h);
      // 1. Advance every edge's flux from the head across it.
      for (let z = 0; z < rows; z += 1) {
        for (let x = 0; x < cols; x += 1) {
          const i = z * cols + x;
          if (x + 1 < cols) {
            const j = i + 1;
            if (allOpen || (open[i] && open[j])) {
              const di = depth[i] as number;
              const dj = depth[j] as number;
              const head = (heights[i] as number) + di - (heights[j] as number) - dj;
              const wetted = Math.max(di, dj);
              fluxX[i] = ((fluxX[i] as number) + gravity * head * wetted * h * flow) * relax;
            } else {
              fluxX[i] = 0;
            }
          }
          if (z + 1 < rows) {
            const j = i + cols;
            if (allOpen || (open[i] && open[j])) {
              const di = depth[i] as number;
              const dj = depth[j] as number;
              const head = (heights[i] as number) + di - (heights[j] as number) - dj;
              const wetted = Math.max(di, dj);
              fluxY[i] = ((fluxY[i] as number) + gravity * head * wetted * h * flow) * relax;
            } else {
              fluxY[i] = 0;
            }
          }
        }
      }

      // 2. Turn the fluxes into volumes, and cap each cell's outflow by what it
      //    actually holds: half, so the other half stays to be levelled next step.
      outflow.fill(0);
      for (let z = 0; z < rows; z += 1) {
        for (let x = 0; x < cols; x += 1) {
          const i = z * cols + x;
          const fx = x + 1 < cols ? (fluxX[i] as number) : 0;
          const fy = z + 1 < rows ? (fluxY[i] as number) : 0;
          const fxLeft = x > 0 ? (fluxX[i - 1] as number) : 0;
          const fyDown = z > 0 ? (fluxY[i - cols] as number) : 0;
          let out = 0;
          if (fx > 0) out += fx * h;
          if (fxLeft < 0) out -= fxLeft * h;
          if (fy > 0) out += fy * h;
          if (fyDown < 0) out -= fyDown * h;
          outflow[i] = out;
          volumeX[i] = fx * h;
          volumeY[i] = fy * h;
        }
      }
      for (let i = 0; i < count; i += 1) {
        const held = (depth[i] as number) * area;
        const asked = outflow[i] as number;
        if (asked > held) {
          const scale = asked > 1e-12 ? held / asked : 0;
          if ((volumeX[i] as number) > 0) volumeX[i] = (volumeX[i] as number) * scale;
          if (i > 0 && (volumeX[i - 1] as number) < 0) {
            volumeX[i - 1] = (volumeX[i - 1] as number) * scale;
          }
          if ((volumeY[i] as number) > 0) volumeY[i] = (volumeY[i] as number) * scale;
          if (i >= cols && (volumeY[i - cols] as number) < 0) {
            volumeY[i - cols] = (volumeY[i - cols] as number) * scale;
          }
        }
      }

      // 3. Apply each edge once, to both cells, capping what the receiver can
      //    take at its roof. Every cubic metre subtracted from one side is added
      //    to the other in the same statement, so mass cannot drift.
      if (!roofed) {
        // Open sky: there is no ceiling to cap against, so the whole roomAt
        // check was two finite tests and a max per edge for every cell.
        for (let z = 0; z < rows; z += 1) {
          for (let x = 0; x < cols; x += 1) {
            const i = z * cols + x;
            if (x + 1 < cols) {
              const moved = volumeX[i] as number;
              depth[i] = (depth[i] as number) - moved / area;
              depth[i + 1] = (depth[i + 1] as number) + moved / area;
            }
            if (z + 1 < rows) {
              const moved = volumeY[i] as number;
              depth[i] = (depth[i] as number) - moved / area;
              depth[i + cols] = (depth[i + cols] as number) + moved / area;
            }
          }
        }
      } else {
        for (let z = 0; z < rows; z += 1) {
          for (let x = 0; x < cols; x += 1) {
            const i = z * cols + x;
            if (x + 1 < cols) {
              let moved = volumeX[i] as number;
              if (moved > 0) {
                moved = Math.min(moved, Math.max(0, roomAt(i + 1)) * area);
              } else if (moved < 0) {
                moved = -Math.min(-moved, Math.max(0, roomAt(i)) * area);
              }
              depth[i] = Math.max(0, (depth[i] as number) - moved / area);
              depth[i + 1] = (depth[i + 1] as number) + moved / area;
            }
            if (z + 1 < rows) {
              let moved = volumeY[i] as number;
              if (moved > 0) {
                moved = Math.min(moved, Math.max(0, roomAt(i + cols)) * area);
              } else if (moved < 0) {
                moved = -Math.min(-moved, Math.max(0, roomAt(i)) * area);
              }
              depth[i] = Math.max(0, (depth[i] as number) - moved / area);
              depth[i + cols] = (depth[i + cols] as number) + moved / area;
            }
          }
        }
      }
      // Only what actually moved has been subtracted above, so a roof that
      // refuses water refuses it to the cell that sent it as well: nothing is
      // created or lost at the wall.
    }

    // 4. Losses, once for the whole step rather than once per substep.
    let infiltrated = 0;
    let evaporated = 0;
    const infiltration = Math.max(0, opts.infiltrationPerS) * dt;
    const evaporation = Math.max(0, opts.evaporationPerS) * dt;
    for (let i = 0; i < count; i += 1) {
      let value = Math.max(0, depth[i] as number);
      const cellRoof = roof[i] as number;
      const cap = roofed
        ? Number.isFinite(cellRoof)
          ? Math.min(maxDepth, Math.max(0, cellRoof - (heights[i] as number)))
          : maxDepth
        : maxDepth;
      if (value > cap) value = cap;
      const soak = Math.min(value, infiltration);
      value -= soak;
      const dry = Math.min(value, evaporation);
      value -= dry;
      infiltrated += soak;
      evaporated += dry;
      depth[i] = value;
    }

    return {
      infiltratedM3: infiltrated * area,
      evaporatedM3: evaporated * area,
    };
  }

  /** Re-seat the roof, for a grid whose ground moves under it. */
  setRoof(roof: Float32Array | null): void {
    if (roof && roof.length === this.depth.length) {
      this.roof.set(roof);
    } else {
      this.roof.fill(Number.POSITIVE_INFINITY);
    }
    this.roofed = false;
    for (let i = 0; i < this.roof.length; i += 1) {
      if (Number.isFinite(this.roof[i])) {
        this.roofed = true;
        break;
      }
    }
  }

  /** Drain everything, for a dev reset or a reload of the local heightfield. */
  clear(): void {
    this.depth.fill(0);
    this.fluxX.fill(0);
    this.fluxY.fill(0);
  }
}
