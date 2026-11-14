/**
 * The ground field: one deterministic height function for the whole world.
 *
 * The server and the client must agree on where the surface is, or roots grow
 * through hills and plants stand in the air. This module is the single source
 * of that answer. It is pure and imports nothing (no THREE, no DOM), so the
 * server can call it inside the simulation tick and the client can call it per
 * vertex.
 *
 * Coordinates are the simulation's pole-local metres: x/z measured across the
 * surface from the planet's pole, y measured from the tangent plane there. The
 * client adds `planetSurfaceY()` for the planet's curvature; the server never
 * needs it, because the whole play area is within a rounding error of flat for
 * gameplay distances.
 *
 * The noise is an integer hash, not `Math.sin`-based: `Math.sin` is not
 * guaranteed to be bit-identical across JavaScript engines, and the client and
 * server build separate mesh/height arrays from this function.
 */

/** All terrain tunables. Values come from `config/terrain.json`. */
export interface TerrainFieldParams {
  /** World seed: the same seed always produces the same ground. */
  seed: number;
  /** Peak relief above the base surface, in metres. */
  amplitudeM: number;
  /** Base noise frequency in cycles per metre. */
  baseFrequency: number;
  /** Octave count, 1-6. */
  octaves: number;
  /** Frequency multiplier per octave. */
  lacunarity: number;
  /** Amplitude multiplier per octave. */
  gain: number;
  /** 0 = rolling hills, 1 = sharp ridges. */
  ridgeStrength: number;
  /** Radius the relief is authored for, in metres. */
  patchRadiusM: number;
  /** How far the relief fades out at the patch rim (0.1-1 of the radius). */
  rimFadeFraction: number;
  /** Deepest soil the simulation lets roots reach, metres below the surface. */
  maxDepthM: number;
  /** Depth of the topsoil layer, metres. Below it is subsoil, then bedrock. */
  soilDepthM: number;
}

/** Material at a depth below the local surface. */
export type TerrainMaterial = 'topsoil' | 'subsoil' | 'bedrock';

export interface TerrainSample {
  /** Height above the base sphere/tangent plane, metres. */
  heightM: number;
  /** Unit normal of the surface at this point, in the local frame. */
  normal: { x: number; y: number; z: number };
  /** Slope in radians, 0 flat. */
  slopeRad: number;
  /** Material of the surface itself. */
  surface: TerrainMaterial;
}

export const DEFAULT_TERRAIN_FIELD: TerrainFieldParams = {
  seed: 1337,
  amplitudeM: 6,
  baseFrequency: 0.045,
  octaves: 4,
  lacunarity: 2,
  gain: 0.5,
  ridgeStrength: 0.35,
  patchRadiusM: 620,
  rimFadeFraction: 0.28,
  maxDepthM: 12,
  soilDepthM: 1.6,
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Integer hash of a lattice point. FNV-style mixing with imul: exact 32-bit
 * integer arithmetic on every engine, unlike a sine hash.
 */
function hash2i(x: number, z: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smoothstep01 = (t: number): number => t * t * (3 - 2 * t);

/** Bilinear value noise in [0, 1]. */
export function terrainValueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = smoothstep01(x - xi);
  const zf = smoothstep01(z - zi);
  const h00 = hash2i(xi, zi, seed);
  const h10 = hash2i(xi + 1, zi, seed);
  const h01 = hash2i(xi, zi + 1, seed);
  const h11 = hash2i(xi + 1, zi + 1, seed);
  const top = h00 + (h10 - h00) * xf;
  const bottom = h01 + (h11 - h01) * xf;
  return top + (bottom - top) * zf;
}

/**
 * Fractal relief in [0, 1]. Higher octaves add the metre-scale detail; the
 * ridge blend sharpens crests without introducing a separate noise field.
 */
export function terrainUnitAt(params: TerrainFieldParams, x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0.5;
  const octaves = Math.max(1, Math.min(6, Math.round(params.octaves)));
  const frequencyStep = Math.max(1.1, params.lacunarity);
  const gain = Math.max(0, Math.min(1, params.gain));
  let frequency = Math.max(0.0001, params.baseFrequency);
  let amplitude = 1;
  let sum = 0;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    const value = terrainValueNoise(
      x * frequency + i * 17.31,
      z * frequency - i * 9.17,
      params.seed + i * 1013,
    );
    sum += value * amplitude;
    total += amplitude;
    frequency *= frequencyStep;
    amplitude *= gain;
  }
  const base = total > 0 ? sum / total : 0.5;
  // Ridge noise is 1 at the crest of the underlying field. Blending it in
  // keeps valleys where the base field puts them.
  const ridge = 1 - Math.abs(base * 2 - 1);
  const strength = clamp01(params.ridgeStrength);
  return clamp01(base * (1 - strength) + ridge * strength);
}

