/**
 * The name a plant's sync row carries for its owner.
 *
 * Rivals' tags used to be labelled with `ownerId.slice(0, 6)`, which reads as a
 * random string: a guest id is opaque and even an account id is not a name. The
 * player's own sanitised display name goes on the wire instead. A plant whose
 * owner is not connected has no name to give, so this returns undefined and the
 * client falls back to the id rather than inventing one.
 *
 * Pure, and separate from the socket class, so the rule can be tested.
 */
export interface NamedPlayerLike {
  displayName?: string | null;
}

export function plantOwnerName(
  players: ReadonlyMap<string, NamedPlayerLike>,
  ownerId: string,
): string | undefined {
  const name = players.get(ownerId)?.displayName?.trim();
  return name ? name : undefined;
}
