/**
 * AL-04: the shared atmosphere model.
 *
 * Every material that sees distance needs the same air. Before this module the
 * scene had four independent approximations - `THREE.Fog` on the scene, a fog
 * tint in the ground shader, another inside the plant SDF shader, and the sky
 * dome's own gradient - so a hill, the grass on it and the plant standing on it
 * all faded differently.
 *
 * This module is the single definition, in two mirrored forms:
 *
 * - the TypeScript functions below, for CPU-side colours (fog colour, debug
 *   readouts, tests);
 * - `GLSL_ATMOSPHERE`, a snippet generated here so the shaders use the same
 *   constants and the same shape of maths.
 *
 * Nothing here allocates per frame: every function writes into an `out` tuple
 * the caller owns.
 */

import type { RenderConfig } from '../../config/clientConfig.js';

export interface AtmosphereParams {
  /** Extinction per metre at sea level, linear RGB. */
  extinction: readonly [number, number, number];
  /** Height over which density falls by 1/e, in metres. */
  scaleHeightM: number;
  /** Henyey-Greenstein anisotropy, -1..1. Positive scatters forward. */
  sunPhaseG: number;
  /** Strength of sun in-scatter mixed into a fogged surface. */
  inScatter: number;
  /** Extra optical depth at grazing angles, so the horizon reads heavier. */
  horizonBoost: number;
}

export type Rgb = [number, number, number];

/** Art-directed hazy day, not Earth air: the world is smaller than a planet. */
export const DEFAULT_ATMOSPHERE: AtmosphereParams = {
  extinction: [0.00075, 0.0009, 0.0013],
  scaleHeightM: 700,
  sunPhaseG: 0.72,
  inScatter: 0.6,
  horizonBoost: 0.4,
};

