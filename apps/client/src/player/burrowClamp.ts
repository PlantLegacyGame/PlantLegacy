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
  const radius = Number.isFinite(cavity.radius) ? Math.max(0, cavity.radius) : 0;
  if (radius <= 0) return null;
  const clearance = Number.isFinite(clearanceM) ? Math.max(0, clearanceM) : 0;
  // A clearance wider than the hole would invert the limit and push the eye
  // outwards; leave a sliver of the cavity instead.
  const limit = Math.max(0.1, radius - clearance);
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
