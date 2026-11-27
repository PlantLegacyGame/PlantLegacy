/**
 * Admission checks for the two finite resources a connection consumes before
 * HELLO: a socket slot for its address and a player slot in the world.
 *
 * Kept pure so the boundary is a tested rule rather than two `<` comparisons
 * hidden in the socket callback.
 */
export function admitsConnection(active: number, max: number): boolean {
  return active < Math.max(1, Math.floor(max));
}

export function hasPlayerCapacity(active: number, max: number): boolean {
  return active < Math.max(1, Math.floor(max));
}
