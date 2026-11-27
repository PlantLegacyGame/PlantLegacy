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

const ROOT_DIRECTION =
  'Root direction too shallow/horizontal - trace a route that ends clearly below the node (it can arc near the surface).';

const REFUSALS: Record<string, string> = {
  insufficient_spores: 'Not enough spores for that.',
  inventory_full: 'Your pouch has no room for that.',
  unknown_item: 'That item is no longer in the shop.',
  shop_closed: 'The shop is closed right now.',
  item_not_usable: 'That item cannot be used yet - open the inventory to read why.',
  item_gone: 'That item is already gone.',
  plant_mismatch: 'Plant mismatch - refresh to sync.',
  plant_not_found: 'Plant not found - refresh to get a new seed.',
  parent_node_not_found: 'Parent node not found - plant may have changed.',
  node_not_found: 'That node is no longer part of your plant.',
  intent_queue_full: 'Too many growth orders at once. Try again.',
  growth_failed: 'That growth could not be made.',
  growth_on_cooldown: 'Cooldown (0.5s) - wait a moment to grow.',
  insufficient_biomass: 'Insufficient biomass to grow.',
  insufficient_biomass_for_node: 'Insufficient biomass to grow.',
  cannot_cross_layer: 'Cannot cross layer directly.',
  insufficient_energy_for_node: 'Not enough energy - grow leaves to photosynthesize.',
  insufficient_energy: 'Not enough energy - grow leaves to photosynthesize.',
  insufficient_energy_for_germination: 'Not enough energy to germinate.',
  seed_reserve: 'Keep enough energy for your first leaf before growing more roots.',
  invalid_direction: 'Growth direction is invalid for this node type.',
  max_nodes_reached: 'Plant has reached maximum node limit.',
  invalid_parent_for_cotyledon: 'Cotyledons can only grow from seed crown or root crown.',
  radicle_only_from_seed: 'Radicle can only grow from a seed.',
  radicle_required_before_cotyledon: 'Must sprout a radicle before adding cotyledons.',
  establish_seed_before_stem: 'Must establish seed (radicle + 2 cotyledons) before growing stem.',
  max_cotyledons_reached: 'Maximum cotyledons (2) already reached.',
  // These reasons arrive as sentences from the growth validator; the table is
  // still their single home, so the UI has no second copy list.
  'Roots must grow mostly downward': ROOT_DIRECTION,
  'Roots must grow downward': ROOT_DIRECTION,
  'Root growth must trend below the selected node (can arc near surface, but not mostly upward)':
    ROOT_DIRECTION,
  'Root growth direction too horizontal': ROOT_DIRECTION,
  'Cotyledons must grow upward': 'Cotyledon direction too low - drag upward/outward.',
  // Server ERROR and dev-command codes. A message from the server is already a
  // sentence and wins; these cover the codes that arrive without one.
  no_plant: 'There is no plant to act on.',
  no_drop_store: 'Drops are not available right now.',
  grant_failed: 'That item could not be granted.',
  bad_tile: 'That tile is not valid.',
  out_of_bounds: 'That is outside the world.',
  bad_time: 'That time is not valid.',
  bad_scale: 'That scale is not valid.',
  unknown_mutation: 'That mutation is not known.',
  shed_refused: 'That mutation could not be shed.',
  level_refused: 'That mutation could not be levelled.',
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
