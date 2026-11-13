import type { ConfigFile } from '@plant-legacy/shared/config';
import {
  readArray,
  readBoolean,
  readInteger,
  readNumber,
  readNumberArray,
} from '@plant-legacy/shared/config';
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
  consumptionTriggerTileMineralThreshold: number;
  consumptionTriggerDungItem: boolean;
  consumptionTriggerFertilizerItem: boolean;
  diffusionRate: number;
  maxAbsorptionPerTick: number;
  canopyShadeReduction: number;
  maxLight: number;
  maxMoisture: number;
  maxMinerals: number;
}

export interface TileResources {
  light: number;
  moisture: number;
  minerals: number;
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
    consumptionTriggerTileMineralThreshold: readInteger(
      configs,
      'resources',
      'consumption_trigger_tile_mineral_threshold',
    ),
    consumptionTriggerDungItem: readBoolean(configs, 'resources', 'consumption_trigger_dung_item'),
    consumptionTriggerFertilizerItem: readBoolean(
      configs,
      'resources',
      'consumption_trigger_fertilizer_item',
    ),
    diffusionRate: readNumber(configs, 'resources', 'diffusion_rate'),
    maxAbsorptionPerTick: readNumber(configs, 'resources', 'max_absorption_per_tick'),
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
const LIGHT_DIRTY_THRESHOLD = 0.05;
const RESOURCE_DIRTY_THRESHOLD = 0.1;
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
  private isRaining = false;
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
          Math.abs(t.light - prevLight) > LIGHT_DIRTY_THRESHOLD ||
          Math.abs(t.moisture - prevMoisture) > RESOURCE_DIRTY_THRESHOLD ||
          Math.abs(t.minerals - prevMinerals) > RESOURCE_DIRTY_THRESHOLD;
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

  setRaining(raining: boolean): void {
    this.isRaining = raining;
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

  setTileResources(
    tileX: number,
    tileZ: number,
    resources: { light?: number; moisture?: number; minerals?: number },
  ): void {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) {
      return;
    }
    const cell = this.tileCells[this.index(tileX, tileZ)];
    const tile = this.cells[cell];
    if (!tile) return;
    if (resources.light !== undefined) tile.light = clamp(resources.light, 0, this.config.maxLight);
    if (resources.moisture !== undefined)
      tile.moisture = clamp(resources.moisture, 0, this.config.maxMoisture);
    if (resources.minerals !== undefined)
      tile.minerals = clamp(resources.minerals, 0, this.config.maxMinerals);
    this.sunIntensityCache = null;
    this.markCellDirty(cell);
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
    let sample: { tileX: number; tileZ: number } | null = null;

    for (const node of plant.nodes.values()) {
      const radius = Math.max(0, node.radius ?? 0);
      const tileSize = this.config.tileSize;
      const minTileX = this.worldToTileX(node.x - radius);
      const maxTileX = this.worldToTileX(node.x + radius);
      const minTileZ = this.worldToTileZ(node.z - radius);
      const maxTileZ = this.worldToTileZ(node.z + radius);

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
          if (!sample) sample = { tileX, tileZ };
        }
      }
    }

    if (count === 0) {
      return { count: 0, avgLight: 0, avgMoisture: 0, avgMinerals: 0, sample: null };
    }
    return {
      count,
      avgLight: light / count,
      avgMoisture: moisture / count,
      avgMinerals: minerals / count,
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
      if (Math.abs(light - oldLight) > LIGHT_DIRTY_THRESHOLD) {
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

    for (let cell = 0; cell < this.cells.length; cell += 1) {
      const tile = this.cells[cell];
      let moisture = tile.moisture;
      const centre = this.cellCentres[cell];

      // Rain adds moisture
      if (this.isRaining || weatherMoistureRate > 0) {
        const rainGain = weatherMoistureRate > 0 ? weatherMoistureRate : this.config.rainGainPerS;
        moisture += rainGain * dt;
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

      // Root uptake is handled by PlantWorld.absorbResourcesFromTiles via
      // takeFromTile(), which both credits the plant and debits this tile.

      tile.moisture = clamp(moisture, 0, this.config.maxMoisture);
      this.markCellDirty(cell);
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
        Math.abs(after.light - before.light) > LIGHT_DIRTY_THRESHOLD ||
        Math.abs(after.moisture - before.moisture) > RESOURCE_DIRTY_THRESHOLD ||
        Math.abs(after.minerals - before.minerals) > RESOURCE_DIRTY_THRESHOLD;
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
  ): { water: number; minerals: number } {
    const tx = this.clampTileX(this.worldToTileX(worldX));
    const tz = this.clampTileZ(this.worldToTileZ(worldZ));
    const cell = this.tileCells[this.index(tx, tz)];
    const tile = this.cells[cell];
    if (!tile) return { water: 0, minerals: 0 };

    const water = Math.max(0, Math.min(waterDemand, tile.moisture));
    const minerals = Math.max(0, Math.min(mineralDemand, tile.minerals));
    tile.moisture -= water;
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

  checkConsumptionTriggers(plant: PlantForResource): {
    tileMineralTrigger: boolean;
    dungTrigger: boolean;
    fertilizerTrigger: boolean;
  } {
    const rootNode = plant.nodes.get(plant.rootNodeId);
    if (!rootNode) {
      return { tileMineralTrigger: false, dungTrigger: false, fertilizerTrigger: false };
    }

    const tileX = this.worldToTileX(rootNode.x);
    const tileZ = this.worldToTileZ(rootNode.z);
    const resources = this.getTileResourcesAt(tileX, tileZ);

    return {
      tileMineralTrigger:
        resources !== null &&
        resources.minerals >= this.config.consumptionTriggerTileMineralThreshold,
      dungTrigger: this.config.consumptionTriggerDungItem,
      fertilizerTrigger: this.config.consumptionTriggerFertilizerItem,
    };
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
