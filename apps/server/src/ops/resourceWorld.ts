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
  tileMineralsBase: number;
  absorptionPerS: number;
  absorptionRadius: number;
  deadRootDeposit: number;
  deadPlantDeposit: number;
  dungDeposit: number;
  fertilizerDeposit: number;
  photosynthesisRate: number;
  lightFactorCurve: [number, number][];
  moistureFactorCurve: [number, number][];
  mineralFactorCurve: [number, number][];
  consumptionTriggerTileMineralThreshold: number;
  consumptionTriggerDungItem: boolean;
  consumptionTriggerFertilizerItem: boolean;
  diffusionRate: number;
  maxAbsorptionPerTick: number;
  canopyShadeReduction: number;
}

export interface TileResources {
  light: number;
  moisture: number;
  minerals: number;
}

export interface ResourceWorldState {
  tiles: TileResources[];
  width: number;
  height: number;
  tileSize: number;
  tick: number;
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
    tileMineralsBase: readInteger(configs, 'resources', 'tile_minerals_base'),
    absorptionPerS: readNumber(configs, 'resources', 'absorption_per_s'),
    absorptionRadius: readNumber(configs, 'resources', 'absorption_radius'),
    deadRootDeposit: readNumber(configs, 'resources', 'dead_root_deposit'),
    deadPlantDeposit: readNumber(configs, 'resources', 'dead_plant_deposit'),
    dungDeposit: readNumber(configs, 'resources', 'dung_deposit'),
    fertilizerDeposit: readNumber(configs, 'resources', 'fertilizer_deposit'),
    photosynthesisRate: readNumber(configs, 'resources', 'photosynthesis_rate'),
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
        light: config.tileLightBase,
        moisture: config.tileMoistureBase,
        minerals: config.tileMineralsBase,
      };
    }
  }

  private index(x: number, z: number): number {
    return z * this.width + x;
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

  getAllTiles(): TileResources[] {
    return this.tiles.map((t) => ({ ...t }));
  }

  step(dt: number, plants: Map<string, PlantForResource>): void {
    this.tick++;
    this.updateLight(plants);
    this.updateMoisture(dt, plants);
    this.updateMinerals(dt, plants);
    this.diffuseResources();
  }

  private updateLight(plants: Map<string, PlantForResource>): void {
    const dayNightIndex = Math.floor(this.timeOfDay * this.config.dayNightCurve.length);
    const dayNightMultiplier = this.config.dayNightCurve[dayNightIndex] ?? 1.0;

    for (let tz = 0; tz < this.height; tz++) {
      for (let tx = 0; tx < this.width; tx++) {
        const baseLight = this.config.tileLightBase * dayNightMultiplier;
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

        const light = clamp(baseLight - canopyShade, 0, 100);
        this.tiles[this.index(tx, tz)].light = light;
      }
    }
  }

  private updateMoisture(dt: number, plants: Map<string, PlantForResource>): void {
    for (let tz = 0; tz < this.height; tz++) {
      for (let tx = 0; tx < this.width; tx++) {
        const idx = this.index(tx, tz);
        let moisture = this.tiles[idx].moisture;

        if (this.isRaining) {
          moisture += this.config.rainGainPerS * dt;
        }

        moisture -= this.config.evaporationPerS * dt;

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

        this.tiles[idx].moisture = clamp(moisture, 0, 100);
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

        this.tiles[idx].minerals = clamp(minerals, 0, 100);
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

        for (const neighbor of neighbors) {
          newTiles[idx].light = lerp(current.light, neighbor.light, rate);
          newTiles[idx].moisture = lerp(current.moisture, neighbor.moisture, rate);
          newTiles[idx].minerals = lerp(current.minerals, neighbor.minerals, rate);
        }
      }
    }

    this.tiles = newTiles;
  }

  depositMinerals(worldX: number, worldZ: number, amount: number): void {
    const tx = this.clampTileX(this.worldToTileX(worldX));
    const tz = this.clampTileZ(this.worldToTileZ(worldZ));
    const idx = this.index(tx, tz);
    this.tiles[idx].minerals = clamp(this.tiles[idx].minerals + amount, 0, 100);
  }

  depositMineralsAtTile(tileX: number, tileZ: number, amount: number): void {
    if (tileX < 0 || tileX >= this.width || tileZ < 0 || tileZ >= this.height) return;
    const idx = this.index(tileX, tileZ);
    this.tiles[idx].minerals = clamp(this.tiles[idx].minerals + amount, 0, 100);
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

  calculatePhotosynthesis(plant: PlantForResource): number {
    let totalBiomassGain = 0;

    for (const node of plant.nodes.values()) {
      if (node.type !== 'leaf') continue;

      const tileX = this.worldToTileX(node.x);
      const tileZ = this.worldToTileZ(node.z);
      const resources = this.getTileResourcesAt(tileX, tileZ);
      if (!resources) continue;

      const moistureFactor = this.evaluateCurve(
        this.config.moistureFactorCurve,
        resources.moisture / 100,
      );
      const mineralFactor = this.evaluateCurve(
        this.config.mineralFactorCurve,
        resources.minerals / 100,
      );

      const biomassGain =
        (resources.light / 100) * moistureFactor * mineralFactor * this.config.photosynthesisRate;
      totalBiomassGain += biomassGain;
    }

    return totalBiomassGain;
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
    return {
      tiles: this.tiles.map((t) => ({ ...t })),
      width: this.width,
      height: this.height,
      tileSize: this.config.tileSize,
      tick: this.tick,
    };
  }
}
