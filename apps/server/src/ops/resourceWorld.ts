import type { ConfigFile } from '@plant-legacy/shared/config';
import { readArray, readInteger, readNumber, readNumberArray } from '@plant-legacy/shared/config';
import { clamp, lerp } from '@plant-legacy/shared/math';
import { createTileAddressing, type TileAddressing, type TileBounds } from './tileAddressing.ts';

export interface ResourcesConfig {
  tileSize: number;
  gridWidth: number;
  gridHeight: number;
  tileLightBase: number;
  dayNightCurve: number[];
  tileMoistureBase: number;
  rainGainPerS: number;
  evaporationPerS: number;
  temperatureBase: number;
  temperatureAmplitude: number;
  temperatureSunFactor: number;
  transpirationFactor: number;
  photosynthesisTempOptimum: number;
  photosynthesisTempRange: number;
  tileMineralsBase: number;
  absorptionPerS: number;
  absorptionRadius: number;
  deadRootDeposit: number;
  deadPlantDeposit: number;
  dungDeposit: number;
  fertilizerDeposit: number;
  photosynthesisRate: number;
  photosynthesisEnergyPerSecond: number;
  photosynthesisWaterPerEnergy: number;
  photosynthesisMineralPerEnergy: number;
  waterStatusFullFraction: number;
  mineralStatusFullFraction: number;
  nightTranspirationMultiplier: number;
  lightFactorCurve: [number, number][];
  moistureFactorCurve: [number, number][];
  mineralFactorCurve: [number, number][];
  /** A light change at or below this is not worth a broadcast. */
  lightDirtyThreshold: number;
  /** A moisture or mineral change at or below this is not worth a broadcast. */
  resourceDirtyThreshold: number;
  diffusionRate: number;
  maxAbsorptionPerTick: number;
  groundwaterBase: number;
  groundwaterCapacity: number;
  groundwaterInfiltrationFraction: number;
  /** Share of rainfall that reaches the deep store directly. */
  groundwaterRechargeFraction: number;
  groundwaterPercolationRate: number;
  groundwaterCapillaryRisePerS: number;
  groundwaterRootUptakeFraction: number;
  groundwaterRootReserveFraction: number;
  /** Fraction per second of the water-table head difference that flows downhill. */
  groundwaterFlowPerS?: number;
  /** Depth of an empty water table below the surface, in metres. */
  groundwaterTableDepthM?: number;
  /** Radius averaged to get the regional level the water table sits under. */
  groundwaterTableSmoothingM?: number;
  canopyShadeReduction: number;
  maxLight: number;
  maxMoisture: number;
  maxMinerals: number;
}

export interface TileResources {
  light: number;
  moisture: number;
  minerals: number;
  /** Water held below the root zone, in the same units as moisture. */
  groundwater?: number;
}

export interface DirtyTile {
  tileX: number;
  tileZ: number;
  light: number;
  moisture: number;
  minerals: number;
}

export interface ResourceWorldState {
  tiles: DirtyTile[];
  width: number;
  height: number;
  tileSize: number;
  tick: number;
}

/**
 * The tiles a plant's parts actually occupy, summarised.
 *
 * Every node counts, at any height: a root below the ground, a stem, a leaf over
 * it - all of them sit somewhere on the tile grid. A tile is included when any
 * part of a node's footprint touches it, even a sliver across the boundary, so
 * a part lying on a tile edge reports both sides. Tiles are deduplicated, so
 * each contributes once however many parts cover it.
 */
export interface PlantTileCoverage {
  count: number;
  avgLight: number;
  avgMoisture: number;
  avgMinerals: number;
  /** Water held below the root zone, averaged over the covered tiles. */
  avgGroundwater: number;
  /** First covered tile, for the dev panel's tile readout. */
  sample: { tileX: number; tileZ: number } | null;
}

export interface PhotosynthesisResult {
  /** Energy produced this step. Structural biomass only ever comes from node growth. */
  energyGain: number;
  /** Stored water consumed to fix carbon (transpiration), deducted by the caller. */
  waterCost: number;
  /** Stored minerals consumed as enzyme cofactors, deducted by the caller. */
  mineralCost: number;
}

/**
 * Optional config read. New physical tunables must not stop a config that
 * predates them from booting, so they fall back to the documented default.
 */
function optionalNumber(
  configs: Map<string, ConfigFile>,
  system: string,
  key: string,
): number | undefined {
  const entry = configs.get(system)?.values[key];
  if (!entry || (entry.type !== 'number' && entry.type !== 'integer')) return undefined;
  return entry.value as number;
}

