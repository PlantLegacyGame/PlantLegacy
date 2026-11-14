/**
 * Ownership rules for plants that outlive a connection.
 *
 * A guest plant belongs to an ephemeral `player_*` owner. When that guest signs
 * in, the plant should move to the account instead of a second plant being
 * created and the first abandoned. That reassignment is only safe when the token
 * proves the client held the plant and nobody is currently tending it; otherwise
 * any account could claim any anonymous plant.
 */

const ANONYMOUS_OWNER_PREFIX = 'player_';

export function isAnonymousOwner(ownerId: string): boolean {
  return ownerId.startsWith(ANONYMOUS_OWNER_PREFIX);
}

export interface AdoptionCheck {
  /** Owner currently recorded on the plant. */
  plantOwnerId: string;
  /** The HELLO carried this plant's reconnect secret. */
  tokenValid: boolean;
  /** A connected player is currently bound to this plant. */
  ownerAttached: boolean;
}

export function canAdoptGuestPlant(check: AdoptionCheck): boolean {
  if (!check.tokenValid) return false;
  if (check.ownerAttached) return false;
  return isAnonymousOwner(check.plantOwnerId);
}
