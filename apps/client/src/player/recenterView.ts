/**
 * The direction a recenter returns the camera to.
 *
 * Space (and a double-click on empty ground) used to keep whatever pitch the
 * player had, and only move the orbit target onto the plant. That is right for
 * the azimuth - spinning the view to a scripted side reads as the world turning
 * - but wrong for the elevation: after a right-drag pan upwards the camera was
 * left looking down on the plant, and "recenter" could not bring it back into a
 * normal side view.
 *
 * This rule keeps the azimuth the player is looking along and replaces the
 * elevation with the framing's own. `rise` is the vertical component of the
 * direction before normalisation, the same convention as
 * `camera_young_elevation` in `config/render.json` (0.27 is ~15 degrees above
 * the target, 0.55 is ~30).
 */

export interface RecenterOffsetInput {
  /** Current eye minus target. Only its azimuth is read. */
  offset: { x: number; y: number; z: number };
  /** Vertical component of the recentered direction, 0..1 (before normalisation). */
  rise: number;
  /** Azimuth to fall back on when the offset has no horizontal component. */
  fallback?: { x: number; z: number };
}

export interface RecenterDirection {
  x: number;
  y: number;
  z: number;
}

/** Below this the horizontal part carries no usable azimuth. */
const MIN_HORIZONTAL = 1e-4;

export function recenterOffset(input: RecenterOffsetInput): RecenterDirection {
  const rise = Number.isFinite(input.rise) ? Math.min(0.999, Math.max(0, input.rise)) : 0.27;
  const fallbackAzimuth = input.fallback ?? { x: 0.3, z: 0.92 };

  let horizontalX = input.offset.x;
  let horizontalZ = input.offset.z;
  let horizontalLength = Math.hypot(horizontalX, horizontalZ);
  if (!(horizontalLength > MIN_HORIZONTAL)) {
    horizontalX = fallbackAzimuth.x;
    horizontalZ = fallbackAzimuth.z;
    horizontalLength = Math.hypot(horizontalX, horizontalZ);
    // A fallback of zero is not an azimuth either; point straight up rather
    // than return a NaN direction into the camera.
    if (!(horizontalLength > MIN_HORIZONTAL)) return { x: 0, y: 1, z: 0 };
  }

  // A direction with a given vertical component and the same azimuth has this
  // much horizontal length, so the result is already unit length.
  const horizontalScale = Math.sqrt(Math.max(0, 1 - rise * rise));
  return {
    x: (horizontalX / horizontalLength) * horizontalScale,
    y: rise,
    z: (horizontalZ / horizontalLength) * horizontalScale,
  };
}