export function loadResourcesConfig(configs: Map<string, ConfigFile>): ResourcesConfig {
  const lightFactorCurveRaw = readArray<[number, number][]>(
    configs,
    'resources',
    'light_factor_curve',
  );
  const moistureFactorCurveRaw = readArray<[number, number][]>(
    configs,
    'resources',
    'moisture_factor_curve',
  );
  const mineralFactorCurveRaw = readArray<[number, number][]>(
    configs,
    'resources',
    'mineral_factor_curve',
  );

  return {
    tileSize: readNumber(configs, 'resources', 'tile_size'),
    gridWidth: readInteger(configs, 'resources', 'grid_width'),
    gridHeight: readInteger(configs, 'resources', 'grid_height'),
    tileLightBase: readInteger(configs, 'resources', 'tile_light_base'),
    dayNightCurve: readNumberArray(configs, 'resources', 'day_night_curve'),
    tileMoistureBase: readInteger(configs, 'resources', 'tile_moisture_base'),
    rainGainPerS: readNumber(configs, 'resources', 'rain_gain_per_s'),
    evaporationPerS: readNumber(configs, 'resources', 'evaporation_per_s'),
    temperatureBase: readNumber(configs, 'resources', 'temperature_base'),
    temperatureAmplitude: readNumber(configs, 'resources', 'temperature_amplitude'),
    temperatureSunFactor: readNumber(configs, 'resources', 'temperature_sun_factor'),
    transpirationFactor: readNumber(configs, 'resources', 'transpiration_factor'),
    photosynthesisTempOptimum: readNumber(configs, 'resources', 'photosynthesis_temp_optimum'),
    photosynthesisTempRange: readNumber(configs, 'resources', 'photosynthesis_temp_range'),
    tileMineralsBase: readInteger(configs, 'resources', 'tile_minerals_base'),
    absorptionPerS: readNumber(configs, 'resources', 'absorption_per_s'),
    absorptionRadius: readNumber(configs, 'resources', 'absorption_radius'),
    deadRootDeposit: readNumber(configs, 'resources', 'dead_root_deposit'),
    deadPlantDeposit: readNumber(configs, 'resources', 'dead_plant_deposit'),
    dungDeposit: readNumber(configs, 'resources', 'dung_deposit'),
    fertilizerDeposit: readNumber(configs, 'resources', 'fertilizer_deposit'),
    photosynthesisRate: readNumber(configs, 'resources', 'photosynthesis_rate'),
    photosynthesisEnergyPerSecond: readNumber(
      configs,
      'resources',
      'photosynthesis_energy_per_second',
    ),
    photosynthesisWaterPerEnergy: readNumber(
      configs,
      'resources',
      'photosynthesis_water_per_energy',
    ),
    photosynthesisMineralPerEnergy: readNumber(
      configs,
      'resources',
      'photosynthesis_mineral_per_energy',
    ),
    waterStatusFullFraction: readNumber(configs, 'resources', 'water_status_full_fraction'),
    mineralStatusFullFraction: readNumber(configs, 'resources', 'mineral_status_full_fraction'),
    nightTranspirationMultiplier: readNumber(
      configs,
      'resources',
      'night_transpiration_multiplier',
    ),
    lightFactorCurve: lightFactorCurveRaw,
    moistureFactorCurve: moistureFactorCurveRaw,
    mineralFactorCurve: mineralFactorCurveRaw,
    lightDirtyThreshold: readNumber(configs, 'resources', 'light_dirty_threshold'),
    resourceDirtyThreshold: readNumber(configs, 'resources', 'resource_dirty_threshold'),
    diffusionRate: readNumber(configs, 'resources', 'diffusion_rate'),
    maxAbsorptionPerTick: readNumber(configs, 'resources', 'max_absorption_per_tick'),
    groundwaterBase: readInteger(configs, 'resources', 'groundwater_base'),
    groundwaterCapacity: readInteger(configs, 'resources', 'groundwater_capacity'),
    groundwaterInfiltrationFraction: readNumber(
      configs,
      'resources',
      'groundwater_infiltration_fraction',
    ),
    groundwaterPercolationRate: readNumber(configs, 'resources', 'groundwater_percolation_rate'),
    groundwaterCapillaryRisePerS: readNumber(
      configs,
      'resources',
      'groundwater_capillary_rise_per_s',
    ),
    groundwaterRootUptakeFraction: readNumber(
      configs,
      'resources',
      'groundwater_root_uptake_fraction',
    ),
    groundwaterRootReserveFraction: readNumber(
      configs,
      'resources',
      'groundwater_root_reserve_fraction',
    ),
    groundwaterRechargeFraction:
      optionalNumber(configs, 'resources', 'groundwater_recharge_fraction') ?? 0.5,
    groundwaterFlowPerS: optionalNumber(configs, 'resources', 'groundwater_flow_per_s') ?? 0.35,
    groundwaterTableDepthM:
      optionalNumber(configs, 'resources', 'groundwater_table_depth_m') ?? 2.5,
    groundwaterTableSmoothingM:
      optionalNumber(configs, 'resources', 'groundwater_table_smoothing_m') ?? 5,
    canopyShadeReduction: readNumber(configs, 'resources', 'canopy_shade_reduction'),
    maxLight: readInteger(configs, 'resources', 'max_light'),
    maxMoisture: readInteger(configs, 'resources', 'max_moisture'),
    maxMinerals: readInteger(configs, 'resources', 'max_minerals'),
  };
}

export interface PlantNodeForResource {
  id: string;
  plantId: string;
  type: string;
  layer: 'root' | 'canopy';
  x: number;
  y: number;
  z: number;
  /** Drawn radius in metres; used to find every tile the part overlaps. */
  radius?: number;
  resourceDrawWater: number;
  resourceDrawNutrients: number;
  resourceDrawMinerals?: number;
  upkeepBiomassPerSecond: number;
  isSeed?: boolean;
  statModifiers?: { photosynthesis?: number };
}

export interface PlantForResource {
  id: string;
  ownerId: string;
  worldId: string;
  nodes: Map<string, PlantNodeForResource>;
  totalBiomass: number;
  totalUpkeep: number;
  rootNodeId: string;
  /** Plant-owned stores: what this plant has captured and may spend. */
  storedWater: number;
  storedMinerals: number;
  waterCapacity: number;
  mineralCapacity: number;
}

// Broadcast a tile to clients only when a resource component has changed by
// more than this amount since it was last sent. Prevents full-grid rebroadcasts
// every tick from slow drift (day/night light, diffusion).
/** How often the whole-grid soil passes run (moisture, minerals, diffusion). */
const SOIL_STEP_INTERVAL_S = 0.25;

export class ResourceWorld {
  // Resources live on addressed cells, not on array slots. The flat addressing
  // makes this one cell per lattice tile (the previous behaviour), and the
  // spherical one makes the cells the planet's lat/lon cells, whose neighbours
  // wrap around the planet instead of stopping at the array edge. The 256x256
  // lattice is kept as a sampling view so the client's texture contract is
  // unchanged.
  private readonly cells: TileResources[] = [];
  private readonly cellKeys: string[] = [];
  private readonly cellCentres: Array<{ x: number; z: number }> = [];
  private readonly cellNeighbours: number[][] = [];
  private readonly cellIndex = new Map<string, number>();
  private readonly tilesByCell: number[][] = [];
  private readonly addressing: TileAddressing;
  private tileCells: Int32Array;
  private readonly width: number;
  private readonly height: number;
  private readonly config: ResourcesConfig;
  private readonly worldBounds: TileBounds;
  private timeOfDay = 0.5;
  private tick = 0;
  // Soil passes (moisture, minerals, diffusion) recompute the whole 65k-tile
  // grid and dirty every tile; at 20 Hz that alone dominated a tick. They run
  // on their own accumulator at 4 Hz instead, with the full elapsed dt, so the
  // rates are unchanged - only the recompute cost drops 5x. Light stays
  // per-tick: it is what the plant reads and it only dirties tiles that change.
  private soilAccumulatorS = 0;
  private hasBroadcast = false;
  private firstBroadcast = true;
  private dirtyCells = new Set<number>();
  private lastBroadcastLight = new Map<number, number>();
  private lastBroadcastMoisture = new Map<number, number>();
  private lastBroadcastMinerals = new Map<number, number>();
  /**
   * Terrain height at a world point. Groundwater flow needs the real shape of
   * the ground, otherwise "downhill" is meaningless; 0 is a flat fallback for
   * tests and for a world whose terrain has not been configured yet.
   */
  private surfaceHeightProvider: ((x: number, z: number) => number) | null = null;
  /**
   * Terrain height before any digging. The water table is measured against this
   * and not against the edited surface: a root tunnel does not lower the region's
   * groundwater, it simply opens a hole that the existing table fills.
   */
  private baseHeightProvider: ((x: number, z: number) => number) | null = null;

