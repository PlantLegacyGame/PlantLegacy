/**
 * The steepest polar angle whose whole ray still clears the ground.
 *
 * The old solve was a closed form per probe: "what angle puts the eye above the
 * ground there?". Past horizontal that question has two answers - the ray's
 * horizontal is `r sin(polar)`, which falls again after 90 degrees, so a larger
 * polar angle samples a point *closer* to the target, where a slope is higher -
 * and on a 0.89 slope the iteration hopped between them, returning 131 degrees
 * while the ray was already a centimetre under the hill. The same fault let the
 * ceiling answer past a ridge instead of at it: at one azimuth it allowed 35.7
 * degrees below the target where the first blocked angle was 32.5, because the
 * far side of the crest was clear again.
 *
 * The solve walks up from the top of the orbit and stops at the *first* angle
 * the ground blocks, so it cannot climb over a ridge to a clear angle on its far
 * side. Inside that one step a short bisection finds the edge. The clear side is
 * returned, so an angle that comes out of here never needs the spring arm to
 * rescue it.
 */

/** Scan step, radians: a coarse walk up to the first blocked angle. */
const SCAN_STEP_RAD = 0.25;
/** Bisection passes inside one step; seven settle the angle to ~0.1 degree. */
const REFINE_PASSES = 7;

export interface GroundCeilingInput {
  /** Lowest polar angle the orbit may take (near vertical). */
  floorRad: number;
  /** Highest polar angle the mode allows: its own configured limit. */
  limitRad: number;
  /** Whether the eye's whole ray at this polar angle clears the ground. */
  clears: (polarRad: number) => boolean;
}

export function solveGroundCeiling(input: GroundCeilingInput): number {
  const floor = Number.isFinite(input.floorRad) ? Math.max(0, input.floorRad) : 0;
  const limit = Number.isFinite(input.limitRad) ? Math.max(floor, input.limitRad) : floor;
  if (!(limit > floor)) return floor;
  // A floor that is already buried is the player standing in a hole, which the
  // target floor owns; there is no horizon to find from there.
  if (!input.clears(floor)) return floor;
  const refine = (clearAngle: number, blockedAngle: number): number => {
    let clear = clearAngle;
    let blocked = blockedAngle;
    for (let pass = 0; pass < REFINE_PASSES; pass += 1) {
      const middle = (clear + blocked) / 2;
      if (input.clears(middle)) clear = middle;
      else blocked = middle;
    }
    return clear;
  };
  let clear = floor;
  for (let angle = floor + SCAN_STEP_RAD; angle < limit; angle += SCAN_STEP_RAD) {
    if (!input.clears(angle)) return refine(clear, angle);
    clear = angle;
  }
  if (!input.clears(limit)) return refine(clear, limit);
  return limit;
}
