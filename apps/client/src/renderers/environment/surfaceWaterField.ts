/**
 * Standing water, as a field the ground shader reads.
 *
 * The rain puddles used to be geometry: a few dozen quads laid along the
 * terrain's tangents. A quad is a sheet, not a pool - its rim has to be fenced
 * off from the ground with lifts and depth biases, its circular shape is cut
 * into facets where it meets a slope, and no rule about drawing it can make it
 * fill the hollow it sits in. That is what read as a sticker pasted on the
 * terrain.
 *
 * This module owns the other half of the fix. The water itself is solved
 * (`SurfaceWaterGrid` from the shared world package: rain adds depth, the water
 * runs into hollows, soaks away and evaporates), and the result is packed into a
 * small texture around the player: R = the water's surface height, G = how damp
 * the soil is, B = how deep the water stands. The soil fragment shader compares
 * that surface with the ground it is shading, so the shoreline is exactly where
 * the drawn ground crosses the water plane - no polygon edge, no z-fighting, and
 * a pool that climbs a bank for the same reason real water does.
 *
 * The grid follows the player rather than the camera: the camera orbits metres
 * away on a zoom, and water that rebuilt itself under every orbit would slide
 * along the slope. It is only rebuilt when the player walks far enough to empty
 * the middle of it, and depth and dampness are carried across the move.
 */
import { SurfaceWaterGrid } from '@plant-legacy/shared/world';
import * as THREE from 'three';

/** Which precipitation the field is currently holding. */
export type SurfaceWaterMode = 'rain' | 'snow';

export interface SurfaceWaterFieldOptions {
  /** Samples per side. Cell size is `2 * extentM / cells`. */
  cells: number;
  /** Half the side of the square the field covers, metres. */
  extentM: number;
  /** Share of a head difference that equalises per second. */
  flowRatePerS: number;
  /** Metres of depth that soak into the soil per second. */
  infiltrationPerS: number;
  /** Metres of depth lost to the air per second. */
  evaporationPerS: number;
  /** Cap on standing depth, metres. */
  maxDepthM: number;
  /** Metres of rain added per second at full intensity. */
  rainDepthPerS: number;
  /** How dark the damp halo is drawn, 0..1. */
  dampOpacity: number;
  /** How fast damp ground dries, 1/s. */
  dampDryPerS: number;
  /** Cells the damp halo spreads beyond the water. */
  dampHaloCells: number;
  /** Texture uploads per second. */
  uploadHz: number;
  /** Solve a cave river under the surface as well. */
  underground: boolean;
  /** How far under the ground the cave river's bed lies, metres. */
  undergroundDepthM: number;
  /** How far under the ground its roof lies, metres: the aquifer's headroom. */
  undergroundRoofM: number;
  /** Depth rate at which a karst spring gives cave water back, m/s. */
  undergroundSpringPerS: number;
  /** How freely the cave river flows; it is confined, so it creeps. */
  undergroundFlowRatePerS: number;
}

export const DEFAULT_SURFACE_WATER_FIELD: SurfaceWaterFieldOptions = {
  cells: 160,
  extentM: 48,
  flowRatePerS: 0.9,
  infiltrationPerS: 0.0012,
  evaporationPerS: 0.00003,
  maxDepthM: 0.08,
  rainDepthPerS: 0.0005,
  dampOpacity: 0.5,
  dampDryPerS: 0.02,
  dampHaloCells: 1,
  uploadHz: 10,
  underground: true,
  undergroundDepthM: 2.4,
  undergroundRoofM: 0.5,
  undergroundSpringPerS: 0.02,
  undergroundFlowRatePerS: 0.5,
};

/**
 * The solver runs on a fixed step, whatever the frame rate is.
 *
 * The cadence is part of the simulation's timing, not just a budget: changing it
 * moves water at a different speed for the same frame time. It stays at 20 Hz
 * while the hot loops are optimized, so the shoreline keeps the motion it had.
 */
const SOLVER_HZ = 20;

/**
 * The cave river is hidden under the ground except through a cut, so it is
 * advanced every fourth tick. The surface still exchanges with it every tick;
 * only the flow inside the rock crawls, and that is invisible
 * from the surface while keeping springs fed.
 */
