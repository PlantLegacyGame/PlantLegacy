/**
 * The terrain field's tunables, read from the config map in one place.
 *
 * The server builds the ground from these numbers and the climate day tool
 * replays it; both used to map `config/terrain.json` by hand, with fallbacks the
 * file had outgrown (6 m of relief, a 7 m river, 0 m river centre). A renamed
 * key would have built two different planets without saying so. One loader means
 * a missing key throws for both.
 *
 * Not re-exported from `./index.ts`: that barrel is bundled for the browser and
 * this module reads the config loader, which touches the filesystem.
 */
import { type ConfigFile, readBoolean, readNumber } from '../config/index.ts';
import type { TerrainFieldParams } from './terrainField.ts';

export function loadTerrainFieldParams(configs: Map<string, ConfigFile>): TerrainFieldParams {
  return {
    seed: Math.round(readNumber(configs, 'terrain', 'seed')),
    amplitudeM: readNumber(configs, 'terrain', 'surface_amplitude_m'),
    baseFrequency: readNumber(configs, 'terrain', 'surface_base_frequency'),
    octaves: Math.round(readNumber(configs, 'terrain', 'surface_octaves')),
    lacunarity: readNumber(configs, 'terrain', 'surface_lacunarity'),
    gain: readNumber(configs, 'terrain', 'surface_gain'),
    ridgeStrength: readNumber(configs, 'terrain', 'ridge_strength'),
    patchRadiusM: readNumber(configs, 'terrain', 'patch_radius_m'),
    rimFadeFraction: readNumber(configs, 'terrain', 'rim_fade_fraction'),
    maxDepthM: readNumber(configs, 'terrain', 'max_depth_m'),
    soilDepthM: readNumber(configs, 'render', 'soil_depth_m'),
    // The river is cut into the shared field, so the server's ground and the
    // client's drawn ground are the same surface, channel included.
    riverEnabled: readBoolean(configs, 'terrain', 'river_enabled'),
    riverCenterZM: readNumber(configs, 'terrain', 'river_center_z_m'),
    riverWidthM: readNumber(configs, 'terrain', 'river_width_m'),
    riverDepthM: readNumber(configs, 'terrain', 'river_depth_m'),
    riverPathCellM: readNumber(configs, 'terrain', 'river_path_cell_m'),
    riverBankSlope: readNumber(configs, 'terrain', 'river_bank_slope'),
    riverBankApronM: readNumber(configs, 'terrain', 'river_bank_apron_m'),
    riverWaterDepthM: readNumber(configs, 'terrain', 'river_water_depth_m'),
    riverLengthM: readNumber(configs, 'terrain', 'river_length_m'),
  };
}
