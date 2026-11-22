/**
 * The one stored-state mutation path, shared by the live world and the database
 * audit.
 *
 * It exists to keep one rule in one place: a locked change is planned against the
 * row read inside the lock, and the live copy adopts the state the database
 * actually committed - not the plan. The plan can be clamped on the way in (a
 * stack above its limit, a purse above the maximum), and adopting it would leave
 * the live puck ahead of the row it is supposed to mirror.
 *
 * Without a row (a guest, or a store that could not be read) the live object is
 * the only copy, and the plan is the state.
 */
import type {
  PersistedPlayerState,
  PlayerStateStore,
} from './persistence/playerStatePersistence.ts';
import { earnSpores } from './spores.ts';

export interface StoredMutationContext {
  /** The store, or null when this process has no database. */
  store: PlayerStateStore | null;
  /** The account that owns the row; null for a guest. */
  accountId: string | null;
  /** True when this account's row is known to be unusable. */
  unavailable: boolean;
  /** The live copy: seeds a missing row and is the whole state without one. */
  initial: PersistedPlayerState;
}

export type StoredChange<T> = (
  current: PersistedPlayerState,
) => { next?: PersistedPlayerState; result: T } | null;

/**
 * Apply one change under the account's row lock.
 *
 * `onCommitted` is called with the written state after `COMMIT`, or with the
 * plan when there is no row (nothing clamped it). A refusal never calls it.
 */
export function mutatePlayerState<T>(
  context: StoredMutationContext,
  apply: StoredChange<T>,
  onCommitted: (state: PersistedPlayerState) => void,
): Promise<T | null> {
  const { store, accountId, unavailable } = context;
  if (!store || !accountId || unavailable) {
    const change = apply(context.initial);
    if (!change) return Promise.resolve(null);
    if (change.next) onCommitted(change.next);
    return Promise.resolve(change.result);
  }
  return store.mutate(accountId, context.initial, apply, onCommitted);
}

export interface SporeAwardOptions extends StoredMutationContext {
  amount: number;
  maxBalance: number;
}

/**
 * Award spores under the row lock.
 *
 * Resolves to the committed balance, or null when nothing was paid (a zero
 * amount, or a purse already at its maximum). `onCommitted` also receives what
 * was actually earned, which is what the log and the HUD should say.
 */
export function awardSporesStored(
  options: SporeAwardOptions,
  onCommitted: (state: PersistedPlayerState, earned: number) => void,
): Promise<number | null> {
  let earned = 0;
  return mutatePlayerState<number | null>(
    options,
    (current) => {
      if (!(options.amount > 0)) return { result: null };
      const next = earnSpores(current.spores, options.amount, options.maxBalance);
      if (next === current.spores) return { result: null };
      earned = next - current.spores;
      return { next: { slots: current.slots, spores: next }, result: next };
    },
    (state) => onCommitted(state, earned),
  );
}
