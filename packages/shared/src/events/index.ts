/**
 * Minimum event bus event names (DESIGN.md Appendix E).
 *
 * The bus itself is built in T03. This module is the shared vocabulary so client
 * and server cannot drift apart. Adding an event means adding it here first.
 */
export const GAME_EVENTS = [
  // plant + damage
  'mutation_acquired',
  'mutation_shed',
  'plant_died',
  'plant_uprooted',
  'kill_credited',
  'drain_completed',
  'dung_dropped',
  // items + economy
  'item_granted',
  'item_consumed',
  'bundle_created',
  'bundle_opened',
  'mail_sent',
  'mail_claimed',
  // social
  'review_posted',
  'review_erased',
  'guild_created',
  'guild_disbanded',
  'report_filed',
  // progress
  'achievement_unlocked',
  'prestige_changed',
  'account_progress_updated',
  // seasons + lineage
  'season_ended',
  'heirloom_queued',
  'heirloom_claimed',
  // v5.3 additions
  'fragment_dropped',
  'fragment_collected',
  'gene_extracted',
  'gene_grafted',
  'seed_produced',
  // accounts + ops
  'account_created',
  'account_login',
  'tick_budget_exceeded',
] as const;

export type GameEventName = (typeof GAME_EVENTS)[number];

/**
 * Envelope passed to subscribers. Handlers must never block the tick (T03);
 * anything slow is queued for a later slice.
 */
export interface GameEvent<TName extends GameEventName = GameEventName> {
  name: TName;
  /** Server tick or epoch ms the event was raised at. */
  at: number;
  payload: Record<string, unknown>;
}
