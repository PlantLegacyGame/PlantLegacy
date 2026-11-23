/**
 * `config/terrain_volume.json` in one place.
 *
 * The client draws the region and the tests build it; a hand-copied table in
 * either would drift the moment the file changed, and a renamed key would build
 * a different rock instead of failing. Not re-exported from `./index.ts`: that
 * barrel is bundled for the browser and this reads the filesystem.
 */
import { type ConfigFile, readBoolean, readNumber } from '../config/index.ts';
import type { TerrainVolumeParams } from './terrainVolume.ts';

export function loadTerrainVolumeParams(configs: Map<string, ConfigFile>): TerrainVolumeParams {
  return {
    enabled: readBoolean(configs, 'terrain_volume', 'enabled'),
    centreXM: readNumber(configs, 'terrain_volume', 'centre_x_m'),
    centreZM: readNumber(configs, 'terrain_volume', 'centre_z_m'),
    voxelM: readNumber(configs, 'terrain_volume', 'voxel_size_m'),
    marginM: readNumber(configs, 'terrain_volume', 'margin_m'),
    legDepthM: readNumber(configs, 'terrain_volume', 'leg_depth_m'),
    seed: Math.round(readNumber(configs, 'terrain_volume', 'seed')),
    spanM: readNumber(configs, 'terrain_volume', 'span_m'),
    riseM: readNumber(configs, 'terrain_volume', 'rise_m'),
    thicknessM: readNumber(configs, 'terrain_volume', 'thickness_m'),
    widthM: readNumber(configs, 'terrain_volume', 'width_m'),
    bearingDeg: readNumber(configs, 'terrain_volume', 'bearing_deg'),
    strataBandM: readNumber(configs, 'terrain_volume', 'strata_band_m'),
  };
}
