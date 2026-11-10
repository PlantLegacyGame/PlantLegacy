import type { ConfigFile } from '@plant-legacy/shared/config';
import {
  readArray,
  readBoolean,
  readInteger,
  readNumber,
  readNumberArray,
} from '@plant-legacy/shared/config';
import { clamp, lerp } from '@plant-legacy/shared/math';

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

export interface PhotosynthesisResult {
  biomassGain: number;
  energyGain: number;
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
  resourceDrawWater: number;
  resourceDrawNutrients: number;
  upkeepBiomassPerSecond: number;
}

export interface PlantForResource {
  id: string;
  ownerId: string;
  worldId: string;
  nodes: Map<string, PlantNodeForResource>;
  totalBiomass: number;
  totalUpkeep: number;
  rootNodeId: string;
}

export class ResourceWorld {
  private tiles: TileResources[];
  private readonly width: number;
  private readonly height: number;
  private readonly config: ResourcesConfig;
  private readonly worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  private isRaining = false;
  private timeOfDay = 0.5;
  private tick = 0;
  private hasBroadcast = false;
  private firstBroadcast = true;
  private dirtyTiles = new Set<number>();
  private lastBroadcastLight = new Map<number, number>();
  private lastBroadcastMoisture = new Map<number, number>();
  private lastBroadcastMinerals = new Map<number, number>();