  constructor(config: ResourcesConfig, worldBounds: TileBounds, planetRadiusM = 0) {
    this.config = config;
    this.worldBounds = worldBounds;
    this.width = config.gridWidth;
    this.height = config.gridHeight;
    this.addressing = createTileAddressing(
      worldBounds,
      this.width,
      this.height,
      config.tileSize,
      planetRadiusM,
    );
    this.tileCells = new Int32Array(this.width * this.height);
    this.buildCells();
  }

  /** Inject the terrain field the water table drains along. */
  setSurfaceHeightProvider(provider: (x: number, z: number) => number): void {
    this.surfaceHeightProvider = provider;
    this.regionalHeights = null;
  }

  /** Inject the undug terrain field used to place the water table. */
  setBaseHeightProvider(provider: (x: number, z: number) => number): void {
    this.baseHeightProvider = provider;
    this.regionalHeights = null;
  }

  /**
   * Regional ground level at every cell centre, computed once.
   *
   * The terrain the world is drawn from does not move, so this is a constant per
   * cell. Groundwater flow used to recompute it - five fractal-noise and
   * river-path evaluations per cell - on every soil step, four times a second.
   * On this world that is a few hundred thousand terrain lookups in one tick, and
   * the profile put 60% of the server's CPU inside them: the event loop stopped
   * for ~500 ms at a time and a WebSocket round trip on loopback measured
   * 150-500 ms because of it. Caching it is not an approximation; it is the same
   * number, read once.
   */
  private regionalHeights: Float64Array | null = null;