const CAVE_SOLVER_EVERY = 4;

/** The body of water solved under the surface: the cave river. */
export interface UndergroundWater {
  /** RGBA32F, packed like the surface: level, unused, depth, unused. */
  readonly texture: THREE.DataTexture;
  volumeM3(): number;
  depthAt(worldX: number, worldZ: number): number;
}

export interface SurfaceWaterField {
  /** RGBA32F: water surface height, dampness, depth, unused. */
  readonly texture: THREE.DataTexture;
  readonly cellSizeM: number;
  readonly cells: number;
  /** World XZ of the grid's lower-left corner. */
  readonly originX: number;
  readonly originZ: number;
  readonly options: SurfaceWaterFieldOptions;
  /** Increments whenever the texture is repacked. */
  readonly revision: number;
  /** Terrain the field is solved against, or null for a flat test world. */
  setTerrainSampler(sample: ((x: number, z: number) => number) | null): void;
  /** Fall this many metres of rain over the whole field. */
  addRain(depthM: number): void;
  setMode(mode: SurfaceWaterMode): void;
  /** Total water currently lying on the ground, cubic metres (dev readout). */
  volumeM3(): number;
  /** Mean depth as a fraction of the cap, 0..1: "is the ground wet at all". */
  coverage(): number;
  /** Water depth at a world XZ, 0 outside the field. */
  depthAt(worldX: number, worldZ: number): number;
  /** The cave river under this field, or null when it is not solved. */
  readonly underground: UndergroundWater | null;
  /** Which precipitation the field is holding. */
  mode(): SurfaceWaterMode;
  /**
   * Advance the solve and, at the configured rate, rewrite the texture.
   *
   * `anchorX`/`anchorZ` are where the player stands; the grid re-centres when
   * they walk far enough. `falling` is 0..1 - how hard it is coming down right
   * now - so a drizzle fills a hollow more slowly than a storm.
   */
  update(dt: number, anchorX: number, anchorZ: number, falling: number): void;
  dispose(): void;
}

