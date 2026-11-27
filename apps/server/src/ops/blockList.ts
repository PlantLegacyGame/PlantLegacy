/**
 * A player's block list is a social control, not a log. It lives for the life
 * of one connection, so an unbounded Set lets a client mint unique target ids
 * until the process grows without limit. Re-blocking an existing id is
 * idempotent; a new id is refused once the cap is reached.
 */
export function addBlockedPlayer(
  blocked: Set<string>,
  targetPlayerId: string,
  maxEntries: number,
): boolean {
  if (blocked.has(targetPlayerId)) return true;
  const cap = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 1;
  if (blocked.size >= cap) return false;
  blocked.add(targetPlayerId);
  return true;
}