  constructor(
    config: ResourcesConfig,
    worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) {
    this.config = config;
    this.worldBounds = worldBounds;
    this.width = config.gridWidth;
    this.height = config.gridHeight;
    this.tiles = new Array(this.width * this.height);

    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i] = {
        light: clamp(config.tileLightBase, 0, config.maxLight),
        moisture: clamp(config.tileMoistureBase, 0, config.maxMoisture),
        minerals: clamp(config.tileMineralsBase, 0, config.maxMinerals),
      };
    }
  }

  private index(x: number, z: number): number {
    return z * this.width + x;
  }

  private markDirty(idx: number, light: number, moisture: number, minerals: number): void {
    // On the first broadcast, the client queries its own tile explicitly
    // (see main.ts RESOURCE_QUERY handler), so we skip sending all tiles.
    if (!this.hasBroadcast) return;
    const prevLight = this.lastBroadcastLight.get(idx);
    const prevMoisture = this.lastBroadcastMoisture.get(idx);
    const prevMinerals = this.lastBroadcastMinerals.get(idx);
    const LIGHT_THRESHOLD = 0.05;
    const RESOURCE_THRESHOLD = 0.1;
    if (
      prevLight === undefined ||
      prevMoisture === undefined ||
      prevMinerals === undefined ||
      Math.abs(light - prevLight) > LIGHT_THRESHOLD ||
      Math.abs(moisture - prevMoisture) > RESOURCE_THRESHOLD ||
      Math.abs(minerals - prevMinerals) > RESOURCE_THRESHOLD
    ) {
      this.dirtyTiles.add(idx);
    }
  }

  getDirtyTiles(): DirtyTile[] {
    this.hasBroadcast = true;
    const tiles: DirtyTile[] = [];
    for (const idx of this.dirtyTiles) {
      const t = this.tiles[idx];
      const tileZ = Math.floor(idx / this.width);
      const tileX = idx % this.width;
      tiles.push({ tileX, tileZ, light: t.light, moisture: t.moisture, minerals: t.minerals });
      this.lastBroadcastLight.set(idx, t.light);
      this.lastBroadcastMoisture.set(idx, t.moisture);
      this.lastBroadcastMinerals.set(idx, t.minerals);
    }
    this.dirtyTiles.clear();
    return tiles;
  }

  /**
   * Peek at dirty tiles without mutating state (for read-only access).
   * Does not clear dirtyTiles or update lastBroadcast maps.
   */
  peekDirtyTiles(): DirtyTile[] {
    const tiles: DirtyTile[] = [];
    for (const idx of this.dirtyTiles) {
      const t = this.tiles[idx];
      const tileZ = Math.floor(idx / this.width);
      const tileX = idx % this.width;
      tiles.push({ tileX, tileZ, light: t.light, moisture: t.moisture, minerals: t.minerals });
    }
    return tiles;
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
    return { ...this.tiles[this.index(tx, tz)] };
  }

  getTileResourcesAt(tileX: number, tileZ: number): TileResources | null {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) {
      return null;
    }
    return { ...this.tiles[this.index(tileX, tileZ)] };
  }

  setTileResources(
    tileX: number,
    tileZ: number,
    resources: { light?: number; moisture?: number; minerals?: number },
  ): void {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) {
      return;
    }
    const idx = this.index(tileX, tileZ);
    const tile = this.tiles[idx];
    if (resources.light !== undefined) tile.light = clamp(resources.light, 0, this.config.maxLight);
    if (resources.moisture !== undefined)
      tile.moisture = clamp(resources.moisture, 0, this.config.maxMoisture);
    if (resources.minerals !== undefined)
      tile.minerals = clamp(resources.minerals, 0, this.config.maxMinerals);
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

  getRootTileCount(plant: PlantForResource): number {
    let count = 0;
    for (const node of plant.nodes.values()) {
      if (node.layer === 'root') {
        const tileX = this.getTileCoordinates(node.x, node.z).tileX;
        const tileZ = this.getTileCoordinates(node.x, node.z).tileZ;
        const idx = tileZ * this.width + tileX;
        const tile = this.tiles[idx];
        if (tile) count++;
      }
    }
    return count;
  }

  getRootTilesForPlant(
    plant: PlantForResource,
  ): Array<{ tileX: number; tileZ: number; light: number; moisture: number; minerals: number }> {
    const tiles: Array<{
      tileX: number;
      tileZ: number;
      light: number;
      moisture: number;
      minerals: number;
    }> = [];
    const seen = new Set<string>();
    for (const node of plant.nodes.values()) {
      if (node.layer === 'root') {
        const coords = this.getTileCoordinates(node.x, node.z);
        const key = `${coords.tileX},${coords.tileZ}`;
        if (!seen.has(key)) {
          seen.add(key);
          const idx = coords.tileZ * this.width + coords.tileX;
          const tile = this.tiles[idx];
          if (tile) {
            tiles.push({ tileX: coords.tileX, tileZ: coords.tileZ, ...tile });
          }
        }
      }
    }
    return tiles;
  }

  getAllTiles(): TileResources[] {
    return this.tiles.map((t) => ({ ...t }));
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
    this.updateLight(plants, weatherLightMult);
    this.updateMoisture(dt, plants, weatherMoistureRate, weatherLightMult);
    this.updateMinerals(dt, plants);
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
    const dayNightIndex = Math.min(
      this.config.dayNightCurve.length - 1,
      Math.max(0, Math.floor(this.timeOfDay * this.config.dayNightCurve.length)),
    );
    const dayNightMultiplier = this.config.dayNightCurve[dayNightIndex] ?? 1.0;

    for (let tz = 0; tz < this.height; tz++) {
      for (let tx = 0; tx < this.width; tx++) {
        const baseLight = this.config.tileLightBase * dayNightMultiplier * weatherLightMult;
        let canopyShade = 0;

        for (const plant of plants.values()) {
          for (const node of plant.nodes.values()) {
            if (node.layer !== 'canopy') continue;
            const tileX = this.worldToTileX(node.x);
            const tileZ = this.worldToTileZ(node.z);
            const dx = tileX - tx;
            const dz = tileZ - tz;
            const distSq = dx * dx + dz * dz;
            if (distSq < 16) {
              canopyShade += this.config.canopyShadeReduction * (1 - distSq / 16);
            }
          }
        }

        const light = clamp(baseLight - canopyShade, 0, this.config.maxLight);
        this.tiles[this.index(tx, tz)].light = light;
        this.markDirty(
          this.index(tx, tz),
          light,
          this.tiles[this.index(tx, tz)].moisture,
          this.tiles[this.index(tx, tz)].minerals,
        );
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
    // Use average light as proxy for sun intensity (0-100 scale)
    let totalLight = 0;
    for (let i = 0; i < this.tiles.length; i++) totalLight += this.tiles[i].light;
    const avgLight = totalLight / this.tiles.length;
    const sunIntensity = avgLight / 100; // 0-1
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

    for (let tz = 0; tz < this.height; tz++) {
      for (let tx = 0; tx < this.width; tx++) {
        const idx = this.index(tx, tz);
        let moisture = this.tiles[idx].moisture;

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
              const tileX = this.worldToTileX(node.x);
              const tileZ = this.worldToTileZ(node.z);
              const dx = tileX - tx;
              const dz = tileZ - tz;
              const distSq = dx * dx + dz * dz;
              if (distSq < 16) {
                canopyShade += this.config.canopyShadeReduction * (1 - distSq / 16);
              }
            }
          }
          // Transpiration loss proportional to canopy presence
          moisture -= transpirationRate * dt * Math.min(1, canopyShade * 10);
        }

        // Root absorption
        for (const plant of plants.values()) {
          for (const node of plant.nodes.values()) {
            if (node.layer !== 'root') continue;
            const tileX = this.worldToTileX(node.x);
            const tileZ = this.worldToTileZ(node.z);
            const dx = tileX - tx;
            const dz = tileZ - tz;
            const distSq = dx * dx + dz * dz;
            const radius = this.config.absorptionRadius;
            if (distSq <= radius * radius) {
              const falloff = 1 - Math.sqrt(distSq) / radius;
              const absorption = this.config.absorptionPerS * node.resourceDrawWater * dt * falloff;
              const actualAbsorption = Math.min(absorption, this.config.maxAbsorptionPerTick);
              moisture = Math.max(0, moisture - actualAbsorption);
            }
          }
        }

        this.tiles[idx].moisture = clamp(moisture, 0, this.config.maxMoisture);
        this.markDirty(
          idx,
          this.tiles[idx].light,
          this.tiles[idx].moisture,
          this.tiles[idx].minerals,
        );
      }
    }
  }

  private updateMinerals(dt: number, plants: Map<string, PlantForResource>): void {
    for (let tz = 0; tz < this.height; tz++) {
      for (let tx = 0; tx < this.width; tx++) {
        const idx = this.index(tx, tz);
        let minerals = this.tiles[idx].minerals;

        for (const plant of plants.values()) {
          for (const node of plant.nodes.values()) {
            if (node.layer !== 'root') continue;
            const tileX = this.worldToTileX(node.x);
            const tileZ = this.worldToTileZ(node.z);
            const dx = tileX - tx;
            const dz = tileZ - tz;
            const distSq = dx * dx + dz * dz;
            const radius = this.config.absorptionRadius;
            if (distSq <= radius * radius) {
              const falloff = 1 - Math.sqrt(distSq) / radius;
              const absorption =
                this.config.absorptionPerS * node.resourceDrawNutrients * dt * falloff;
              const actualAbsorption = Math.min(absorption, this.config.maxAbsorptionPerTick);
              minerals = Math.max(0, minerals - actualAbsorption);
            }
          }
        }

        this.tiles[idx].minerals = clamp(minerals, 0, this.config.maxMinerals);
        this.markDirty(
          idx,
          this.tiles[idx].light,
          this.tiles[idx].moisture,
          this.tiles[idx].minerals,
        );
      }
    }
  }

  private diffuseResources(): void {
    const newTiles = this.tiles.map((t) => ({ ...t }));
    const rate = this.config.diffusionRate;

    for (let tz = 0; tz < this.height; tz++) {
      for (let tx = 0; tx < this.width; tx++) {
        const idx = this.index(tx, tz);
        const current = this.tiles[idx];

        const neighbors: TileResources[] = [];
        if (tx > 0) neighbors.push(this.tiles[this.index(tx - 1, tz)]);
        if (tx < this.width - 1) neighbors.push(this.tiles[this.index(tx + 1, tz)]);
        if (tz > 0) neighbors.push(this.tiles[this.index(tx, tz - 1)]);
        if (tz < this.height - 1) neighbors.push(this.tiles[this.index(tx, tz + 1)]);

        if (neighbors.length === 0) continue;

        let lightSum = 0;
        let moistureSum = 0;
        let mineralsSum = 0;
        for (const neighbor of neighbors) {
          lightSum += neighbor.light;
          moistureSum += neighbor.moisture;
          mineralsSum += neighbor.minerals;
        }

        // Diffuse toward the mean of all neighbours, not the last one written.
        newTiles[idx].light = lerp(current.light, lightSum / neighbors.length, rate);
        newTiles[idx].moisture = lerp(current.moisture, moistureSum / neighbors.length, rate);
        newTiles[idx].minerals = lerp(current.minerals, mineralsSum / neighbors.length, rate);
      }
    }

    this.tiles = newTiles;
    for (let i = 0; i < this.tiles.length; i++) {
      this.markDirty(i, this.tiles[i].light, this.tiles[i].moisture, this.tiles[i].minerals);
    }
  }

  depositMinerals(worldX: number, worldZ: number, amount: number): void {
    const tx = this.clampTileX(this.worldToTileX(worldX));
    const tz = this.clampTileZ(this.worldToTileZ(worldZ));
    const idx = this.index(tx, tz);
    this.tiles[idx].minerals = clamp(this.tiles[idx].minerals + amount, 0, this.config.maxMinerals);
    this.markDirty(idx, this.tiles[idx].light, this.tiles[idx].moisture, this.tiles[idx].minerals);
  }

  depositMineralsAtTile(tileX: number, tileZ: number, amount: number): void {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) return;
    const idx = this.index(tileX, tileZ);
    this.tiles[idx].minerals = clamp(this.tiles[idx].minerals + amount, 0, this.config.maxMinerals);
    this.markDirty(idx, this.tiles[idx].light, this.tiles[idx].moisture, this.tiles[idx].minerals);
  }

  onRootNodeDeath(worldX: number, worldZ: number): void {
    this.depositMinerals(worldX, worldZ, this.config.deadRootDeposit);
  }

  onPlantDeath(plant: PlantForResource): void {
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

  calculatePhotosynthesis(plant: PlantForResource): PhotosynthesisResult {
    let totalBiomassGain = 0;
    let totalEnergyGain = 0;

    // Compute temperature for this step
    let totalLight = 0;
    for (let i = 0; i < this.tiles.length; i++) totalLight += this.tiles[i].light;
    const avgLight = totalLight / this.tiles.length;
    const sunIntensity = avgLight / this.config.maxLight;
    const temperature = this.computeTemperature(sunIntensity);

    // Temperature factor: Gaussian around optimum
    // At optimum: 1.0, at ±range: 0.5
    const tempDiff = temperature - this.config.photosynthesisTempOptimum;
    const tempRange = this.config.photosynthesisTempRange;
    const tempFactor = Math.exp(-(tempDiff * tempDiff) / (2 * tempRange * tempRange));

    for (const node of plant.nodes.values()) {
      if (node.type !== 'leaf') continue;

      const tileX = this.worldToTileX(node.x);
      const tileZ = this.worldToTileZ(node.z);
      const resources = this.getTileResourcesAt(tileX, tileZ);
      if (!resources) continue;

      const moistureFactor = this.evaluateCurve(
        this.config.moistureFactorCurve,
        resources.moisture / this.config.maxMoisture,
      );
      const mineralFactor = this.evaluateCurve(
        this.config.mineralFactorCurve,
        resources.minerals / this.config.maxMinerals,
      );

      const lightFactor = resources.light / this.config.maxLight;

      const biomassGain =
        lightFactor * moistureFactor * mineralFactor * tempFactor * this.config.photosynthesisRate;
      totalBiomassGain += biomassGain;

      const energyGain =
        lightFactor *
        moistureFactor *
        mineralFactor *
        tempFactor *
        this.config.photosynthesisEnergyPerSecond;
      totalEnergyGain += energyGain;
    }

    return { biomassGain: totalBiomassGain, energyGain: totalEnergyGain };
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
      for (let i = 0; i < this.tiles.length; i++) {
        const t = this.tiles[i];
        const tileZ = Math.floor(i / this.width);
        const tileX = i % this.width;
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
