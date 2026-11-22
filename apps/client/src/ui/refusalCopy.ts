/**
 * Player-facing copy for a refused action.
 *
 * `REJECT` carries a machine reason (`insufficient_spores`, `inventory_full`,
 * …) because the server should not own the game's prose. The client used to
 * fall back to that raw identifier, so a refused purchase put a snake_case token
 * in the toast and in Recent activity. This module is the one place that turns a
 * reason into a sentence; anything unrecognised is still made readable, and the
 * raw reason stays in the console warning.
 */

const REFUSALS: Record<string, string> = {
  insufficient_spores: 'Not enough spores for that.',
  inventory_full: 'Your pouch has no room for that.',
  unknown_item: 'That item is no longer in the shop.',
  shop_closed: 'The shop is closed right now.',
  item_not_usable: 'That item cannot be used yet.',
  item_gone: 'That item is already gone.',
  plant_mismatch: 'That is not your plant.',
  intent_queue_full: 'Too many growth orders at once. Try again.',
  growth_failed: 'That growth could not be made.',
};

/** `insufficient_spores` -> `insufficient spores`, for an unknown reason. */
function humanize(reason: string): string {
  return reason.replace(/_/g, ' ').trim() || 'unknown reason';
}

export function refusalCopy(reason: string): string {
  const known = REFUSALS[reason];
  if (known) return known;
  return `That action was refused: ${humanize(reason)}.`;
}
