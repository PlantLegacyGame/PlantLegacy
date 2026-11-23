/**
 * Where a drop is, in the world.
 *
 * The field of rain used to be a mesh whose position was copied from the eye
 * every frame: every drop was an offset from the camera, so walking forwards
 * moved the whole shower with the player and standing still left water hanging
 * in the air beside them. A weather field belongs to the world.
 *
 * The fix is the oldest trick in particle systems, made explicit here so it can
 * be tested: each drop owns a home in a torus of `size` metres. The world copy
 * near the viewer is the home shifted by whole torus widths, and the shift only
 * changes when the home leaves the volume. Moving the eye therefore moves
 * nothing: the same drop keeps the same world position until it wraps to the
 * other side, where it jumps by exactly one volume width.
 *
 * A function rather than a class, and no THREE import: the test can hold the
 * rule without a renderer.
 */

/** The nearest copy of `home` to `centre`, within a torus of `size` metres. */
export function wrapToVolume(home: number, centre: number, size: number): number {
  if (!(size > 0) || !Number.isFinite(size)) return home;
  if (!Number.isFinite(home) || !Number.isFinite(centre)) return home;
  const half = size / 2;
  let offset = (home - centre) % size;
  if (offset < -half) offset += size;
  else if (offset >= half) offset -= size;
  return centre + offset;
}
