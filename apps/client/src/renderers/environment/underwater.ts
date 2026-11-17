/**
 * What it looks like to be *in* the water instead of on it.
 *
 * The water field draws surfaces: puddles, the river, the water table. None of
 * that changes anything when the camera goes under one, so a swim read exactly
 * like a walk — same sky, same fog, same clear air. This module owns the answer
 * to "how much water is over the eye, and what does that do to the view?", and
 * nothing else: the renderer applies it, the caller samples the surfaces.
 *
 * The physics is the same Beer–Lambert absorption the water shader uses for its
 * own body colour (`exp(-depth · k)`), so a shallow dive is barely tinted and a
 * deep one goes dark and green at the same rate the drawn water does.
 */

/** One drawn water surface over the eye's column of water. */
export interface WaterSurfaceSample {
  /** Absolute world height of the surface, metres. */
  height: number;
  kind: 'puddle' | 'river' | 'table' | 'sea';
}

/** The surface query a water field answers for one point on the ground. */
export type WaterSurfaceOverPoint = WaterSurfaceSample;

export interface UnderwaterTuning {
  /** Metres of water that halve the light. Matches the water material. */
  absorptionPerM: number;
  /** Shallowest water that counts as submerged; a wet film is not a dive. */
  minDepthM: number;
  /** The tint is fully saturated at this depth. */
  tintDepthM: number;
  /** Screen tint alpha at full saturation. */
  tintMaxOpacity: number;
  /** Fog distance multipliers at full saturation. */
  fogNearScale: number;
  fogFarScale: number;
  /** Sun intensity multiplier at full saturation. */
  sunScale: number;
}

export const DEFAULT_UNDERWATER_TUNING: UnderwaterTuning = {
  absorptionPerM: 1.6,
  minDepthM: 0.06,
  // Two metres down the view is water, not air: past that, more depth mostly
  // means darker, and the absorption term carries that.
  tintDepthM: 1.8,
  tintMaxOpacity: 0.72,
  fogNearScale: 0.06,
  fogFarScale: 0.12,
  sunScale: 0.45,
};

export interface UnderwaterState {
  submerged: boolean;
  /** Metres of water above the eye. */
  depthM: number;
  /** Height of the surface the eye is under (0 when not submerged). */
  surfaceY: number;
  kind: WaterSurfaceSample['kind'] | null;
  /** Share of light reaching the eye, `exp(-depth · k)` in 0..1. */
  transmission: number;
  /** 0 in air, 1 fully tinted — drives overlay opacity and fog scaling. */
  amount: number;
}

export const AIR_STATE: UnderwaterState = {
  submerged: false,
  depthM: 0,
  surfaceY: 0,
  kind: null,
  transmission: 1,
  amount: 0,
};

/** The highest surface over this column of water that the eye is below. */
export function sampleUnderwater(
  eyeY: number,
  surfaces: readonly WaterSurfaceSample[],
  tuning: UnderwaterTuning = DEFAULT_UNDERWATER_TUNING,
): UnderwaterState {
  if (!Number.isFinite(eyeY)) return AIR_STATE;
  let best: WaterSurfaceSample | null = null;
  let bestDepth = 0;
  for (const surface of surfaces) {
    if (!Number.isFinite(surface.height)) continue;
    const depth = surface.height - eyeY;
    if (depth < tuning.minDepthM) continue;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = surface;
    }
  }
  if (!best) return AIR_STATE;

  const absorption = Number.isFinite(tuning.absorptionPerM)
    ? Math.max(0, tuning.absorptionPerM)
    : 0;
  const span = Math.max(0.05, tuning.tintDepthM);
  return {
    submerged: true,
    depthM: bestDepth,
    surfaceY: best.height,
    kind: best.kind,
    transmission: Math.exp(-bestDepth * absorption),
    amount: Math.min(1, bestDepth / span),
  };
}

export interface UnderwaterFog {
  near: number;
  far: number;
}

/**
 * Pull the atmospheric fog in to what water allows.
 *
 * Fog is the cheapest honest "you are inside something": light scatters out
 * within a couple of metres underwater, so distance collapses while the surface
 * stays visible overhead.
 */
export function underwaterFog(
  air: UnderwaterFog,
  state: UnderwaterState,
  tuning: UnderwaterTuning = DEFAULT_UNDERWATER_TUNING,
): UnderwaterFog {
  if (!state.submerged) return air;
  const nearScale = 1 - state.amount * (1 - tuning.fogNearScale);
  const farScale = 1 - state.amount * (1 - tuning.fogFarScale);
  return {
    near: Math.min(air.near, air.near * nearScale),
    far: Math.min(air.far, air.far * farScale),
  };
}

/** Sunlight reaching the eye: water eats the direct beam as it gets deeper. */
export function underwaterSunIntensity(
  airIntensity: number,
  state: UnderwaterState,
  tuning: UnderwaterTuning = DEFAULT_UNDERWATER_TUNING,
): number {
  if (!state.submerged) return airIntensity;
  const scale = 1 - state.amount * (1 - tuning.sunScale);
  return airIntensity * (scale * 0.5 + state.transmission * 0.5);
}