export function createSurfaceWaterField(
  options: Partial<SurfaceWaterFieldOptions> = {},
): SurfaceWaterField {
  const opts: SurfaceWaterFieldOptions = { ...DEFAULT_SURFACE_WATER_FIELD, ...options };
  const cells = Math.max(8, Math.round(opts.cells));
  const extentM = Math.max(4, opts.extentM);
  const cellSizeM = (extentM * 2) / cells;
  const count = cells * cells;

  const heights = new Float32Array(count);
  const damp = new Float32Array(count);
  const grid = new SurfaceWaterGrid(heights, cells, cells, cellSizeM);

  // The cave river: the same solver on a bed two metres under this one, capped
  // by a roof, so it is a body in its own right rather than a second height on
  // the same column. It is sampled from the same terrain, so it runs under the
  // hollows the surface water runs into, and the ground between the two is what
  // the soil shader draws - the cave is visible only where the ground is cut.
  const caveHeights = new Float32Array(count);
  const caveRoof = new Float32Array(count);
  const springMask = new Uint8Array(count);
  const cave = new SurfaceWaterGrid(caveHeights, cells, cells, cellSizeM, { roof: caveRoof });
  const allCells = new Uint8Array(count).fill(1);

  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) data[i * 4 + 3] = 1;
  const texture = new THREE.DataTexture(data, cells, cells, THREE.RGBAFormat, THREE.FloatType);
  // Nearest, and the shader interpolates by hand: a float texture is not
  // filterable without an extension, and half-float would quantise a two
  // centimetre puddle into visible steps.
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const caveData = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) caveData[i * 4 + 3] = 1;
  const caveTexture = new THREE.DataTexture(
    caveData,
    cells,
    cells,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  caveTexture.minFilter = THREE.NearestFilter;
  caveTexture.magFilter = THREE.NearestFilter;
  caveTexture.wrapS = THREE.ClampToEdgeWrapping;
  caveTexture.wrapT = THREE.ClampToEdgeWrapping;
  caveTexture.needsUpdate = true;

  let sampler: ((x: number, z: number) => number) | null = null;
  let originX = Number.NaN;
  let originZ = Number.NaN;
  let mode: SurfaceWaterMode = 'rain';
  /** Cheap activity flags refreshed with each upload; a dry field skips the solve. */
  let hasWater = false;
  let hasCaveWater = false;
  /** Whether any ground is still dark with retreating water. */
  let hasDamp = false;
  let revision = 0;
  let solverAccumulator = 0;
  let solverTick = 0;
  let uploadAccumulator = 0;
  const uploadPeriod = 1 / Math.max(1, opts.uploadHz);

  /**
   * Where the cave roof outcrops, water can leave the cave. It is a fixed field
   * in world space rather than a random choice, so a spring stays where it is
   * and flows again after it has been drunk dry.
   */
  const isSpring = (wx: number, wz: number): boolean => {
    const v =
      Math.sin(wx * 0.19 + 0.7) * Math.cos(wz * 0.15 - 0.4) + 0.4 * Math.sin((wx + wz) * 0.37);
    return v > 1.12;
  };

  /** Sample the terrain under every cell, and the cave bed under that. */
  const sampleHeights = (): void => {
    for (let z = 0; z < cells; z += 1) {
      const wz = originZ + (z + 0.5) * cellSizeM;
      for (let x = 0; x < cells; x += 1) {
        const wx = originX + (x + 0.5) * cellSizeM;
        const i = z * cells + x;
        const ground = sampler ? sampler(wx, wz) : 0;
        heights[i] = ground;
        caveHeights[i] = ground - opts.undergroundDepthM;
        caveRoof[i] = ground - opts.undergroundRoofM;
        springMask[i] = isSpring(wx, wz) ? 1 : 0;
      }
    }
    cave.setRoof(caveRoof);
  };

  /**
   * Move the grid onto a new anchor, carrying what the ground already holds.
   *
   * Water belongs to a place, so the depth of every cell that still exists
   * after the move is copied across. A walk of a few metres then leaves the
   * pools where they are instead of draining them at the player's heels.
   */
  const recentre = (anchorX: number, anchorZ: number): void => {
    const nextOriginX = anchorX - extentM;
    const nextOriginZ = anchorZ - extentM;
    const previousX = originX;
    const previousZ = originZ;
    const hadPrevious = Number.isFinite(previousX) && Number.isFinite(previousZ);
    const previousDepth = hadPrevious ? grid.depth.slice() : null;
    const previousDamp = hadPrevious ? damp.slice() : null;
    const previousCave = hadPrevious ? cave.depth.slice() : null;
    originX = nextOriginX;
    originZ = nextOriginZ;
    sampleHeights();
    grid.clear();
    cave.clear();
    damp.fill(0);
    if (previousDepth && previousDamp) {
      for (let z = 0; z < cells; z += 1) {
        const wz = originZ + (z + 0.5) * cellSizeM;
        const pz = Math.floor((wz - previousZ) / cellSizeM);
        if (pz < 0 || pz >= cells) continue;
        for (let x = 0; x < cells; x += 1) {
          const wx = originX + (x + 0.5) * cellSizeM;
          const px = Math.floor((wx - previousX) / cellSizeM);
          if (px < 0 || px >= cells) continue;
          const i = z * cells + x;
          const j = pz * cells + px;
          grid.depth[i] = previousDepth[j] ?? 0;
          damp[i] = previousDamp[j] ?? 0;
          if (previousCave) cave.depth[i] = previousCave[j] ?? 0;
        }
      }
    }
  };

  const packTexture = (): void => {
    let wet = false;
    for (let i = 0; i < count; i += 1) {
      const depth = grid.depth[i] ?? 0;
      if (depth > 1e-6) wet = true;
      data[i * 4 + 0] = (heights[i] ?? 0) + depth;
      data[i * 4 + 1] = damp[i] ?? 0;
      data[i * 4 + 2] = depth;
    }
    hasWater = wet;
    texture.needsUpdate = true;

    // The cave river is packed the same way, minus the dampness: it has no
    // shoreline the soil shader could draw.
    let caveWet = false;
    for (let i = 0; i < count; i += 1) {
      const depth = cave.depth[i] ?? 0;
      if (depth > 1e-6) caveWet = true;
      caveData[i * 4 + 0] = (caveHeights[i] ?? 0) + depth;
      caveData[i * 4 + 1] = 0;
      caveData[i * 4 + 2] = depth;
    }
    hasCaveWater = caveWet;
    caveTexture.needsUpdate = true;
    revision += 1;
  };

  return {
    texture,
    underground: opts.underground
      ? {
          texture: caveTexture,
          volumeM3: () => cave.totalVolumeM3(),
          depthAt: (worldX: number, worldZ: number) =>
            cave.depthAt(worldX, worldZ, originX + extentM, originZ + extentM),
        }
      : null,
    cellSizeM,
    cells,
    get originX() {
      return originX;
    },
    get originZ() {
      return originZ;
    },
    options: opts,
    get revision() {
      return revision;
    },
    setTerrainSampler(sample) {
      sampler = sample;
      if (Number.isFinite(originX)) {
        sampleHeights();
        packTexture();
      }
    },
    addRain(depthM) {
      if (!(depthM > 0)) return;
      grid.addRain(depthM, { maxDepthM: opts.maxDepthM });
      hasWater = true;
    },
    setMode(next) {
      mode = next;
    },
    volumeM3() {
      return grid.totalVolumeM3();
    },
    depthAt(worldX: number, worldZ: number) {
      // The grid's own lookup is centred on its origin; this field's origin is
      // its lower-left corner, so the centre is half a side away.
      return grid.depthAt(worldX, worldZ, originX + extentM, originZ + extentM);
    },
    coverage() {
      let total = 0;
      for (let i = 0; i < count; i += 1) total += grid.depth[i] ?? 0;
      return Math.min(1, total / count / Math.max(0.01, opts.maxDepthM));
    },
    mode() {
      return mode;
    },
    update(dt, anchorX, anchorZ, falling) {
      if (!Number.isFinite(anchorX) || !Number.isFinite(anchorZ)) return;
      if (
        !Number.isFinite(originX) ||
        Math.hypot(anchorX - originX, anchorZ - originZ) > extentM * 0.5
      ) {
        recentre(anchorX, anchorZ);
      }
      if (!(dt > 0)) return;

      const surfaceActive = falling > 0 || hasWater;
      const caveActive = hasCaveWater;
      if (!surfaceActive && !caveActive) {
        // Nothing to route. The common state of the world is dry ground with no
        // rain, and walking the whole 36,000-cell solver for it was the single
        // largest cost in a camera frame. Dampness still dries, and the texture
        // still uploads at its normal rate, so a shore does not stay wet forever.
        if (!hasDamp) return;
        uploadAccumulator += dt;
        if (uploadAccumulator >= uploadPeriod) {
          const elapsed = uploadAccumulator;
          uploadAccumulator = 0;
          const dry = opts.dampDryPerS * elapsed;
          let anyDamp = false;
          for (let i = 0; i < count; i += 1) {
            const value = Math.max(0, (damp[i] ?? 0) - dry);
            damp[i] = value;
            if (value > 1e-5) anyDamp = true;
          }
          hasDamp = anyDamp;
          packTexture();
        }
        return;
      }

      // Snow settles where it falls and melts slowly; rain runs into hollows.
      if (falling > 0) {
        const rate = opts.rainDepthPerS * (mode === 'snow' ? 0.35 : 1) * falling;
        grid.addRain(rate * dt, { maxDepthM: opts.maxDepthM });
        hasWater = true;
      }

      solverAccumulator += Math.min(dt, 0.2);
      const step = 1 / SOLVER_HZ;
      let stepped = false;
      let ticks = 0;
      while (solverAccumulator >= step) {
        // One solve per frame. A slow frame used to catch up by running two or
        // three solver ticks back to back, which made the next frame slower
        // still. Water runs slightly behind during a hitch, then resumes; the
        // camera stays responsive instead of entering a feedback loop.
        if (ticks >= 1) {
          solverAccumulator = step;
          break;
        }
        solverAccumulator -= step;
        ticks += 1;
        stepped = true;
        solverTick += 1;
        if (mode === 'snow') {
          // Drifts do not flow. They melt into the soil at the infiltration
          // rate, which is what leaves the ground damp where a drift stood.
          for (let i = 0; i < count; i += 1) {
            // Melting is far slower than rain soaking in: a drift stands while it
            // falls and thaws over minutes, not seconds.
            const melt = Math.min(grid.depth[i] ?? 0, opts.infiltrationPerS * 0.05 * step);
            grid.depth[i] = (grid.depth[i] ?? 0) - melt;
          }
        } else {
          // Infiltration is not a loss here: it is the pipe into the cave river.
          // Only the body that actually holds water pays for a solve. An empty
          // cave under a puddle used to run 36,000 cells every tick too.
          if (surfaceActive) {
            grid.step(step, {
              flowRatePerS: opts.flowRatePerS,
              infiltrationPerS: 0,
              evaporationPerS: opts.evaporationPerS,
              maxDepthM: opts.maxDepthM,
            });
          }
          if (opts.underground && solverTick % CAVE_SOLVER_EVERY === 0) {
            // Rain that soaks away becomes the cave river's water, at the same
            // cell and the same rate the surface lost it. The two bodies are
            // stacked, and the exchange is the only path between them.
            if (surfaceActive) {
              const down = grid.exchange(cave, {
                dt: step * CAVE_SOLVER_EVERY,
                ratePerS: opts.infiltrationPerS,
                direction: 'down',
                connection: allCells,
              });
              if (down.outM3 > 0) hasCaveWater = true;
            }
            if (caveActive) {
              cave.step(step, {
                flowRatePerS: opts.undergroundFlowRatePerS,
                infiltrationPerS: 0,
                evaporationPerS: 0,
                maxDepthM: 2,
              });
            }
            // A spring is an outcrop: there the cave can give water back.
            grid.exchange(cave, {
              dt: step * CAVE_SOLVER_EVERY,
              ratePerS: opts.undergroundSpringPerS,
              direction: 'up',
              connection: springMask,
            });
          }
        }
      }

      uploadAccumulator += dt;
      if (uploadAccumulator >= uploadPeriod) {
        // Damp ground is the shoreline: it starts where water stands and dries
        // over the next half minute, so the shore outlives the puddle. It is
        // part of the texture upload, not the solve: doing it sixty times a
        // second changed nothing a player can see and cost a full field pass.
        const elapsed = uploadAccumulator;
        uploadAccumulator = 0;
        let anyDamp = hasDamp;
        if (stepped) {
          for (let i = 0; i < count; i += 1) {
            const depth = grid.depth[i] ?? 0;
            if (depth > 0.0004) {
              damp[i] = Math.max(damp[i] ?? 0, Math.min(1, 0.45 + depth * 8));
              anyDamp = true;
            }
          }
          for (let h = 0; h < Math.max(0, Math.round(opts.dampHaloCells)); h += 1) {
            const source = damp.slice();
            for (let z = 0; z < cells; z += 1) {
              for (let x = 0; x < cells; x += 1) {
                const i = z * cells + x;
                let near = damp[i] ?? 0;
                if (x > 0) near = Math.max(near, (source[i - 1] ?? 0) * 0.7);
                if (x < cells - 1) near = Math.max(near, (source[i + 1] ?? 0) * 0.7);
                if (z > 0) near = Math.max(near, (source[i - cells] ?? 0) * 0.7);
                if (z < cells - 1) near = Math.max(near, (source[i + cells] ?? 0) * 0.7);
                damp[i] = near;
              }
            }
          }
          const dry = opts.dampDryPerS * elapsed;
          for (let i = 0; i < count; i += 1) damp[i] = Math.max(0, (damp[i] ?? 0) - dry);
        }
        hasDamp = anyDamp;
        packTexture();
      }
    },
    dispose() {
      texture.dispose();
      // The cave river is a second texture, not a view of this one. It was
      // created here and never freed, so every world rebuild kept a full float
      // texture alive for the rest of the page's life.
      caveTexture.dispose();
    },
  };
}
