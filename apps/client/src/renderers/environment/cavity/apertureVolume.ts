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

/** Footprint of the old soil body the buried-eye clamp keeps the eye inside. */
export const APERTURE_SOIL_EXTENT_M = 3.6;
/** Margin between the eye and that footprint's edge, metres. */
export const APERTURE_SOIL_EYE_HOLD_M = 0.3;

/**
 * Radius a buried eye is held within around the opening.
 *
 * The separate aperture body is gone - the bowl and its collar are the one
 * surface now - but the camera clamp still needs a footprint. It is the same
 * 3.6 m minimum plus 1.2 m of mouth clearance the body used, so an eye inside
 * the pit can circle the wall without being let out under intact soil.
 */
export function apertureSoilHoldRadiusM(apertureRadiusM: number): number {
  const aperture = Number.isFinite(apertureRadiusM) ? Math.max(0, apertureRadiusM) : 0;
  const extent = Math.max(APERTURE_SOIL_EXTENT_M, aperture * 1.02 + 1.2);
  return Math.max(0.1, extent - APERTURE_SOIL_EYE_HOLD_M);
}

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
