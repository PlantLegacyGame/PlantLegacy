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
export function rivalTagLabel(
  ownerId: string,
  ownerName: string | undefined,
  mutations: string[] | undefined,
): string {
  const mutationTag = mutations?.[0] ?? '';
  // Gallery plants are named after their mutation only: repeating an id on every
  // tag buried the names in clutter.
  if (ownerId.startsWith('gallery:')) return mutationTag;
  const name = ownerName?.trim() || ownerId.slice(0, 6);
  return `${mutationTag} · ${name}`;
}