/**
 * Relief fades to zero at the rim of the authored patch so the detailed ground
 * meets the smooth planet exactly: no step at the edge, no seam.
 */
export function terrainRimScale(params: TerrainFieldParams, x: number, z: number): number {
  const radius = Math.max(0, params.patchRadiusM);
  if (!(radius > 0)) return 0;
  const distance = Math.hypot(x, z);
  const fadeFraction = Math.min(0.95, Math.max(0.02, params.rimFadeFraction));
  const inner = radius * (1 - fadeFraction);
  if (distance <= inner) return 1;
  if (distance >= radius) return 0;
  return smoothstep01(1 - (distance - inner) / (radius - inner));
}

/**
 * Height above the base surface in metres. Raise-only: the base sphere is also
 * the physics floor, so a dip below it would be an invisible hole the player
 * stands at the bottom of.
 */
export function terrainHeightAt(params: TerrainFieldParams, x: number, z: number): number {
  if (!(params.amplitudeM > 0)) return 0;
  return terrainUnitAt(params, x, z) * params.amplitudeM * terrainRimScale(params, x, z);
}

/** Central-difference surface normal, in the local (x, up, z) frame. */
export function terrainNormalAt(
  params: TerrainFieldParams,
  x: number,
  z: number,
  epsilonM = 0.5,
): { x: number; y: number; z: number } {
  const e = Math.max(0.001, epsilonM);
  const left = terrainHeightAt(params, x - e, z);
  const right = terrainHeightAt(params, x + e, z);
  const back = terrainHeightAt(params, x, z - e);
  const front = terrainHeightAt(params, x, z + e);
  const dx = (right - left) / (2 * e);
  const dz = (front - back) / (2 * e);
  const length = Math.hypot(dx, 1, dz);
  return { x: -dx / length, y: 1 / length, z: -dz / length };
}

/** Slope in radians from the local vertical. */
export function terrainSlopeAt(
  params: TerrainFieldParams,
  x: number,
  z: number,
  epsilonM = 0.5,
): number {
  const normal = terrainNormalAt(params, x, z, epsilonM);
  return Math.acos(Math.max(-1, Math.min(1, normal.y)));
}

/**
 * Material at `depthM` below the local surface. Negative depths (above the
 * surface) report topsoil.
 */
export function terrainMaterialAt(params: TerrainFieldParams, depthM: number): TerrainMaterial {
  const depth = Math.max(0, depthM);
  if (depth <= Math.max(0.01, params.soilDepthM)) return 'topsoil';
  if (depth <= Math.max(0.02, params.maxDepthM)) return 'subsoil';
  return 'bedrock';
}

/** Everything a renderer or a validator needs at one surface point. */
export function sampleTerrain(
  params: TerrainFieldParams,
  x: number,
  z: number,
  epsilonM = 0.5,
): TerrainSample {
  const heightM = terrainHeightAt(params, x, z);
  const normal = terrainNormalAt(params, x, z, epsilonM);
  return {
    heightM,
    normal,
    slopeRad: Math.acos(Math.max(-1, Math.min(1, normal.y))),
    surface: terrainMaterialAt(params, 0),
  };
}
