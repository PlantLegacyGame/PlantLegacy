/**
 * When may the shell paint, given where the eye is?
 *
 * Pure functions, mirrored line for line by the GLSL in `bowlMesh.ts`. Keeping
 * the decisions here is what lets the side-view and buried-eye cases be tested
 * without a GPU.
 */
import { CAVITY_BOWL_RIM_FRACTION, CAVITY_PROFILE_DEPTH } from './profile.ts';

/** Where the bowl sits this frame, in world space. */
export interface CavityBowlFrame {
  x: number;
  y: number;
  z: number;
  horizontalScale: number;
  verticalScale: number;
}

/**
 * Does a fragment survive the opening-silhouette test?
 *
 * The ray from the eye to the fragment must cross the surface plane inside the
 * aperture - if it surfaces outside the opening, the ground is in front of that
 * fragment and the shell must not paint it.
 */
export function silhouetteKeepsFragment(
  eye: { x: number; y: number; z: number },
  fragment: { x: number; y: number; z: number },
  surfaceY: number,
  apertureCenter: { x: number; z: number },
  apertureRadius: number,
): boolean {
  const dy = fragment.y - eye.y;
  if (Math.abs(dy) <= 1e-4) return true;
  const t = (surfaceY - eye.y) / dy;
  if (t <= 0 || t >= 1) return true;
  const hitX = eye.x + (fragment.x - eye.x) * t;
  const hitZ = eye.z + (fragment.z - eye.z) * t;
  return Math.hypot(hitX - apertureCenter.x, hitZ - apertureCenter.z) <= apertureRadius;
}

/**
 * Is the eye inside the cavity volume itself?
 *
 * Deliberately stricter than "is the eye below the rim": that also answers true
 * for an eye *above* the rim, which is the "looking in from above" case. For the
 * opening-silhouette clip the distinction matters, because an eye above the rim
 * is still outside the pit and the shell must not paint past the opening's
 * silhouette - treating it as inside is what let a 5 m shell behind a 1.6 m
 * hole spill over the rim and cover the water on the slope.
 */
export function isEyeInsideCavity(
  eye: { x: number; y: number; z: number },
  frame: CavityBowlFrame,
): boolean {
  const sx = Math.max(1e-4, frame.horizontalScale);
  const sy = Math.max(1e-4, frame.verticalScale);
  const localY = (eye.y - frame.y) / sy;
  if (localY >= CAVITY_BOWL_RIM_FRACTION) return false;
  const localX = (eye.x - frame.x) / sx;
  const localZ = (eye.z - frame.z) / sx;
  // The shell's own depth bounds the volume; the test only has to separate
  // "inside the pit" from "above or beside it".
  return Math.sqrt(localX * localX + localY * localY + localZ * localZ) <= CAVITY_PROFILE_DEPTH;
}

/**
 * What the shell may paint, given where the eye is. One value, because there are
 * only three situations and they are mutually exclusive.
 *
 * - `none`   the eye is inside the pit: every wall is around it and all of it is
 *            wanted.
 * - `column` the eye is above the ground: the shell may only show inside the
 *            mouth's vertical column. Outside it the bowl stands in the open
 *            beside the hole - its own outer surface, seen as a brown dome over
 *            the far rim from any camera that is not straight overhead.
 * - `buried` the eye is under the surface but outside the pit: the shell is
 *            between the eye and the cavity, so it may only paint where the line
 *            of sight actually leaves through the opening, and the near half is
 *            dropped because it hides the roots.
 */
export type CavityClipMode = 'none' | 'column' | 'buried';

/** What the eye's position allows this frame. */
export interface CavityClipPolicy {
  mode: CavityClipMode;
}

/** The mode as the shader uniform: 0 none, 1 column, 2 buried. */
export const CAVITY_CLIP_MODE_VALUE: Record<CavityClipMode, number> = {
  none: 0,
  column: 1,
  buried: 2,
};

/** Decide the frame's clipping from the eye alone. */
export function cavityClipPolicy(
  eyeY: number,
  /**
   * Ground drawn under the eye, not the opening's mouth plane.
   *
   * These differ wherever the pit's mouth is not the eye's own ground: the
   * mouth is fitted to the lowest ground under the rim, so an eye on a slope or
   * in a hollow stands below the mouth's plane while still well above the earth
   * it stands on. Passed the plane, that eye was called buried and the shell lost
   * its near half and its edges, leaving water and sky visible through the pit's
   * rim from level angles.
   */
  eyeGroundY: number,
  inside: boolean,
): CavityClipPolicy {
  // Two different clips, because the eye needs two different things.
  //
  // Inside the pit no clip is right: the walls surround the eye. Outside it, the
  // eye's height picks the rule. Below the surface the sightline rule is the only
  // one that works - the shell is between the eye and the cavity. Above the
  // surface the sightline rule was wrong and cut holes in the hillside (an
  // off-centre eye crosses the surface plane outside the aperture), so the column
  // test does that job instead and cannot remove any ground.
  if (inside) return { mode: 'none' };
  return { mode: eyeY < eyeGroundY - 0.02 ? 'buried' : 'column' };
}
