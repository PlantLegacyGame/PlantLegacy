/**
 * The volume Root Sight actually removes from the soil.
 *
 * The aperture used to be decided three times over and differently each time:
 * the soil shader cut a plan-view disc with no vertical bound, the bowl sized
 * its own mouth, and the water shader guessed with a ray test. A disc without a
 * bottom is a cylinder through the whole body, so on a 26 m bank the cut
 * removed a horizontal core through the hillside, and on the planet sphere it
 * also discarded ground at the same X/Z on the far side of the world.
 *
 * This module owns the answer once: a mouth radius anchored to the highest
 * ground under it, and a floor taken from the cavity's own depth budget. The
 * soil cut, the water clip and the plant pass read the same numbers, so a
 * fragment can no longer be air for one system and solid for another.
 *
 * Pure maths: no THREE, no GLSL, no renderer.
 */

/**
 * Extra ground above the mouth that still counts as the opening, metres.
 *
 * This is a seam lip, not headroom: it only has to keep the cut from being
 * coplanar with the soil surface it removes. At 0.8 m the cut removed a band of
 * hillside above the bowl's lip, so from above there was a strip around the
 * uphill rim where the ground was gone and the bowl did not reach - you could
 * see the sky (or the lake behind) through it, inside the opening.
 */
export const APERTURE_RIM_MARGIN_M = 0.06;

/** Cut this far below the cavity floor so no skin is left standing there. */
export const APERTURE_FLOOR_MARGIN_M = 0.5;

export interface ApertureVolume {
  centerX: number;
  centerZ: number;
  /** Ground the hole is cut down from: highest ground under the mouth. */
  topY: number;
  /** Bottom of the cut: below the cavity floor. */
  bottomY: number;
  /** Plan-view radius of the opening, metres. */
  radiusM: number;
}

export interface ApertureVolumeInput {
  centerX: number;
  centerZ: number;
  /** Highest ground sampled under the mouth, world metres. */
  groundY: number;
  /** Radius of the opening in plan view, metres. */
  apertureRadiusM: number;
  /** Depth from the mouth plane to the cavity floor, metres. */
  depthM: number;
  rimMarginM?: number;
  floorMarginM?: number;
}

/**
 * Build the volume for this frame.
 *
 * A closed aperture (radius 0) produces a volume nothing can be inside of, so
 * every consumer can keep calling `insideApertureVolume` without a special
 * case for "Root Sight is shut".
 */
export function apertureVolumeFor(input: ApertureVolumeInput): ApertureVolume {
  const radiusM = Number.isFinite(input.apertureRadiusM) ? Math.max(0, input.apertureRadiusM) : 0;
  const groundY = Number.isFinite(input.groundY) ? input.groundY : 0;
  const depthM = Number.isFinite(input.depthM) ? Math.max(0, input.depthM) : 0;
  const rimMarginM = Math.max(0, input.rimMarginM ?? (radiusM > 0 ? APERTURE_RIM_MARGIN_M : 0));
  const floorMarginM = Math.max(
    0,
    input.floorMarginM ?? (radiusM > 0 ? APERTURE_FLOOR_MARGIN_M : 0),
  );
  const topY = groundY + rimMarginM;
  return {
    centerX: input.centerX,
    centerZ: input.centerZ,
    topY,
    bottomY: topY - depthM - floorMarginM,
    radiusM,
  };
}

/** True when a world point is air the cavity removed. */
export function insideApertureVolume(
  point: { x: number; y: number; z: number },
  volume: ApertureVolume,
  slackM = 0,
): boolean {
  if (volume.radiusM <= 0) return false;
  const dx = point.x - volume.centerX;
  const dz = point.z - volume.centerZ;
  const radius = volume.radiusM + Math.max(0, slackM);
  if (dx * dx + dz * dz > radius * radius) return false;
  return point.y <= volume.topY + slackM && point.y >= volume.bottomY - slackM;
}

/**
 * Width of the dithered rim, metres.
 *
 * `cut_rim_dither_m` is the configured width, but it can never be wider than
 * half the hole: a seedling's aperture is under half a metre, and a 0.35 m
 * dither over it would erase the opening instead of softening it.
 */
export function rimDitherWidthM(radiusM: number, configuredM: number): number {
  const radius = Number.isFinite(radiusM) ? Math.max(0, radiusM) : 0;
  const configured = Number.isFinite(configuredM) ? Math.max(0, configuredM) : 0;
  return Math.min(configured, radius * 0.5);
}

/** `fract`, kept here so the dither maths can be tested outside GLSL. */
function fract(value: number): number {
  return value - Math.floor(value);
}

/** Interleaved gradient noise, the stochastic edge the rim is cut with. */
export function interleavedGradientNoise(x: number, y: number): number {
  return fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y));
}

/**
 * Does a soil fragment survive the aperture cut?
 *
 * `distanceM` is the fragment's plan-view distance from the mouth centre.
 * Inside the core the fragment is always cut; outside the rim it is always
 * kept; in between the answer is dithered by `noise` so the edge is speckled
 * rather than a hard, aliased circle.
 */
export function rimKeepsFragment(
  distanceM: number,
  radiusM: number,
  ditherM: number,
  noise: number,
): boolean {
  const radius = Math.max(0, radiusM);
  if (distanceM >= radius) return true;
  const dither = Math.max(0, Math.min(ditherM, radius * 0.5));
  if (dither <= 0) return false;
  const core = radius - dither;
  if (distanceM <= core) return false;
  const keep = (distanceM - core) / dither;
  return keep > Math.min(Math.max(noise, 0), 0.999999);
}
