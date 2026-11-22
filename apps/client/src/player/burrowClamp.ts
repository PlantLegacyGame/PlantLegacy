/**
 * Where a buried Root Sight eye is allowed to be.
 *
 * The cavity is a hole in the earth of one size: the aperture the soil shader
 * cuts. Outside that hole the eye is inside solid dirt, and the soil shader cuts
 * an air bubble around it - so the view became a private cave whose wall was the
 * *outside* of the pit's own shell. That is the "underground terrain cave walls"
 * report: not terrain intersecting the cavity, but an eye standing beside it in
 * the earth.
 *
 * Pure geometry, no THREE: the caller decides whether the eye is buried and
 * where the aperture is, and gets back the horizontal position to use.
 */

export interface CavityFootprint {
  /** Aperture centre, world x and z. */
  x: number;
  z: number;
  /** Aperture radius, metres. */
  radius: number;
}

export interface EyeXZ {
  x: number;
  z: number;
}

/** The radius the eye is actually held to: the aperture less its clearance. */
function cavityLimit(radiusM: number, clearanceM: number): number {
  const radius = Number.isFinite(radiusM) ? Math.max(0, radiusM) : 0;
  const clearance = Number.isFinite(clearanceM) ? Math.max(0, clearanceM) : 0;
  // A clearance wider than the hole would invert the limit and push the eye
  // outwards; leave a sliver of the cavity instead.
  return Math.max(0.1, radius - clearance);
}

/**
 * Is the point already standing in the opening's own column?
 *
 * The pit is the only hole in the ground, so it is the only place an eye can be
 * under the surface and still be in a space. Everywhere else the dirt is real,
 * and the caller lifts the eye back up instead of clamping it sideways into the
 * pit - that sideways clamp is what left a buried eye stuck below the plant with
 * no way out.
 */
export function isInsideCavityColumn(
  eye: EyeXZ,
  cavity: CavityFootprint,
  clearanceM: number,
): boolean {
  if (!Number.isFinite(cavity.radius) || cavity.radius <= 0) return false;
  const dx = eye.x - cavity.x;
  const dz = eye.z - cavity.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false;
  return Math.hypot(dx, dz) <= cavityLimit(cavity.radius, clearanceM);
}

/**
 * Lift a buried eye out through the opening when the player asks to leave.
 *
 * The clamps could put an eye in the cavity but only Space could take it out:
 * sliding along the wall had no upward exit, so the view felt caught. Looking up
 * is the request - the same gesture that lifts a first-person camera - and the
 * eye rises at a configured rate until it is above the surface, after which the
 * ground clamp and the orbit are free again.
 *
 * Returns the new eye height. It never overshoots the surface, and it does
 * nothing when the player is not looking up.
 */
export function cavityEscapeLiftY(
  eyeY: number,
  groundY: number,
  lookUpY: number,
  dtSeconds: number,
  liftMps: number,
  lookUpThreshold = 0.35,
): number {
  if (!Number.isFinite(eyeY) || !Number.isFinite(groundY)) return eyeY;
  if (!(eyeY < groundY)) return eyeY;
  if (!(lookUpY >= lookUpThreshold)) return eyeY;
  const rate = Number.isFinite(liftMps) ? Math.max(0, liftMps) : 0;
  const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
  if (rate <= 0 || dt <= 0) return eyeY;
  return Math.min(groundY, eyeY + rate * dt);
}

/**
 * Pull a point inside the aperture, keeping the clearance the config asks for.
 *
 * Returns `null` when the point is already inside: the caller then leaves the
 * camera exactly where the controls put it, so an eye in the cavity is never
 * nudged by a clamp that has nothing to do.
 */
export function clampToCavity(
  eye: EyeXZ,
  cavity: CavityFootprint,
  clearanceM: number,
): EyeXZ | null {
  if (!Number.isFinite(cavity.radius) || cavity.radius <= 0) return null;
  const limit = cavityLimit(cavity.radius, clearanceM);
  const dx = eye.x - cavity.x;
  const dz = eye.z - cavity.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  const away = Math.hypot(dx, dz);
  if (away <= limit) return null;
  // Dead centre on the axis: there is no direction to pull along, and none is
  // needed - the point is already inside.
  if (away < 1e-6) return null;
  const scale = limit / away;
  return { x: cavity.x + dx * scale, z: cavity.z + dz * scale };
}