/** Build the model from the flat render config, with safe clamps. */
export function atmosphereFromConfig(config: RenderConfig): AtmosphereParams {
  const finite = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;
  const [fallbackR, fallbackG, fallbackB] = DEFAULT_ATMOSPHERE.extinction;
  return {
    extinction: [
      Math.max(0, finite(config.atmosphereExtinction?.[0] ?? fallbackR, fallbackR)),
      Math.max(0, finite(config.atmosphereExtinction?.[1] ?? fallbackG, fallbackG)),
      Math.max(0, finite(config.atmosphereExtinction?.[2] ?? fallbackB, fallbackB)),
    ],
    scaleHeightM: Math.max(
      1,
      finite(config.atmosphereScaleHeightM, DEFAULT_ATMOSPHERE.scaleHeightM),
    ),
    sunPhaseG: clamp(finite(config.atmosphereSunPhaseG, DEFAULT_ATMOSPHERE.sunPhaseG), -0.95, 0.95),
    inScatter: Math.max(0, finite(config.atmosphereInScatter, DEFAULT_ATMOSPHERE.inScatter)),
    horizonBoost: Math.max(
      0,
      finite(config.atmosphereHorizonBoost, DEFAULT_ATMOSPHERE.horizonBoost),
    ),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Relative air density at a height above the reference level: 1 at the ground,
 * falling exponentially with `scaleHeightM`.
 */
export function heightDensity(heightM: number, params: AtmosphereParams): number {
  const height = Math.max(0, heightM);
  return Math.exp(-height / Math.max(1, params.scaleHeightM));
}

/**
 * Kasten-Young relative air mass: 1 straight up, roughly 19 along the horizon.
 * Grazing views cross far more air than overhead views, which is what makes a
 * horizon read heavy and a zenith read thin.
 */
export function airMass(cosZenith: number): number {
  const cos = clamp(cosZenith, 0, 1);
  const zenithDeg = (Math.acos(cos) * 180) / Math.PI;
  const denominator = cos + 0.50572 * (96.07995 - zenithDeg) ** -1.6364;
  return 1 / Math.max(1e-4, denominator);
}

/** Vertical optical depth of the whole column, in extinction units. */
export function verticalOpticalDepth(params: AtmosphereParams): number {
  return Math.max(1, params.scaleHeightM);
}

/**
 * Transmittance along a segment: how much of a surface colour survives the air
 * between it and the camera. 1 at zero distance, falling per channel, blue
 * fastest because its extinction is highest.
 */
export function transmittance(
  distanceM: number,
  heightM: number,
  params: AtmosphereParams,
  out: Rgb = [1, 1, 1],
): Rgb {
  const distance = Math.max(0, distanceM);
  const density = heightDensity(heightM, params);
  const boost = 1 + params.horizonBoost * (1 - density);
  out[0] = Math.exp(-params.extinction[0] * distance * density * boost);
  out[1] = Math.exp(-params.extinction[1] * distance * density * boost);
  out[2] = Math.exp(-params.extinction[2] * distance * density * boost);
  return out;
}

/**
 * Transmittance along a ray whose two ends sit at different heights.
 *
 * The single-height version asks the air density at the *surface* point, which
 * is right for a world seen from inside its own air and wrong for every other
 * view: standing 40 km up, a hill 20 km away was still fogged with sea-level
 * air, so the whole planet washed toward the sky's white while the sky itself
 * went dark. Density is integrated along the chord instead - four midpoints
 * between the eye's height and the target's - which is what gives distant
 * terrain the graded, bluer haze of aerial perspective and leaves the near
 * ground almost untouched.
 */
export function transmittanceRay(
  distanceM: number,
  eyeHeightM: number,
  targetHeightM: number,
  params: AtmosphereParams,
  samples = RAY_SAMPLES,
  out: Rgb = [1, 1, 1],
): Rgb {
  const distance = Math.max(0, distanceM);
  const steps = Math.max(1, Math.floor(samples));
  let density = 0;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps;
    density += heightDensity(eyeHeightM + (targetHeightM - eyeHeightM) * t, params);
  }
  density /= steps;
  const boost = 1 + params.horizonBoost * (1 - density);
  out[0] = Math.exp(-params.extinction[0] * distance * density * boost);
  out[1] = Math.exp(-params.extinction[1] * distance * density * boost);
  out[2] = Math.exp(-params.extinction[2] * distance * density * boost);
  return out;
}

/** How many midpoints the ray transmittance integrates; the GLSL mirror uses 4. */
export const RAY_SAMPLES = 4;

/**
 * Henyey-Greenstein phase, normalised so an isotropic lobe (g = 0) equals 1.
 * The GLSL mirror returns the same numbers; keep the two in step.
 */
export function phaseHG(cosTheta: number, g: number): number {
  const safeG = clamp(g, -0.95, 0.95);
  const denominator = 1 + safeG * safeG - 2 * safeG * clamp(cosTheta, -1, 1);
  return (1 - safeG * safeG) / denominator ** 1.5;
}

/**
 * Colour of the air the sun is shining through, as seen looking along
 * `viewDir`. This is what a fogged surface fades toward, so the sky, the ground
 * and the plants all agree at the horizon.
 */
export function inScatterColor(
  viewDir: readonly [number, number, number],
  sunDir: readonly [number, number, number],
  params: AtmosphereParams,
  out: Rgb = [0, 0, 0],
): Rgb {
  const cosTheta = clamp(
    viewDir[0] * sunDir[0] + viewDir[1] * sunDir[1] + viewDir[2] * sunDir[2],
    -1,
    1,
  );
  const phase = phaseHG(cosTheta, params.sunPhaseG);
  // Sunlight reaching the scattering volume, dimmed by its own column.
  const sunCos = clamp(sunDir[1], 0, 1);
  const sunColumn = verticalOpticalDepth(params) * airMass(sunCos);
  const strength = params.inScatter * phase;
  out[0] = Math.exp(-params.extinction[0] * sunColumn) * strength;
  out[1] = Math.exp(-params.extinction[1] * sunColumn) * strength;
  out[2] = Math.exp(-params.extinction[2] * sunColumn) * strength;
  return out;
}

/**
 * Blend a surface colour toward the air in front of it. `distanceM` is the
 * distance to the surface, `heightM` its height above the reference level.
 */
export function applyAtmosphere(
  surface: readonly [number, number, number],
  viewDir: readonly [number, number, number],
  sunDir: readonly [number, number, number],
  distanceM: number,
  heightM: number,
  params: AtmosphereParams,
  out: Rgb = [0, 0, 0],
): Rgb {
  const t = transmittance(distanceM, heightM, params);
  const scatter = inScatterColor(viewDir, sunDir, params);
  out[0] = surface[0] * t[0] + scatter[0] * (1 - t[0]);
  out[1] = surface[1] * t[1] + scatter[1] * (1 - t[1]);
  out[2] = surface[2] * t[2] + scatter[2] * (1 - t[2]);
  return out;
}

/** Blend a surface toward the air in front of it, with both heights known. */
export function applyAtmosphereRay(
  surface: readonly [number, number, number],
  viewDir: readonly [number, number, number],
  sunDir: readonly [number, number, number],
  distanceM: number,
  eyeHeightM: number,
  targetHeightM: number,
  params: AtmosphereParams,
  out: Rgb = [0, 0, 0],
): Rgb {
  const t = transmittanceRay(distanceM, eyeHeightM, targetHeightM, params);
  const scatter = inScatterColor(viewDir, sunDir, params);
  out[0] = surface[0] * t[0] + scatter[0] * (1 - t[0]);
  out[1] = surface[1] * t[1] + scatter[1] * (1 - t[1]);
  out[2] = surface[2] * t[2] + scatter[2] * (1 - t[2]);
  return out;
}

/** Uniform names shared by every material that uses the model. */
export const ATMOSPHERE_UNIFORMS = [
  'uAtmoExtinction',
  'uAtmoScaleHeight',
  'uAtmoSunPhaseG',
  'uAtmoInScatter',
  'uAtmoHorizonBoost',
] as const;

/** Values for those uniforms, ready to wrap in whatever the renderer expects. */
export function atmosphereUniformValues(params: AtmosphereParams): Record<string, number | Rgb> {
  return {
    uAtmoExtinction: [...params.extinction] as Rgb,
    uAtmoScaleHeight: Math.max(1, params.scaleHeightM),
    uAtmoSunPhaseG: clamp(params.sunPhaseG, -0.95, 0.95),
    uAtmoInScatter: Math.max(0, params.inScatter),
    uAtmoHorizonBoost: Math.max(0, params.horizonBoost),
  };
}

/**
 * GLSL3 snippet mirroring the functions above. Materials include this instead
 * of writing their own fog, so every surface fades the same way.
 *
 * Expects `uAtmoExtinction` (vec3), `uAtmoScaleHeight`, `uAtmoSunPhaseG`,
 * `uAtmoInScatter`, `uAtmoHorizonBoost` (float) to be declared by the material.
 */
export const GLSL_ATMOSPHERE = /* glsl */ `
float atmoHeightDensity(float heightM) {
  return exp(-max(0.0, heightM) / max(1.0, uAtmoScaleHeight));
}

float atmoAirMass(float cosZenith) {
  float cosZ = clamp(cosZenith, 0.0, 1.0);
  float zenithDeg = degrees(acos(cosZ));
  float denominator = cosZ + 0.50572 * pow(96.07995 - zenithDeg, -1.6364);
  return 1.0 / max(1e-4, denominator);
}

vec3 atmoTransmittance(float distanceM, float heightM) {
  float density = atmoHeightDensity(heightM);
  float boost = 1.0 + uAtmoHorizonBoost * (1.0 - density);
  return exp(-uAtmoExtinction * max(0.0, distanceM) * density * boost);
}

float atmoPhaseHG(float cosTheta, float g) {
  float safeG = clamp(g, -0.95, 0.95);
  float denominator = 1.0 + safeG * safeG - 2.0 * safeG * clamp(cosTheta, -1.0, 1.0);
  return (1.0 - safeG * safeG) / pow(denominator, 1.5);
}

vec3 atmoInScatter(vec3 viewDir, vec3 sunDir) {
  float phase = atmoPhaseHG(dot(viewDir, sunDir), uAtmoSunPhaseG);
  float sunColumn = max(1.0, uAtmoScaleHeight) * atmoAirMass(clamp(sunDir.y, 0.0, 1.0));
  return exp(-uAtmoExtinction * sunColumn) * uAtmoInScatter * phase;
}

// Density integrated along the chord between the eye and the surface. Four
// midpoints is enough for a smooth exponential and cheap enough for the ground.
vec3 atmoTransmittanceRay(float distanceM, float eyeHeightM, float targetHeightM) {
  float density = 0.0;
  for (int i = 0; i < 4; i++) {
    float t = (float(i) + 0.5) * 0.25;
    density += atmoHeightDensity(mix(eyeHeightM, targetHeightM, t));
  }
  density *= 0.25;
  float boost = 1.0 + uAtmoHorizonBoost * (1.0 - density);
  return exp(-uAtmoExtinction * max(0.0, distanceM) * density * boost);
}

vec3 atmoApplyRay(
  vec3 surface,
  vec3 viewDir,
  vec3 sunDir,
  float distanceM,
  float eyeHeightM,
  float targetHeightM
) {
  vec3 t = atmoTransmittanceRay(distanceM, eyeHeightM, targetHeightM);
  vec3 scatter = atmoInScatter(viewDir, sunDir);
  return surface * t + scatter * (1.0 - t);
}

vec3 atmoApply(vec3 surface, vec3 viewDir, vec3 sunDir, float distanceM, float heightM) {
  vec3 t = atmoTransmittance(distanceM, heightM);
  vec3 scatter = atmoInScatter(viewDir, sunDir);
  return surface * t + scatter * (1.0 - t);
}
`;
