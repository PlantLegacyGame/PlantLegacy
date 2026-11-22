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

/**
 * Extra upward pitch the polar ceiling swallowed this frame, radians.
 *
 * An orbit camera always looks at its target, and the target sits on the
 * ground, so once the eye is down on the soil no polar angle is left that
 * points at the sky: the ground ceiling stops the orbit and an upward drag ends
 * there. This spends that blocked rotation on the camera's own pitch instead,
 * so the drag keeps tilting the view up from the soil.
 */
export interface LookUpPitchInput {
  /** Extra pitch already spent, radians. */
  currentRad: number;
  /** Upward orbit rotation this frame that the polar limit swallowed, radians. */
  blockedRad: number;
  /** Downward rotation the player is dragging for this frame, radians. */
  releaseRad: number;
  /** Whether the orbit is against its ceiling. */
  atCeiling: boolean;
  /** Ceiling for the extra pitch itself, radians. */
  maxRad: number;
  /** How fast the extra pitch unwinds once the orbit is free, radians/second. */
  decayPerSecond: number;
  /** Frame time, seconds. */
  deltaTimeS: number;
}

export function stepLookUpPitch(input: LookUpPitchInput): number {
  const max = Number.isFinite(input.maxRad) ? Math.max(0, input.maxRad) : 0;
  const current = Number.isFinite(input.currentRad)
    ? Math.min(max, Math.max(0, input.currentRad))
    : 0;
  const blocked = Number.isFinite(input.blockedRad) ? Math.max(0, input.blockedRad) : 0;
  const release = Number.isFinite(input.releaseRad) ? Math.max(0, input.releaseRad) : 0;
  if (input.atCeiling && blocked > 0) return Math.min(max, current + blocked);
  const deltaTime = Number.isFinite(input.deltaTimeS) ? Math.max(0, input.deltaTimeS) : 0;
  const decay = Number.isFinite(input.decayPerSecond) ? Math.max(0, input.decayPerSecond) : 0;
  // Against the ceiling and not dragging, the view holds where the player left
  // it; only a downward drag gives the pitch back there. A free orbit unwinds on
  // its own, so the camera is not left looking at the sky after a zoom out.
  const giveBack = release + (input.atCeiling ? 0 : decay * deltaTime);
  return Math.max(0, current - giveBack);
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
