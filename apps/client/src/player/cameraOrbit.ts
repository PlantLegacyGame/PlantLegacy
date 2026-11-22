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
 * Extra pitch the camera spends looking up once the orbit is against its
 * ceiling.
 *
 * An orbit camera always looks at its target, and the target sits on the
 * ground, so once the eye is down on the soil no polar angle is left that
 * points at the sky: the ground ceiling stops the orbit and an upward drag ends
 * there. This spends that drag on the camera's own pitch instead, so the view
 * keeps tilting up from the soil.
 *
 * The drag is measured by the caller from its own pointer tracking, in the same
 * radians OrbitControls uses (`2π · dy / clientHeight · rotateSpeed`), rather
 * than read out of the controls' private spherical delta.
 */
export interface LookUpPitchInput {
  /** Where the pitch is heading, radians. */
  targetRad: number;
  /** The pitch actually drawn last frame, radians. */
  appliedRad: number;
  /** Upward pitch the player dragged for this frame, radians (negative = down). */
  upDragRad: number;
  /** Whether the orbit is against its ceiling. */
  atCeiling: boolean;
  /** Ceiling for the extra pitch itself, radians. */
  maxRad: number;
  /** How much of the drag the pitch takes, 0..1. */
  gain: number;
  /** How fast the pitch unwinds once the orbit is free, radians/second. */
  decayPerSecond: number;
  /** Per-frame easing, the same number OrbitControls uses for its own glide. */
  dampingFactor: number;
  /** Frame time, seconds. */
  deltaTimeS: number;
}

export interface LookUpPitchStep {
  targetRad: number;
  appliedRad: number;
}

/**
 * One frame of the extra pitch, with the orbit's own glide.
 *
 * Two numbers, not one, because the handover has to keep the *feel* of the drag.
 * OrbitControls damps every drag: the eye catches up to the mouse over about a
 * third of a second. Adding the blocked drag straight to the camera instead made
 * the view snap 1:1 with the mouse the instant the ceiling took over - a visible
 * kink at the moment looking up began, and a look-up that felt far faster than
 * the orbit that led into it. So the drag moves a *target*, and the pitch eases
 * toward it at the controls' own damping factor.
 *
 * `gain` is a sensitivity, not a feature: the pitch is a secondary control and
 * taking the whole drag made looking up race.
 */
export function stepLookUpPitch(input: LookUpPitchInput): LookUpPitchStep {
  const max = Number.isFinite(input.maxRad) ? Math.max(0, input.maxRad) : 0;
  const clamp = (value: number) => Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));
  let target = clamp(input.targetRad);
  const applied = clamp(input.appliedRad);

  if (input.atCeiling) {
    const up = Number.isFinite(input.upDragRad) ? Math.max(0, input.upDragRad) : 0;
    const gain = Number.isFinite(input.gain) ? Math.min(1, Math.max(0, input.gain)) : 1;
    // Against the ceiling the orbit cannot take any more of the drag, so the
    // camera does. A downward drag is the orbit's again - it can move away from
    // the ceiling - and the pitch is given back once the orbit is free.
    if (up > 0) target = clamp(target + up * gain);
  } else {
    const deltaTime = Number.isFinite(input.deltaTimeS) ? Math.max(0, input.deltaTimeS) : 0;
    const decay = Number.isFinite(input.decayPerSecond) ? Math.max(0, input.decayPerSecond) : 0;
    target = clamp(target - decay * deltaTime);
  }

  const ease = Number.isFinite(input.dampingFactor)
    ? Math.min(1, Math.max(0, input.dampingFactor))
    : 1;
  const next = applied + (target - applied) * ease;
  return { targetRad: target, appliedRad: clamp(next < 1e-4 ? 0 : next) };
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