  private regionalHeightsByCell(): Float64Array {
    if (this.regionalHeights) return this.regionalHeights;
    const heights = new Float64Array(this.cells.length);
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const centre = this.cellCentres[cell];
      heights[cell] = this.regionalHeightAt(centre.x, centre.z);
    }
    this.regionalHeights = heights;
    return heights;
  }

  private surfaceHeightAt(x: number, z: number): number {
    return this.surfaceHeightProvider?.(x, z) ?? 0;
  }

  private baseHeightAt(x: number, z: number): number {
    return this.baseHeightProvider?.(x, z) ?? this.surfaceHeightAt(x, z);
  }

  /**
   * Regional ground level: the base terrain averaged over a few metres.
   *
   * A water table is a level, not a copy of the ground. Measuring it against the
   * point's own height made it dip into every hollow and follow every dug tunnel
   * down, so no hollow ever held water. A smooth regional level lets low ground
   * sit *below* the table and pool, which is what makes nearby pools connect.
   */
  private regionalHeightAt(x: number, z: number): number {
    const r = Math.max(0, this.config.groundwaterTableSmoothingM ?? 5);
    if (r <= 0) return this.baseHeightAt(x, z);
    return (
      (this.baseHeightAt(x, z) +
        this.baseHeightAt(x + r, z) +
        this.baseHeightAt(x - r, z) +
        this.baseHeightAt(x, z + r) +
        this.baseHeightAt(x, z - r)) /
      5
    );
  }

  /** One resource record per cell, plus the lattice tiles that sample each. */
  private buildCells(): void {
    const tileSize = this.config.tileSize;
    for (let tileZ = 0; tileZ < this.height; tileZ += 1) {
      for (let tileX = 0; tileX < this.width; tileX += 1) {
        const tile = this.index(tileX, tileZ);
        const centreX = this.worldBounds.minX + (tileX + 0.5) * tileSize;
        const centreZ = this.worldBounds.minZ + (tileZ + 0.5) * tileSize;
        const key = this.addressing.keyFor(centreX, centreZ);
        let cell = this.cellIndex.get(key);
        if (cell === undefined) {
          cell = this.cells.length;
          this.cellIndex.set(key, cell);
          this.cellKeys.push(key);
          this.cells.push(this.baseResources());
          this.cellCentres.push(this.addressing.centreOf(key));
          this.tilesByCell.push([]);
        }
        this.tileCells[tile] = cell;
        this.tilesByCell[cell].push(tile);
      }
    }

    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const neighbours: number[] = [];
      for (const key of this.addressing.neighboursOf(this.cellKeys[cell])) {
        const other = this.cellIndex.get(key);
        // Cells outside the simulated region are a boundary, not a clamp to the
        // far side of the grid.
        if (other !== undefined && other !== cell) neighbours.push(other);
        if (neighbours.length === 4) break;
      }
      this.cellNeighbours.push(neighbours);
    }
  }

  private baseResources(): TileResources {
    return {
      light: clamp(this.config.tileLightBase, 0, this.config.maxLight),
      moisture: clamp(this.config.tileMoistureBase, 0, this.config.maxMoisture),
      minerals: clamp(this.config.tileMineralsBase, 0, this.config.maxMinerals),
      groundwater: clamp(this.config.groundwaterBase, 0, this.config.groundwaterCapacity),
    };
  }

  private index(x: number, z: number): number {
    return z * this.width + x;
  }

  /**
   * Cached average light. `getSunIntensity()` is a full-grid walk, and the tick
   * asks for it twice per plant; caching it until the grid changes turns ~130M
   * tile reads/s at 50 plants into one 65K walk per tick.
   */
  private sunIntensityCache: number | null = null;

  private markCellDirty(cell: number): void {
    // On the first broadcast, the client queries its own tile explicitly
    // (see main.ts RESOURCE_QUERY handler), so we skip sending all tiles.
    if (!this.hasBroadcast) return;
    this.dirtyCells.add(cell);
  }

  /** Cheap dirty count, so callers can skip building the tile array. */
  getDirtyTileCount(): number {
    let count = 0;
    for (const cell of this.dirtyCells) count += this.tilesByCell[cell]?.length ?? 0;
    return count;
  }

  getDirtyTiles(): DirtyTile[] {
    this.hasBroadcast = true;
    return this.collectDirtyTiles(true);
  }

  /**
   * Record that a client has the full grid, so per-tick deltas may begin.
   *
   * `markCellDirty` stays silent until the first full grid has gone out, to avoid
   * pushing a 65k-tile burst on the first tick. That flag used to be set only by
   * `getDirtyTiles`, which is only reached when something is already dirty — so
   * nothing was ever dirty and no delta ever left the server: daylight re-tints,
   * weather and dev tile edits all reached the simulation and stopped there. The
   * RESOURCE_QUERY full-grid answer is the event the flag was waiting for.
   */
  markFullGridSent(): void {
    this.hasBroadcast = true;
  }

  /**
   * Peek at dirty tiles without mutating state (for read-only access).
   * Does not clear dirty cells or update lastBroadcast maps.
   */
  peekDirtyTiles(): DirtyTile[] {
    return this.collectDirtyTiles(false);
  }

  /**
   * Turns changed cells into changed lattice tiles. Several tiles can sample one
   * cell (the pole is where a lat/lon cell covers more than one square metre),
   * so a dirty cell may publish more than one tile.
   */
  private collectDirtyTiles(apply: boolean): DirtyTile[] {
    const tiles: DirtyTile[] = [];
    const seen = new Set<number>();
    for (const cell of this.dirtyCells) {
      const t = this.cells[cell];
      for (const tile of this.tilesByCell[cell] ?? []) {
        if (seen.has(tile)) continue;
        const prevLight = this.lastBroadcastLight.get(tile);
        const prevMoisture = this.lastBroadcastMoisture.get(tile);
        const prevMinerals = this.lastBroadcastMinerals.get(tile);
        const changed =
          prevLight === undefined ||
          prevMoisture === undefined ||
          prevMinerals === undefined ||
          Math.abs(t.light - prevLight) > this.config.lightDirtyThreshold ||
          Math.abs(t.moisture - prevMoisture) > this.config.resourceDirtyThreshold ||
          Math.abs(t.minerals - prevMinerals) > this.config.resourceDirtyThreshold;
        if (!changed) continue;

        seen.add(tile);
        tiles.push({
          tileX: tile % this.width,
          tileZ: Math.floor(tile / this.width),
          light: t.light,
          moisture: t.moisture,
          minerals: t.minerals,
        });
        if (apply) {
          this.lastBroadcastLight.set(tile, t.light);
          this.lastBroadcastMoisture.set(tile, t.moisture);
          this.lastBroadcastMinerals.set(tile, t.minerals);
        }
      }
    }
    if (apply) this.dirtyCells.clear();
    return tiles;
  }

  /** Cell key of a lattice tile, for tooling and tests. */
  getTileCell(tileX: number, tileZ: number): string | null {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) return null;
    return this.cellKeys[this.tileCells[this.index(tileX, tileZ)]] ?? null;
  }

  private worldToTileX(worldX: number): number {
    return Math.floor((worldX - this.worldBounds.minX) / this.config.tileSize);
  }

  private worldToTileZ(worldZ: number): number {
    return Math.floor((worldZ - this.worldBounds.minZ) / this.config.tileSize);
  }

  private clampTileX(tx: number): number {
    return clamp(tx, 0, this.width - 1);
  }

  private clampTileZ(tz: number): number {
    return clamp(tz, 0, this.height - 1);
  }

  setTimeOfDay(timeOfDay: number): void {
    this.timeOfDay = timeOfDay;
  }

  getTileCoordinates(worldX: number, worldZ: number): { tileX: number; tileZ: number } {
    return {
      tileX: this.clampTileX(this.worldToTileX(worldX)),
      tileZ: this.clampTileZ(this.worldToTileZ(worldZ)),
    };
  }

  getTileResources(worldX: number, worldZ: number): TileResources {
    const tx = this.clampTileX(this.worldToTileX(worldX));
    const tz = this.clampTileZ(this.worldToTileZ(worldZ));
    return { ...this.cells[this.tileCells[this.index(tx, tz)]] };
  }

  getTileResourcesAt(tileX: number, tileZ: number): TileResources | null {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) {
      return null;
    }
    const cell = this.tileCells[this.index(tileX, tileZ)];
    const tile = this.cells[cell];
    return tile ? { ...tile } : null;
  }

  /** False when the coordinates are off the grid, so a caller can tell a no-op from a write. */
  setTileResources(
    tileX: number,
    tileZ: number,
    resources: { light?: number; moisture?: number; minerals?: number; groundwater?: number },
  ): boolean {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) {
      return false;
    }
    const cell = this.tileCells[this.index(tileX, tileZ)];
    const tile = this.cells[cell];
    if (!tile) return false;
    if (resources.light !== undefined) tile.light = clamp(resources.light, 0, this.config.maxLight);
    if (resources.moisture !== undefined)
      tile.moisture = clamp(resources.moisture, 0, this.config.maxMoisture);
    if (resources.minerals !== undefined)
      tile.minerals = clamp(resources.minerals, 0, this.config.maxMinerals);
    if (resources.groundwater !== undefined)
      tile.groundwater = clamp(resources.groundwater, 0, this.config.groundwaterCapacity);
    this.sunIntensityCache = null;
    this.markCellDirty(cell);
    return true;
  }

  /**
   * Height of the water table at a world point, in the same metres as the
   * surface height provider.
   *
   * A full cell puts its table at the surface, an empty one `table_depth_m`
   * below it, and everything in between is linear in saturation. This is the
   * number the client draws water from: it is per tile, so a plant that drains
   * its own ground lowers the water under itself while the neighbouring tiles
   * stay wet, and rising rain lifts it everywhere.
   */
  getWaterTableHeightAt(worldX: number, worldZ: number): number {
    const tile = this.getTileResources(worldX, worldZ);
    const capacity = Math.max(1, this.config.groundwaterCapacity);
    const level = clamp((tile.groundwater ?? 0) / capacity, 0, 1);
    const depth = Math.max(0.1, this.config.groundwaterTableDepthM ?? 2.5);
    return this.regionalHeightAt(worldX, worldZ) - (1 - level) * depth;
  }

  /** Maximum water a soil cell can hold below the surface. */
  getGroundwaterCapacity(): number {
    return this.config.groundwaterCapacity;
  }

  getTileSize(): number {
    return this.config.tileSize;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  /** Returns all tiles for full grid broadcast (ground rendering) */
  getAllTiles(): Array<{
    tileX: number;
    tileZ: number;
    light: number;
    moisture: number;
    minerals: number;
  }> {
    const tiles: Array<{
      tileX: number;
      tileZ: number;
      light: number;
      moisture: number;
      minerals: number;
    }> = [];
    for (let tileZ = 0; tileZ < this.height; tileZ++) {
      for (let tileX = 0; tileX < this.width; tileX++) {
        const tile = this.cells[this.tileCells[tileZ * this.width + tileX]];
        if (tile) {
          tiles.push({ tileX, tileZ, ...tile });
        }
      }
    }
    return tiles;
  }

  /** D01: Dev action - set photosynthesis rate multiplier */
  setPhotosynthesisRate(rate: number): void {
    this.config.photosynthesisRate = rate;
  }

  /** D01: Dev action - set diffusion rate */
  setDiffusionRate(rate: number): void {
    this.config.diffusionRate = rate;
  }

  /** D01: Dev action - set max absorption per tick */
  setMaxAbsorptionPerTick(max: number): void {
    this.config.maxAbsorptionPerTick = max;
  }

  /** D01: Dev action - set rain gain per second */
  setRainGainPerS(gain: number): void {
    this.config.rainGainPerS = gain;
  }

  /** D01: Dev action - set evaporation per second */
  setEvaporationPerS(evap: number): void {
    this.config.evaporationPerS = evap;
  }

  /** D01: Dev action - set canopy shade reduction */
  setCanopyShadeReduction(reduction: number): void {
    this.config.canopyShadeReduction = reduction;
  }

  /** D01: Dev action - reset resource config to defaults */
  resetToDefaults(): void {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = this.baseResources();
    }
    this.dirtyCells.clear();
    this.lastBroadcastLight.clear();
    this.lastBroadcastMoisture.clear();
    this.lastBroadcastMinerals.clear();
    this.hasBroadcast = false;
    this.sunIntensityCache = null;
  }

  getCoveredTileCount(plant: Pick<PlantForResource, 'nodes'>): number {
    return this.getPlantTileCoverage(plant).count;
  }

  /**
   * Every tile any of the plant's parts overlap, with the average tile resources
   * over those tiles. Every node counts, root or canopy, above or below ground:
   * the grid is 2D, so a leaf over a tile is on that tile just as a root under
   * it is. This replaces sending one object per tile to the client: the client
   * only ever used the average (and one sample for the dev readout), so the old
   * payload was O(tiles) at 20 Hz for a handful of numbers.
   */
  getPlantTileCoverage(plant: Pick<PlantForResource, 'nodes'>): PlantTileCoverage {
    const seen = new Set<number>();
    let count = 0;
    let light = 0;
    let moisture = 0;
    let minerals = 0;
    let groundwater = 0;
    let sample: { tileX: number; tileZ: number } | null = null;

    for (const node of plant.nodes.values()) {
      const radius = Math.max(0, node.radius ?? 0);
      const tileSize = this.config.tileSize;
      // Clamped to the grid, not dropped: a plant outside the resource patch (or
      // a node whose coordinates are momentarily unusable) must still report the
      // nearest cell instead of vanishing from the root update. A zero-coverage
      // plant silently stopped every soil/water reading for its owner.
      const minTileX = this.clampTileX(this.worldToTileX(node.x - radius));
      const maxTileX = this.clampTileX(this.worldToTileX(node.x + radius));
      const minTileZ = this.clampTileZ(this.worldToTileZ(node.z - radius));
      const maxTileZ = this.clampTileZ(this.worldToTileZ(node.z + radius));

      for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ += 1) {
        if (tileZ < 0 || tileZ >= this.height) continue;
        const tileMinZ = this.worldBounds.minZ + tileZ * tileSize;
        const nearestZ = Math.min(Math.max(node.z, tileMinZ), tileMinZ + tileSize);
        for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
          if (tileX < 0 || tileX >= this.width) continue;
          const idx = this.index(tileX, tileZ);
          const cell = this.tileCells[idx];
          // Several tiles can sample one cell; count each cell once.
          if (seen.has(cell)) continue;
          const tile = this.cells[cell];
          if (!tile) continue;

          if (radius > 0) {
            // Exact circle-vs-tile test: the bounding box alone would include a
            // corner tile the round footprint never reaches. Touching counts.
            const tileMinX = this.worldBounds.minX + tileX * tileSize;
            const nearestX = Math.min(Math.max(node.x, tileMinX), tileMinX + tileSize);
            const dx = node.x - nearestX;
            const dz = node.z - nearestZ;
            if (dx * dx + dz * dz > radius * radius) continue;
          }

          seen.add(cell);
          count += 1;
          light += tile.light;
          moisture += tile.moisture;
          minerals += tile.minerals;
          groundwater += tile.groundwater ?? 0;
          if (!sample) sample = { tileX, tileZ };
        }
      }
    }

    if (count === 0) {
      return {
        count: 0,
        avgLight: 0,
        avgMoisture: 0,
        avgMinerals: 0,
        avgGroundwater: 0,
        sample: null,
      };
    }
    return {
      count,
      avgLight: light / count,
      avgMoisture: moisture / count,
      avgMinerals: minerals / count,
      avgGroundwater: groundwater / count,
      sample,
    };
  }

  step(
    dt: number,
    plants: Map<string, PlantForResource>,
    weatherMoistureRate = 0,
    weatherLightMult = 1.0,
    timeOfDay = 0.5,
  ): void {
    this.tick++;
    this.timeOfDay = timeOfDay;
    this.sunIntensityCache = null;
    this.updateLight(plants, weatherLightMult);

    this.soilAccumulatorS += dt;
    if (this.soilAccumulatorS < SOIL_STEP_INTERVAL_S) return;
    const soilDt = this.soilAccumulatorS;
    this.soilAccumulatorS = 0;
    this.updateMoisture(soilDt, plants, weatherMoistureRate, weatherLightMult);
    this.updateMinerals(soilDt, plants);
    // Gravity before smoothing: water finds the low ground of the real terrain,
    // then diffusion evens out the remainder.
    this.flowGroundwater(soilDt);
    this.diffuseResources();
  }

  /** Compute air temperature (°C) from time of day and sun intensity. */
  private computeTemperature(sunIntensity: number): number {
    // Base temperature follows day/night cycle (sinusoidal)
    const dayFraction = this.timeOfDay;
    const dayCurve = Math.sin(dayFraction * Math.PI); // 0 at midnight, 1 at noon
    const baseTemp = this.config.temperatureBase + this.config.temperatureAmplitude * dayCurve;
    // Additional heating from direct sun
    const sunTemp =
      this.config.temperatureSunFactor * sunIntensity * this.config.temperatureAmplitude;
    return baseTemp + sunTemp;
  }

  private updateLight(plants: Map<string, PlantForResource>, weatherLightMult = 1.0): void {
    // Interpolate the day/night curve instead of sampling a single index.
    // Index sampling made light sit on the curve's 1.0 plateau for minutes at a
    // time, which read as a frozen value in the client.
    const curve = this.config.dayNightCurve;
    const curvePos = Math.min(1, Math.max(0, this.timeOfDay)) * Math.max(0, curve.length - 1);
    const curveIndex = Math.floor(curvePos);
    const curveNext = Math.min(curve.length - 1, curveIndex + 1);
    const curveT = curvePos - curveIndex;
    const curveA = curve[curveIndex] ?? 1.0;
    const curveB = curve[curveNext] ?? curveA;
    const dayNightMultiplier = curveA + (curveB - curveA) * curveT;

    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const baseLight = this.config.tileLightBase * dayNightMultiplier * weatherLightMult;
      let canopyShade = 0;
      const centre = this.cellCentres[cell];

      for (const plant of plants.values()) {
        for (const node of plant.nodes.values()) {
          if (node.layer !== 'canopy') continue;
          const dx = node.x - centre.x;
          const dz = node.z - centre.z;
          const distSq = dx * dx + dz * dz;
          if (distSq < 16) {
            canopyShade += this.config.canopyShadeReduction * (1 - distSq / 16);
          }
        }
      }

      const tile = this.cells[cell];
      const oldLight = tile.light;
      const light = clamp(baseLight - canopyShade, 0, this.config.maxLight);
      tile.light = light;
      // Day/night drifts light every tick; only rebroadcast tiles whose light
      // actually crossed the dirty threshold since the last broadcast.
      if (Math.abs(light - oldLight) > this.config.lightDirtyThreshold) {
        this.markCellDirty(cell);
      }
    }
  }

  private updateMoisture(
    dt: number,
    plants: Map<string, PlantForResource>,
    weatherMoistureRate = 0,
    _weatherLightMult = 1.0,
  ): void {
    // Compute temperature once per step (same for all tiles)
    const sunIntensity = this.getSunIntensity();
    const temperature = this.computeTemperature(sunIntensity);

    // Evaporation rate increases exponentially with temperature (Arrhenius-like)
    // Reference: evaporation doubles every ~10°C above 20°C
    const refTemp = 20.0;
    const evaporationTempFactor = 2 ** ((temperature - refTemp) / 10);
    const evaporationRate = this.config.evaporationPerS * evaporationTempFactor;

    // Transpiration: leaf water loss driven by temperature and light
    // Count total leaf nodes across all plants
    let totalLeafNodes = 0;
    for (const plant of plants.values()) {
      for (const node of plant.nodes.values()) {
        if (node.type === 'leaf') totalLeafNodes++;
      }
    }
    const transpirationRate =
      this.config.transpirationFactor * totalLeafNodes * evaporationTempFactor * sunIntensity;

    const fieldCapacity = this.config.maxMoisture * 0.65;
    const groundwaterCapacity = this.config.groundwaterCapacity;

    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const tile = this.cells[cell];
      let moisture = tile.moisture;
      let groundwater = Math.max(0, tile.groundwater ?? 0);
      const centre = this.cellCentres[cell];

      // Rainfall is partitioned like a soil-water bucket (the simple form of
      // Green-Ampt infiltration): a drier surface accepts most of the shower,
      // while a saturated surface rejects more of it. The rejected water is the
      // runoff that recharges the deeper groundwater cavity. This makes storms
      // refill the soil and the water table instead of painting every tile with
      // the same amount of moisture.
      if (weatherMoistureRate > 0) {
        const rainGain = weatherMoistureRate;
        const rainfall = rainGain * dt;
        const saturation = clamp(moisture / Math.max(1e-6, this.config.maxMoisture), 0, 1);
        const infiltrated = rainfall * (1 - 0.65 * saturation);
        const runoff = Math.max(0, rainfall - infiltrated);
        moisture += infiltrated;
        groundwater += runoff * this.config.groundwaterInfiltrationFraction;
        // Direct deep recharge: a share of every shower bypasses the topsoil
        // bucket through macropores. Without it the table only filled from
        // runoff, which a dry, unsaturated surface produces almost none of, so
        // a storm left the cavity pool dry for the whole session.
        groundwater += rainfall * this.config.groundwaterRechargeFraction;
      }

      // Temperature-driven evaporation (soil surface)
      moisture -= evaporationRate * dt;

      // Transpiration: distributed to tiles under canopy
      if (totalLeafNodes > 0) {
        let canopyShade = 0;
        for (const plant of plants.values()) {
          for (const node of plant.nodes.values()) {
            if (node.layer !== 'canopy') continue;
            const dx = node.x - centre.x;
            const dz = node.z - centre.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < 16) {
              canopyShade += this.config.canopyShadeReduction * (1 - distSq / 16);
            }
          }
        }
        // Transpiration loss proportional to canopy presence
        moisture -= transpirationRate * dt * Math.min(1, canopyShade * 10);
      }

      // Drainage below field capacity: gravity moves the surplus down into the
      // groundwater store instead of leaving the topsoil permanently flooded.
      if (moisture > fieldCapacity) {
        const drain =
          (moisture - fieldCapacity) * Math.min(1, this.config.groundwaterPercolationRate * dt);
        moisture -= drain;
        groundwater += drain;
      }

      // Capillary rise: a dry root zone pulls water back up from the cavity, so
      // a plant can survive a dry spell by having grown down to the water table.
      if (moisture < fieldCapacity && groundwater > 0.001) {
        const rise = Math.min(
          groundwater,
          this.config.groundwaterCapillaryRisePerS * dt,
          fieldCapacity - moisture,
        );
        moisture += rise;
        groundwater -= rise;
      }

      // Root uptake is handled by PlantWorld.absorbResourcesFromTiles via
      // takeFromTile(), which both credits the plant and debits this tile.

      tile.moisture = clamp(moisture, 0, this.config.maxMoisture);
      tile.groundwater = clamp(groundwater, 0, groundwaterCapacity);
      this.markCellDirty(cell);
    }
  }

  /**
   * Groundwater obeys gravity.
   *
   * A water table is not a flat number per tile: it has an elevation, and water
   * moves from a higher table to a lower one. Using the terrain the world is
   * actually drawn from means a hollow fills first, a slope drains, and a storm
   * leaves visible pools in the low ground instead of raising every tile by the
   * same amount. Flow is capped by the donor's water, by the receiving cell's
   * capacity and by the head difference, so the pass conserves mass and cannot
   * oscillate.
   */
  private flowGroundwater(dt: number): void {
    const rate = this.config.groundwaterFlowPerS ?? 0;
    const capacity = this.config.groundwaterCapacity;
    if (rate <= 0 || capacity <= 0 || dt <= 0) return;

    const maxDepth = Math.max(0.1, this.config.groundwaterTableDepthM ?? 2.5);
    const elevations = new Float64Array(this.cells.length);
    const regional = this.regionalHeightsByCell();
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const level = clamp((this.cells[cell].groundwater ?? 0) / capacity, 0, 1);
      // A full cell has its table at the regional ground level; an empty one has
      // it maxDepth below. Measuring against the same regional level the render
      // uses is what makes a filled hollow pool and a dry rise stay dry, and it
      // keeps dug tunnels from acting as drains.
      elevations[cell] = regional[cell] - (1 - level) * maxDepth;
    }

    const transferFactor = Math.min(1, rate * dt);
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const neighbours = this.cellNeighbours[cell];
      if (!neighbours) continue;
      const source = this.cells[cell];
      let sourceWater = source.groundwater ?? 0;
      for (const other of neighbours) {
        if (sourceWater <= 0) break;
        const head = elevations[cell] - elevations[other];
        if (head <= 1e-4) continue;
        const target = this.cells[other];
        const targetWater = target.groundwater ?? 0;
        const room = Math.max(0, capacity - targetWater);
        const flow = Math.min(
          sourceWater * 0.5,
          (sourceWater - targetWater) * transferFactor,
          room,
        );
        if (flow <= 1e-4) continue;
        sourceWater -= flow;
        target.groundwater = targetWater + flow;
        // The column rose on the receiving side, so its table is higher now.
        elevations[other] += (flow / capacity) * maxDepth;
        this.markCellDirty(other);
      }
      if (sourceWater !== (source.groundwater ?? 0)) {
        source.groundwater = sourceWater;
        this.markCellDirty(cell);
      }
    }
  }

  private updateMinerals(_dt: number, _plants: Map<string, PlantForResource>): void {
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const tile = this.cells[cell];
      tile.minerals = clamp(tile.minerals, 0, this.config.maxMinerals);
      this.markCellDirty(cell);
    }
  }

  private diffuseResources(): void {
    const rate = this.config.diffusionRate;
    const next = this.cells.map((t) => ({ ...t }));

    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const neighbours = this.cellNeighbours[cell];
      if (!neighbours || neighbours.length === 0) continue;

      const current = this.cells[cell];
      let lightSum = 0;
      let moistureSum = 0;
      let mineralsSum = 0;
      for (const neighbour of neighbours) {
        const other = this.cells[neighbour];
        lightSum += other.light;
        moistureSum += other.moisture;
        mineralsSum += other.minerals;
      }

      // Diffuse toward the mean of all neighbours, not the last one written.
      // The neighbour list comes from the addressing, so on a sphere it wraps
      // around the planet and follows ring boundaries instead of array edges.
      next[cell].light = lerp(current.light, lightSum / neighbours.length, rate);
      next[cell].moisture = lerp(current.moisture, moistureSum / neighbours.length, rate);
      next[cell].minerals = lerp(current.minerals, mineralsSum / neighbours.length, rate);
    }

    // Only flag tiles whose value actually moved beyond the broadcast threshold
    // this step. Diffuse is a slow smoothing pass; marking the whole grid dirty
    // every tick rebroadcasts ~65k tiles at 20 Hz and starves the client of FPS.
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const after = next[cell];
      const before = this.cells[cell];
      const changed =
        Math.abs(after.light - before.light) > this.config.lightDirtyThreshold ||
        Math.abs(after.moisture - before.moisture) > this.config.resourceDirtyThreshold ||
        Math.abs(after.minerals - before.minerals) > this.config.resourceDirtyThreshold;
      this.cells[cell] = after;
      if (changed) this.markCellDirty(cell);
    }
  }

  depositMinerals(worldX: number, worldZ: number, amount: number): void {
    const tx = this.clampTileX(this.worldToTileX(worldX));
    const tz = this.clampTileZ(this.worldToTileZ(worldZ));
    this.addMineralsAtCell(this.tileCells[this.index(tx, tz)], amount);
  }

  depositMineralsAtTile(tileX: number, tileZ: number, amount: number): void {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) return;
    this.addMineralsAtCell(this.tileCells[this.index(tileX, tileZ)], amount);
  }

  private addMineralsAtCell(cell: number, amount: number): void {
    const tile = this.cells[cell];
    if (!tile) return;
    tile.minerals = clamp(tile.minerals + amount, 0, this.config.maxMinerals);
    this.markCellDirty(cell);
  }

  onRootNodeDeath(worldX: number, worldZ: number): void {
    this.depositMinerals(worldX, worldZ, this.config.deadRootDeposit);
  }

  /**
   * Death only needs the geometry, so it takes the narrow slice callers actually
   * have. Requiring the full resource view forced the caller to invent zeroed
   * stores that this never reads.
   */
  onPlantDeath(plant: Pick<PlantForResource, 'nodes' | 'rootNodeId'>): void {
    for (const node of plant.nodes.values()) {
      if (node.layer === 'root') {
        this.depositMinerals(node.x, node.z, this.config.deadRootDeposit);
      }
    }
    const rootNode = plant.nodes.get(plant.rootNodeId);
    if (rootNode) {
      this.depositMinerals(rootNode.x, rootNode.z, this.config.deadPlantDeposit);
    }
  }

  onDungApplied(worldX: number, worldZ: number): void {
    this.depositMinerals(worldX, worldZ, this.config.dungDeposit);
  }

  onFertilizerApplied(worldX: number, worldZ: number): void {
    this.depositMinerals(worldX, worldZ, this.config.fertilizerDeposit);
  }

  /**
   * Sun intensity as a 0-1 fraction of the configured daylight level.
   * `tile_light_base` is what a fully lit tile reads at noon, so dividing by it
   * (not by `max_light`, which only exists to allow magical over-brightness)
   * is what makes a clear noon read as "full sun".
   */
  getSunIntensity(): number {
    if (this.sunIntensityCache !== null) return this.sunIntensityCache;
    let totalLight = 0;
    for (let i = 0; i < this.cells.length; i++) totalLight += this.cells[i].light;
    const avgLight = totalLight / Math.max(1, this.cells.length);
    this.sunIntensityCache = clamp(avgLight / Math.max(1, this.config.tileLightBase), 0, 1);
    return this.sunIntensityCache;
  }

  /** Gaussian temperature response: 1.0 at the optimum, 0.5 one range away. */
  private temperatureFactor(temperature: number): number {
    const diff = temperature - this.config.photosynthesisTempOptimum;
    const range = this.config.photosynthesisTempRange;
    return Math.exp(-(diff * diff) / (2 * range * range));
  }

  /**
   * Photosynthesis. Light is the only truly ambient input (a level, effectively
   * infinite); water and minerals must already be in the plant's own stores,
   * captured by roots. Returns energy plus the water/minerals the caller should
   * deduct — structural biomass never comes from here, only from node growth.
   */
  calculatePhotosynthesis(plant: PlantForResource): PhotosynthesisResult {
    const empty: PhotosynthesisResult = { energyGain: 0, waterCost: 0, mineralCost: 0 };

    const sunIntensity = this.getSunIntensity();
    const tempFactor = this.temperatureFactor(this.computeTemperature(sunIntensity));
    if (tempFactor <= 0) return empty;

    // "Hydrated enough to fix carbon" saturates well below a full tank, so a
    // plant that has captured a quarter of its capacity photosynthesises fully.
    const waterStatus = clamp(
      plant.storedWater / Math.max(1e-6, plant.waterCapacity * this.config.waterStatusFullFraction),
      0,
      1,
    );
    const mineralStatus = clamp(
      plant.storedMinerals /
        Math.max(1e-6, plant.mineralCapacity * this.config.mineralStatusFullFraction),
      0,
      1,
    );
    const moistureFactor = this.evaluateCurve(this.config.moistureFactorCurve, waterStatus);
    const mineralFactor = this.evaluateCurve(this.config.mineralFactorCurve, mineralStatus);
    if (moistureFactor <= 0 || mineralFactor <= 0) return empty;

    let energyGain = 0;
    for (const node of plant.nodes.values()) {
      // Cotyledons are the first photosynthetic organs, not placeholders.
      const organStrength = node.statModifiers?.photosynthesis ?? 0;
      if (organStrength <= 0) continue;

      // Read through the clamped accessor. Plants spawn around the origin while
      // the grid's min corner is not the origin, so an unclamped lookup returned
      // null for organs on the negative side and silently dropped them — which
      // zeroed photosynthesis for whole plants and stalled them after germination.
      const resources = this.getTileResources(node.x, node.z);

      const lightRatio = clamp(resources.light / Math.max(1, this.config.tileLightBase), 0, 1);
      const lightFactor = this.evaluateCurve(this.config.lightFactorCurve, lightRatio);
      if (lightFactor <= 0) continue;

      energyGain +=
        lightFactor *
        moistureFactor *
        mineralFactor *
        tempFactor *
        this.config.photosynthesisEnergyPerSecond *
        organStrength *
        this.config.photosynthesisRate;
    }

    return {
      energyGain,
      waterCost: energyGain * this.config.photosynthesisWaterPerEnergy,
      mineralCost: energyGain * this.config.photosynthesisMineralPerEnergy,
    };
  }

  /**
   * Photosynthesis integrated over `seconds`, bounded by what the plant holds.
   *
   * The dormant tier settles an arbitrarily long absence in one step, so the
   * per-second rate cannot simply be multiplied by the span: fixation stops at
   * the stored water and minerals the plant can actually pay with, and the costs
   * are derived from the energy that was fixed. Every returned quantity is
   * therefore bounded by the plant's own stores, and a non-finite, zero or
   * negative span fixes nothing. Energy still cannot exceed the plant's capacity:
   * the caller credits it through `addPhotosynthesisEnergy`, which clamps.
   */
  photosynthesisOverSpan(
    plant: PlantForResource,
    seconds: number,
  ): PhotosynthesisResult & { transpiration: number } {
    const empty = { energyGain: 0, waterCost: 0, mineralCost: 0, transpiration: 0 };
    if (!Number.isFinite(seconds) || seconds <= 0) return empty;

    const rate = this.calculatePhotosynthesis(plant);
    if (rate.energyGain <= 0) return empty;

    const waterPerEnergy = this.config.photosynthesisWaterPerEnergy;
    const mineralPerEnergy = this.config.photosynthesisMineralPerEnergy;
    let energyGain = rate.energyGain * seconds;
    if (waterPerEnergy > 0) {
      energyGain = Math.min(energyGain, Math.max(0, plant.storedWater) / waterPerEnergy);
    }
    if (mineralPerEnergy > 0) {
      energyGain = Math.min(energyGain, Math.max(0, plant.storedMinerals) / mineralPerEnergy);
    }

    const waterCost = energyGain * waterPerEnergy;
    const mineralCost = energyGain * mineralPerEnergy;
    // Transpiration can only spend what fixing carbon left in the tank.
    const transpiration = Math.min(
      this.calculateTranspiration(plant, seconds),
      Math.max(0, plant.storedWater - waterCost),
    );

    return { energyGain, waterCost, mineralCost, transpiration };
  }

  /**
   * Water lost through the leaf surface this step. Scales with temperature and
   * light, but stays non-zero at night (stomata close; they rarely shut fully),
   * using `night_transpiration_multiplier` as the floor.
   */
  calculateTranspiration(plant: PlantForResource, dt: number): number {
    let organs = 0;
    for (const node of plant.nodes.values()) {
      if (node.statModifiers?.photosynthesis && node.statModifiers.photosynthesis > 0) organs++;
    }
    if (organs === 0) return 0;

    const sunIntensity = this.getSunIntensity();
    const temperature = this.computeTemperature(sunIntensity);
    const tempEvapFactor = 2 ** ((temperature - 20) / 10);
    const night = clamp(this.config.nightTranspirationMultiplier, 0, 1);
    const drive = night + (1 - night) * sunIntensity;
    return this.config.transpirationFactor * organs * tempEvapFactor * drive * dt;
  }

  /**
   * Capture resources from a tile into a plant's stores. Returns only what was
   * actually available, so a dry or exhausted tile yields little or nothing.
   */
  takeFromTile(
    worldX: number,
    worldZ: number,
    waterDemand: number,
    mineralDemand: number,
    allowGroundwater = false,
  ): { water: number; minerals: number } {
    const tx = this.clampTileX(this.worldToTileX(worldX));
    const tz = this.clampTileZ(this.worldToTileZ(worldZ));
    const cell = this.tileCells[this.index(tx, tz)];
    const tile = this.cells[cell];
    if (!tile) return { water: 0, minerals: 0 };

    let remainingWater = Math.max(0, waterDemand);
    const surfaceWater = Math.min(remainingWater, tile.moisture);
    tile.moisture -= surfaceWater;
    remainingWater -= surfaceWater;

    // Only a root deep enough to reach the cavity can tap the groundwater.
    // The fraction cap is per absorption step, so a large root system cannot
    // empty a whole water pocket instantly.
    let groundwaterWater = 0;
    if (allowGroundwater && remainingWater > 0) {
      const groundwater = Math.max(0, tile.groundwater ?? 0);
      const reserve = this.config.groundwaterCapacity * this.config.groundwaterRootReserveFraction;
      const accessible = Math.max(0, groundwater - reserve);
      groundwaterWater = Math.min(
        remainingWater,
        accessible * this.config.groundwaterRootUptakeFraction,
      );
      tile.groundwater = groundwater - groundwaterWater;
    }

    const water = surfaceWater + groundwaterWater;
    const minerals = Math.max(0, Math.min(mineralDemand, tile.minerals));
    tile.minerals -= minerals;
    if (water > 0 || minerals > 0) {
      this.markCellDirty(cell);
    }
    return { water, minerals };
  }

  private evaluateCurve(curve: [number, number][], x: number): number {
    x = clamp(x, 0, 1);
    for (let i = 0; i < curve.length - 1; i++) {
      const [x0, y0] = curve[i];
      const [x1, y1] = curve[i + 1];
      if (x >= x0 && x <= x1) {
        const t = (x - x0) / (x1 - x0);
        return lerp(y0, y1, t);
      }
    }
    return curve[curve.length - 1][1];
  }

  getState(): ResourceWorldState {
    let tiles: DirtyTile[];
    if (this.firstBroadcast) {
      // First broadcast: send all tiles so client gets initial state
      tiles = [];
      for (let i = 0; i < this.tileCells.length; i += 1) {
        const t = this.cells[this.tileCells[i]];
        const tileZ = Math.floor(i / this.width);
        const tileX = i % this.width;
        if (t)
          tiles.push({ tileX, tileZ, light: t.light, moisture: t.moisture, minerals: t.minerals });
      }
      this.firstBroadcast = false;
    } else {
      tiles = this.peekDirtyTiles();
    }
    return {
      tiles,
      width: this.width,
      height: this.height,
      tileSize: this.config.tileSize,
      tick: this.tick,
    };
  }
}
