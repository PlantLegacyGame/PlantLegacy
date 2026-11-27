/**
 * The tag over a rival's plant: what it expresses, and whose it is.
 *
 * The owner half is the player's display name. It used to be
 * `ownerId.slice(0, 6)`, which for a guest is a random id prefix and for an
 * account an opaque one - a tag nobody could read and nobody could match to a
 * person. The id prefix survives only as the fallback for a plant whose owner is
 * not connected, because that plant has no name to send.
 *
 * Pure so the wording can be tested without a renderer or a socket.
 */
/**
 * The owner line the Inspect panel prints.
 *
 * A display name, or that there is none. The panel used to print
 * `ownerId.slice(0, 12)`, a machine identifier in player-facing text: a guest's
 * id is random noise and an account's is opaque, so the line named nobody. A
 * plant whose owner is not connected has no name to send and says so.
 */
export function ownerCaption(ownerName: string | undefined): string {
  return ownerName?.trim() || 'Unnamed plant';
}

export function rivalTagLabel(
  ownerId: string,
  ownerName: string | undefined,
  mutations: string[] | undefined,
): string {
  const mutationTag = mutations?.[0] ?? '';
  // Gallery plants are named after their mutation only: repeating an id on every
  // tag buried the names in clutter.
  if (ownerId.startsWith('gallery:')) return mutationTag;
  // The name, and nothing else. The tag used to read "Glowcap · Fern Test": a
  // mutation in front of the person, with a dot joining them, and the mutation
  // repeated the body the tag was standing over. A name is what a player needs
  // from across the field; what the plant is, its body already says.
  return ownerName?.trim() || ownerId.slice(0, 6);
}
