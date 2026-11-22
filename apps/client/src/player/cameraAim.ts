/**
 * How far above the orbit target the camera should look, so a low eye can tilt up.
 *
 * OrbitControls always points the camera at its target, so the pitch is decided
 * by where the eye is relative to that target: to look up at all, the eye has to
 * be *below* it. The target is the point the player framed, and for a seedling
 * that is the seed, about 15 cm over the ground - which leaves 15 cm of up-tilt
 * before the eye is in the dirt, and the orbit's ground limit stops it there.
 * Measured on a fresh seed: the framing sat 13.5 degrees down with the orbit
 * ceiling already reached, so every further drag upward was answered by turning
 * the camera further into the soil. The view near the ground could only point
 * down.
 *
 * Raising the target is not the answer: a head-height target puts a seed at the
 * bottom edge of the picture (28 degrees below the aim at the three-metre seed
 * fit), which is the "seed in a wall of soil" view the framing exists to avoid.
 * So the target stays where the player put it and only the camera's rotation
 * leans back, by this lift, which is the smallest of three limits:
 *
 *  1. the eye's own gap below the head, so an eye at head height looks straight
 *     at the target and the lean grows as the eye comes down;
 *  2. the target-to-head room, so a target the player has panned up the plant is
 *     never pushed further up;
 *  3. the horizontal reach times `tan(LOOK_UP_MAX)`, which caps the *lean*: a
 *     short arm cannot buy a steep pitch. Aiming at the head from arm's length
 *     was 75 degrees up and framed nothing but sky.
 *
 * A camera that already looks up gets less of the lean and one past the cap none
 * (`shortfall`): the lean exists to give a downward-framed camera an upward
 * view, not to keep pushing one that has already dived below its target.
 *
 * The lift never moves the eye, so it cannot feed back into the orbit: the next
 * frame starts from the same numbers.
 */

/**
 * The most the view may lean above the orbit's own pitch, in degrees.
 *
 * About a third of the vertical field of view at the game's 60 degree camera: the
 * target - and the horizon behind it - sits a third of the way down the picture,
 * so a low camera reads as a plant against the sky instead of a wall of soil, and
 * still keeps its subject in frame. At the full 30 degrees of the field of view
 * the horizon fell off the bottom edge and the plant left the picture.
 */
export const LOOK_UP_MAX_DEG = 12;

const LOOK_UP_MAX_RAD = (LOOK_UP_MAX_DEG * Math.PI) / 180;

export interface CameraAimInput {
  /** World height of the eye this frame. */
  eyeY: number;
  /** World height of the orbit target - the point the player framed. */
  targetY: number;
  /** World height of the player's head: the highest the aim may lean. */
  headY: number;
  /** Horizontal distance from the eye to the target, metres. */
  horizontalM: number;
  /** Vertical offset of the eye from the target, metres (eye minus target). */
  offsetYM: number;
  /** Override for the pitch cap, radians. Defaults to `LOOK_UP_MAX_DEG`. */
  maxLookUpRad?: number;
}

/** Metres above `targetY` the camera should aim, `0` when it should aim at it. */
export function aimLiftY(input: CameraAimInput): number {
  const { eyeY, targetY, headY, horizontalM, offsetYM } = input;
  for (const value of [eyeY, targetY, headY, horizontalM, offsetYM]) {
    if (!Number.isFinite(value)) return 0;
  }
  const room = headY - targetY;
  const gap = headY - eyeY;
  if (!(room > 0) || !(gap > 0)) return 0;
  if (!(horizontalM > 1e-4)) return 0;
  const maxLookUp =
    typeof input.maxLookUpRad === 'number' && Number.isFinite(input.maxLookUpRad)
      ? Math.max(0, input.maxLookUpRad)
      : LOOK_UP_MAX_RAD;
  if (!(maxLookUp > 0)) return 0;
  // The orbit's own pitch, positive when the eye is below the target (looking
  // up). A camera that already looks up keeps part of the lean - enough to reach
  // the cap and no more - and one at or past it keeps none.
  const pitch = -Math.atan2(offsetYM, horizontalM);
  const shortfall = Math.max(0, maxLookUp - Math.max(0, pitch));
  if (!(shortfall > 0)) return 0;
  const budget = horizontalM * Math.tan(shortfall);
  return Math.max(0, Math.min(gap, room, budget));
}
