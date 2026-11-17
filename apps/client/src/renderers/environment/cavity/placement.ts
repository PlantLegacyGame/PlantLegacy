/**
 * Where the bowl sits, and how far its rim and floor may go. No meshes.
 *
 * Two rules live here, and they are the whole depth story:
 *
 * 1. **Stretch** is only what the rim needs to reach the lowest ground under the
 *    mouth. The shell is stretched, not capped and not sunk, so the lip stays on
 *    the hillside at every angle.
 * 2. **Floor clamp** holds the pit at the depth its roots asked for by scaling
 *    every non-rim vertex's own height, with a derived lower bound so the floor
 *    can never rise to the lip and turn the cavity inside out.
 */
import {
  CAVITY_FLOOR_MARGIN,
  CAVITY_MOUTH_FRACTION,
  CAVITY_MOUTH_OVERHANG,
  CAVITY_PROFILE_DEPTH,
  CAVITY_RIM_SINK_M,
  CAVITY_WALL_BASE_DEPTH,
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
  /** Vertical scale the shell needs to put every rim vertex on its ground. */
  verticalScale: number;
  /** Factor on every non-rim vertex's own height that holds the floor. */
  floorScale: number;
}

/**
 * Fit the rim to the ground under it, then hold the floor at `depthM`.
 *
 * The mouth plane is the highest ground beneath it, so every rim vertex may move
 * *down* to its own terrain height and none has to rise into a skirt that does
 * not exist. The stretch that takes is kept, because the rim must stay on the
 * hill; the depth is then recovered by the floor clamp instead of by capping the
 * stretch (a cap lifted the lip off the downhill side and left a second rim).
 */
export function fitRimToGround(
  grounds: readonly number[],
  baseVerticalScale: number,
  depthM: number,
): RimFit {
  let highestGround = Number.NEGATIVE_INFINITY;
  let lowestGround = Number.POSITIVE_INFINITY;
  for (const height of grounds) {
    if (height > highestGround) highestGround = height;
    if (height < lowestGround) lowestGround = height;
  }
  const drop = Math.max(0, highestGround - lowestGround);
  const verticalScale = Math.max(baseVerticalScale, drop / CAVITY_WALL_BASE_DEPTH);
  const minFloorScale = (CAVITY_WALL_BASE_DEPTH + CAVITY_FLOOR_MARGIN) / CAVITY_PROFILE_DEPTH;
  const floorScale = Math.min(
    1,
    Math.max(
      minFloorScale,
      Math.max(0.1, depthM) / Math.max(1e-6, verticalScale * CAVITY_PROFILE_DEPTH),
    ),
  );
  return { highestGround, lowestGround, verticalScale, floorScale };
}
