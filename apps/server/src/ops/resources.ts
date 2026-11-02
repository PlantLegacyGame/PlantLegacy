import type { ConfigFile } from '@plant-legacy/shared/config';
import { readBoolean, readInteger, readNumber, readObject, readStringArray } from '@plant-legacy/shared/config';
// import { clamp } from '@plant-legacy/shared/math';

export interface ResourceConfig {
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
  lightFactorCurve: number[][];
  moistureFactorCurve: number[][];
  mineralFactorCurve: number[][];
  consumptionTriggerTileMineralThreshold: number;
  consumptionTriggerDungItem: boolean;
  consumptionTriggerFertilizerItem: boolean;
  diffusionRate: number;
  maxAbsorptionPerTick: number;
  canopyShadeReduction: number;
}

export interface TileResource {
  x: number;
  z: number;
  light: number;
  moisture: number;
  minerals: number;
}

export function loadResourceConfig(configs: Map<string, ConfigFile>): ResourceConfig {
  const dayNightCurveRaw = readStringArray(configs, 'resources', 'day_night_curve');
  const dayNightCurve = dayNightCurveRaw.map((v: string) => Number.parseFloat(v));
  return {
    tileSize: readNumber(configs, 'resources', 'tile_size'),
    gridWidth: readInteger(configs, 'resources', 'grid_width'),
    gridHeight: readInteger(configs, 'resources', 'grid_height'),
    tileLightBase: readInteger(configs, 'resources', 'tile_light_base'),
    dayNightCurve,
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
    lightFactorCurve: readObject(configs, 'resources', 'light_factor_curve') as number[][],
    moistureFactorCurve: readObject(configs, 'resources', 'moisture_factor_curve') as number[][],
    mineralFactorCurve: readObject(configs, 'resources', 'mineral_factor_curve') as number[][],
    consumptionTriggerTileMineralThreshold: readInteger(configs, 'resources', 'consumption_trigger_tile_mineral_threshold'),
    consumptionTriggerDungItem: readBoolean(configs, 'resources', 'consumption_trigger_dung_item'),
    consumptionTriggerFertilizerItem: readBoolean(configs, 'resources', 'consumption_trigger_fertilizer_item'),
    diffusionRate: readNumber(configs, 'resources', 'diffusion_rate'),
    maxAbsorptionPerTick: readNumber(configs, 'resources', 'max_absorption_per_tick'),
    canopyShadeReduction: readNumber(configs, 'resources', 'canopy_shade_reduction'),
  };
}
