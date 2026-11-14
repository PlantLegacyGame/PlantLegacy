/**
 * The live terrain field parameters.
 *
 * The field itself is pure and lives in `@plant-legacy/shared/world`; this
 * module only carries the values loaded from `/config/terrain` so every client
 * subsystem (ground mesh, physics colliders, plant placement, camera clamp,
 * Root Sight occlusion) samples the same field with the same seed.
 */
import {
  DEFAULT_TERRAIN_FIELD,
  type TerrainFieldParams,
  terrainHeightAt,
  terrainNormalAt,
  terrainSlopeAt,
} from '@plant-legacy/shared/world';
import type { TerrainConfig } from '../../config/clientConfig.js';

let params: TerrainFieldParams = { ...DEFAULT_TERRAIN_FIELD };

/** Convert the wire config into the shared field parameters. */
export function terrainFieldFromConfig(
  config: TerrainConfig,
  soilDepthM = 1.6,
): TerrainFieldParams {
  return {
    seed: Math.round(config.seed),
    amplitudeM: Math.max(0, config.surfaceAmplitudeM),
    baseFrequency: config.surfaceBaseFrequency,
    octaves: config.surfaceOctaves,
    lacunarity: config.surfaceLacunarity,
    gain: config.surfaceGain,
    ridgeStrength: config.ridgeStrength,
    patchRadiusM: config.patchRadiusM,
    rimFadeFraction: config.rimFadeFraction,
    maxDepthM: config.maxDepthM,
    soilDepthM,
  };
}

export function configureTerrain(config: TerrainConfig, soilDepthM?: number): void {
  params = terrainFieldFromConfig(config, soilDepthM);
}

export function getTerrainParams(): TerrainFieldParams {
  return params;
}

/** Relief above the base surface at a pole-local (x, z), in metres. */
export function surfaceHeightAt(x: number, z: number): number {
  return terrainHeightAt(params, x, z);
}

export function surfaceNormalAt(
  x: number,
  z: number,
  epsilonM = 0.5,
): { x: number; y: number; z: number } {
  return terrainNormalAt(params, x, z, epsilonM);
}

export function surfaceSlopeAt(x: number, z: number): number {
  return terrainSlopeAt(params, x, z);
}
