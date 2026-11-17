/**
 * Where the bowl sits, and how far its rim and floor may go. No meshes.
 *
 * Two rules live here, and they are the whole depth story:
 *
 * 1. **The mouth is a radius, the depth is a depth.** The shell is scaled by the
 *    depth the cavity asked for, and never by the slope.
 * 2. **The lip conforms by rising.** The bowl is anchored on the lowest ground
 *    under the rim, so every rim vertex reaches its own ground by moving up,
 *    which needs no more wall than the shell already has.
 */
import {
  CAVITY_MOUTH_FRACTION,
  CAVITY_MOUTH_OVERHANG,
  CAVITY_PROFILE_DEPTH,
  CAVITY_RIM_SINK_M,
  RIM_CIRCLE_RADIUS,
} from './profile.ts';

export interface CavityBowlPlacement {
  visible: boolean;
  horizontalScale: number;
  verticalScale: number;
  /** Rim height relative to the bowl's surface anchor (negative is below it). */
  rimOffsetY: number;
}

/**
 * Where the bowl sits for a cavity of `radius` opened to `progress`. Pure so the
 * mouth match can be tested without a GPU: the rim circle has to reach the
 * shader's cut at every size.
 *
 * `depthM` is the vertical space from the surface lip to the floor. It is passed
 * in from the live terrain because the cavity centre is the average of the root
 * bubbles and can sit well below the surface; anchoring the bowl to that centre
 * left the mouth underground and made the opening look like a flat disc.
 */
export function cavityBowlPlacement(
  radius: number,
  progress: number,
  depthM?: number,
  apertureRadius?: number,
): CavityBowlPlacement {
  const scale = radius * Math.max(progress, 0);
  const visible = scale > 0.05;
  const depth = Math.max(scale * 0.5, depthM ?? scale * 1.3);
  const verticalScale = depth / CAVITY_PROFILE_DEPTH;
  // The mouth is the aperture, exactly. Both sides read the same radius from
  // `uRootSightApertureRadius`; the fallback keeps old callers and tests on the
  // documented fraction. A wider mouth left a ring of bowl rim inside the hole.
  const openMouth = Math.max(0.05, apertureRadius ?? radius * CAVITY_MOUTH_FRACTION);
  const mouth = openMouth * CAVITY_MOUTH_OVERHANG * Math.max(progress, 0);
  const horizontalScale = visible ? mouth / RIM_CIRCLE_RADIUS : 0;
  return {
    visible,
    horizontalScale,
    verticalScale,
    // The rim is the shell's y = 0 ring, so the anchor only needs the bury sink.
    rimOffsetY: -CAVITY_RIM_SINK_M,
  };
}

/** What the rim's ground heights force on the shell this frame. */
export interface RimFit {
  highestGround: number;
  lowestGround: number;
  /** Vertical scale the shell is drawn at: the depth it was given, unaltered. */
  verticalScale: number;
}

/**
 * Measure the ground under the rim.
 *
 * The shell is **not** stretched to bridge a slope any more, and that is the
 * whole rule. The old pair of tricks - stretch the wall until the lowest lip
 * could reach its ground, then multiply every vertex's height by a floor factor
 * to pull the floor back to the depth budget - cancelled out in the worst way:
 * the wall kept its radius profile but lost its height profile. A pit dug into a
 * bank came out as a shallow dish with no vertical cut and no readable strata,
 * because a 0.28-unit straight wall had been squashed to a tenth of that.
 *
 * Instead the mouth is anchored on the *lowest* ground under the rim
 * (`updateCavityBowl`), so every rim vertex moves **up** to its own ground and
 * no extra wall length is needed. The uphill side is a shallow pit and the
 * downhill side a deep one, which is what digging into a bank does.
 */
export function fitRimToGround(grounds: readonly number[], baseVerticalScale: number): RimFit {
  let highestGround = Number.NEGATIVE_INFINITY;
  let lowestGround = Number.POSITIVE_INFINITY;
  for (const height of grounds) {
    if (height > highestGround) highestGround = height;
    if (height < lowestGround) lowestGround = height;
  }
  if (!Number.isFinite(highestGround)) highestGround = 0;
  if (!Number.isFinite(lowestGround)) lowestGround = 0;
  return { highestGround, lowestGround, verticalScale: Math.max(0.01, baseVerticalScale) };
}
