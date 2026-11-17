/**
 * "Is this point under the soil?" answered against the drawn ground.
 *
 * The world is a sphere with relief, so world Y alone cannot answer it: terrain
 * reaches `surface_amplitude_m` above the tangent plane, and a camera on a rise
 * can be metres inside the hill with a positive Y. Comparing against zero made
 * the root-layer camera floor, the spring-arm skip, root picking and the
 * underground view all treat a buried eye on a hill as if it were above ground.
 *
 * `EnvironmentRenderer` already compares against `planetTerrainY`; this module is
 * that comparison, in one place and testable without a DOM.
 */
import type { TerrainFieldParams } from '@plant-legacy/shared/world';
import { planetTerrainY, TERRAIN_SKIN_M } from '../renderers/environment/planetSurface.ts';

/** Everything needed to find the ground under a point. */
export interface SoilSurface {
  /** `render.json` `planet_radius_m`; 0 is the flat world. */
  planetRadiusM: number;
  /** The shared terrain field (`config/terrain.json`). */
  terrain: TerrainFieldParams;
}

/** World-space height of the drawn ground at (x, z). */
export function groundWorldY(surface: SoilSurface, x: number, z: number): number {
  return planetTerrainY(surface.planetRadiusM, x, z, surface.terrain);
}

/**
 * True when `point` sits below the drawn soil at its own (x, z).
 *
 * The tolerance defaults to the terrain skin: a camera resting exactly on the
 * drawn ground is on the surface, not under it. Pass a larger tolerance (for
 * example 0.05) when the caller wants "clearly underground" rather than "level
 * with the soil".
 */
export function isBelowSoil(
  point: { x: number; y: number; z: number },
  surface: SoilSurface,
  toleranceM: number = TERRAIN_SKIN_M,
): boolean {
  if (!Number.isFinite(point.y)) return false;
  return point.y < groundWorldY(surface, point.x, point.z) - toleranceM;
}
