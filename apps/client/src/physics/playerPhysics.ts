/**
 * Simple vertical player physics: gravity and ground contact, nothing else.
 *
 * The player is a point that falls onto the terrain and stops. Horizontal
 * movement is still the camera pan (ADR-022); this module owns only the height
 * above the ground, so the player spawns in the air and lands instead of
 * starting embedded in a hill, and the rig cannot sink through the surface as
 * relief changes under it.
 *
 * Kept pure and frame-rate independent so it can be tested without a browser:
 * `stepPlayerVertical` takes the elapsed time and returns the next state.
 */

export interface PlayerVerticalState {
  /** Height of the player's feet above the ground, in metres. */
  altitude: number;
  /** Vertical velocity, metres per second; positive is up. */
  velocity: number;
  grounded: boolean;
}

/** Largest step integrated in one go, so a paused tab cannot tunnel through. */
const MAX_STEP_SECONDS = 0.25;

/** A player dropped from `spawnAltitude` metres above the ground. */
export function spawnPlayer(spawnAltitude: number): PlayerVerticalState {
  return {
    altitude: Number.isFinite(spawnAltitude) ? Math.max(0, spawnAltitude) : 0,
    velocity: 0,
    grounded: false,
  };
}

/**
 * Integrate one step of gravity and resolve the ground.
 *
 * Landing is exact: altitude is clamped to zero and the velocity is cleared, so
 * the player rests on the surface rather than bouncing or sinking a little more
 * every frame.
 */
export function stepPlayerVertical(
  state: PlayerVerticalState,
  deltaTime: number,
  gravity: number,
): PlayerVerticalState {
  if (state.grounded) return state;

  const dt = Math.min(Math.max(Number.isFinite(deltaTime) ? deltaTime : 0, 0), MAX_STEP_SECONDS);
  if (dt === 0) return state;

  const g = Number.isFinite(gravity) ? Math.max(0, gravity) : 0;
  const velocity = state.velocity - g * dt;
  const altitude = state.altitude + velocity * dt;
  if (altitude <= 0) {
    return { altitude: 0, velocity: 0, grounded: true };
  }
  return { altitude, velocity, grounded: false };
}

/** World height of the player's feet for a ground height underneath them. */
export function playerWorldY(groundY: number, state: PlayerVerticalState): number {
  return groundY + state.altitude;
}
