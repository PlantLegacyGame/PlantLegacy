/**
 * Picking a world drop up.
 *
 * The reward used to live inline in the socket handler: read the id, ask the
 * damage pipeline to remove it, award `earn_dung` or `earn_fragment`. That is
 * four lines and three things worth pinning - a live drop pays once, an unknown
 * id pays nothing, and a replayed id pays nothing because the drop is already
 * gone - so the decision lives here where a test can hold it.
 *
 * The store owns removal (`collectDrop` returns null the second time), the
 * config owns the amounts, and this module is the only place that turns one into
 * the other.
 */
import type { SporeConfig } from './spores.ts';

export type DropKind = 'fragment' | 'remains' | 'dung';

export interface DropRecord {
  id: string;
  kind: DropKind;
}

/** The one operation pickup needs from the world: take a drop out, or fail. */
export interface DropStore {
  collectDrop(id: string): DropRecord | null;
}

export interface DropPickupPlayer {
  /** A player without a plant has nothing to pay. */
  plantId: string | null;
}

export interface DropPickupResult {
  ok: boolean;
  kind: DropKind | null;
  amount: number;
}

const NOTHING: DropPickupResult = { ok: false, kind: null, amount: 0 };

/**
 * Spores for one drop kind.
 *
 * Fragments and remains both pay the fragment rate: neither has an item
 * definition, so the reward is currency rather than something the pouch can hold.
 */
export function dropReward(kind: DropKind, config: SporeConfig): number {
  return kind === 'dung' ? config.earnDung : config.earnFragment;
}

export function pickupDrop(
  store: DropStore,
  config: SporeConfig,
  player: DropPickupPlayer,
  dropId: unknown,
): DropPickupResult {
  if (!player.plantId) return NOTHING;
  if (typeof dropId !== 'string' || dropId.length === 0) return NOTHING;
  const drop = store.collectDrop(dropId);
  if (!drop) return NOTHING;
  return { ok: true, kind: drop.kind, amount: dropReward(drop.kind, config) };
}
