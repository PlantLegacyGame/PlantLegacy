/**
 * The cavity's shape numbers, and nothing else: no THREE, no meshes, no shader.
 *
 * Every other cavity module reads its proportions from here, so the pit's
 * geometry, its depth budget and its cut wall cannot drift apart. Importing
 * this file is cheap enough to do from a test that never touches a GPU.
 */

/** Height of the rim above the bowl's centre, as a fraction of its radius. */
export const CAVITY_BOWL_RIM_FRACTION = 0;

/**
 * How far a rim vertex may travel below the mouth in the bowl's own units: the
 * height of the wall's first ring.
 *
 * This is a property of the shell, not a tuning knob: moving a rim vertex past
 * the first ring folds the surface. The rim is fitted by stretching the wall to
 * the slope instead of clamping, so this is only a floor for the impossible
 * case, and the yardstick the stretch is measured in.
 */
export const CAVITY_RIM_WALL_BASE = -0.27;

/**
 * Ring profile of the cavity wall: height then radius, in bowl units.
 *
 * The rim is the topmost ring and there is deliberately nothing above it. An
 * earlier profile carried three extra rings as a "buried skirt" above the rim,
 * meant to let the mouth move up to meet a hillside; in practice anything above
 * the rim is a curved wall standing in the open, and it was the wall that showed
 * around the opening whenever the shell was stretched. The rim conforms by
 * placing the mouth's plane on the highest ground beneath it and moving each
 * vertex down, so no geometry is needed above the rim at all. Below it, the rings
 * stay at full radius for the first 0.45 units - a vertical cut wall - and only
 * then curve in to the floor.
 */
export const CAVITY_PROFILE: ReadonlyArray<{ y: number; r: number }> = [
  { y: 0, r: 1 },
  // No undercut any more. The ring below the lip used to flare to 1.06, i.e. 6%
  // wider than the cut: the soil is removed by a cylinder of exactly the
  // aperture radius, so that flare had no soil behind it and stuck out of the
  // hillside around the whole mouth - a brown collar of dots and a crescent of
  // shell outside the hole, which read as "the pit is below the rim". The wall
  // stays just inside the cut instead.
  { y: -0.28, r: 0.985 },
  { y: -0.55, r: 1.0 },
  { y: -0.78, r: 0.82 },
  { y: -0.94, r: 0.55 },
  // A floor you can see from above. The old profile ended in a point, which
  // made the cavity a funnel read only as a banded disc.
  { y: -1.02, r: 0 },
];

/** Index of the rim ring inside the profile. */
export const CAVITY_RIM_RING = 0;

/** Depth of the shell in its own units, rim to floor. */
export const CAVITY_PROFILE_DEPTH = 1.02;

/** Horizontal radius of the unit bowl's rim circle: the profile keeps it at 1. */
export const RIM_CIRCLE_RADIUS = 1;

/**
 * How far below the deepest root the floor sits, in metres.
 *
 * The bowl has to hold the roots, not just look like a pit: the floor is the
 * last thing the eye sees through the opening, and a root poking through it
 * would show the shell's underside instead of dug earth.
 */
export const CAVITY_FLOOR_CLEARANCE_M = 0.4;

/**
 * How deep the bowl is, as a multiple of its mouth radius.
 *
 * The mouth is what the ground opens; the old depth came from the cutaway
 * radius (2x it), which made a 1.6 m hole a 5.7 m shaft - edge-on from above
 * that is a dark trench with no floor in sight. A dug pit is about as deep as
 * it is wide.
 */
export const CAVITY_DEPTH_TO_MOUTH = 1.9;

/**
 * Default radius of the bowl's mouth as a fraction of the Root Sight radius.
 * Only a fallback: callers pass the aperture radius the soil shader cuts, so the
 * mouth matches the opening exactly.
 */
export const CAVITY_MOUTH_FRACTION = 0.7;

/**
 * The bowl's mouth against the aperture the soil shader cuts, as a multiple of
 * the cut radius.
 *
 * Matched exactly. A 6% overhang was tried to hide the shell's edge under the
 * intact soil, but from above the extra rim showed as a pale ring floating just
 * outside the hole - a second contour around the cavity.
 */
export const CAVITY_MOUTH_OVERHANG = 1.0;

/**
 * How far past the bowl's lip the soil is cut, as a multiple of the mouth.
 *
 * The lip is a polygon: its chords dip inside the true circle, and a sloped
 * surface between two rim vertices stands above the chord. A cut exactly at the
 * lip therefore leaves the lip poking through intact soil, and a cut short of it
 * leaves the lip ring uncovered with nothing behind it. The soil is cut a hair
 * wider than the lip and the lip ring itself is built out to that width, so the
 * soil edge meets the bowl's own geometry and no third surface has to bridge the
 * two.
 */
export const CAVITY_CUT_OVERREACH = 1.02;

/**
 * Extra sink of the rim below the soil cut, in metres. Zero on purpose.
 *
 * It used to be 12 mm, to keep the rim off the soil's plane. But the soil is a
 * heightfield with no thickness: the cut is a hole in a sheet, and a rim hanging
 * 12 mm below it left a slot between the hole's edge and the wall. From just
 * above the surface, that slot is a sawtooth of sky all the way round the mouth -
 * the one-pixel holes that made the rim look stitched. Held flush, the bowl's
 * rim (a hair outside the cut, and biased towards the camera by the material's
 * polygon offset) covers the sheet's edge instead of sitting under it.
 */
export const CAVITY_RIM_SINK_M = 0;

/**
 * Seam collar: how deep it hangs below the rim.
 *
 * It has no inset and no lip offset any more - it is built on the bowl's own rim
 * ring, at the ground, so it shares an edge with both the bowl and the terrain.
 */
export const CAVITY_SEAM_DEPTH_M = 0.06;

/** How far the floor must stay below the lowest lip, in profile units. */
export const CAVITY_FLOOR_MARGIN = 0.02;

/** How far the rim may drop down the wall, in profile units. */
export const CAVITY_WALL_BASE_DEPTH = Math.max(0.05, -CAVITY_RIM_WALL_BASE);

/**
 * The vertical space the pit must have: the dug-pit proportion of the mouth,
 * or enough to clear the deepest root, whichever is larger.
 */
export function cavityDepthM(mouthRadius: number, rootDepthM = 0): number {
  return Math.max(
    mouthRadius * CAVITY_DEPTH_TO_MOUTH,
    Math.max(0, rootDepthM) + CAVITY_FLOOR_CLEARANCE_M,
  );
}
