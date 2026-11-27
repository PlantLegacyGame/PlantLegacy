/**
 * The air over the planet, measured from the soil up.
 *
 * The player stands on a sphere of rock with a thin shell of gas on it. Two
 * things in the renderer depend on how much of that shell is still overhead:
 * the sky (which is the shell glowing, and is not there at all above it) and
 * the fog (which is the same gas seen along the ground, and stops hiding
 * anything once the eye is above most of it). Both are read from the altitude
 * of the eye above the terrain under it, so walking up a hill thins the air by
 * a few metres and climbing a kilometre thins it for real.
 *
 * Distances are metres above the drawn surface at the eye's own x/z, which is
 * what a player can see and what the terrain mesh provides; the curvature of the
 * planet is already in that surface height.
 */

/** Pressure scale height of the visual air: one e-fold of density per this many metres. */
export const AIR_SCALE_HEIGHT_M = 8500;

/** Top of the shell. Above this the sky is space, and the fog is gone. */
export const AIR_TOP_M = 60_000;

/** Where the cloud deck sits, and how thick it is, above the surface. */
export const CLOUD_DECK_ALTITUDE_M = 1_400;
export const CLOUD_TOP_ALTITUDE_M = 2_600;

/**
 * Share of the air column still between the eye and space: 1 at the soil,
 * about a third at 9 km, a twentieth at 25 km, and 0 at the top of the shell.
 */
export function airDensityAt(altitudeM: number): number {
  if (!Number.isFinite(altitudeM) || altitudeM >= AIR_TOP_M) return 0;
  if (altitudeM <= 0) return 1;
  return Math.exp(-altitudeM / AIR_SCALE_HEIGHT_M);
}

/**
 * How far through the cloud deck the eye is: 0 below it, 1 above it. Clouds
 * are a layer in the air, not a picture on the sky, so they are no longer
 * between the eye and the sky once the eye is over them.
 */
export function cloudCoverAbove(altitudeM: number): number {
  if (!Number.isFinite(altitudeM)) return 0;
  const span = CLOUD_TOP_ALTITUDE_M - CLOUD_DECK_ALTITUDE_M;
  const t = (altitudeM - CLOUD_DECK_ALTITUDE_M) / span;
  return Math.min(1, Math.max(0, t));
}

/**
 * How far the eye can see through the air, scaled from the ground's own fog
 * reach. The same column of gas that fogs a hillside 300 m away is a thin
 * haze when looked through from 60 km up, so the reach grows with altitude
 * instead of the planet disappearing into ground level haze from orbit.
 */
export function fogReachAt(baseReachM: number, altitudeM: number): number {
  if (!Number.isFinite(altitudeM) || altitudeM <= 0) return baseReachM;
  return baseReachM * (1 + altitudeM / 150);
}
