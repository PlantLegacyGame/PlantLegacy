/**
 * The dev item grant, as a stored mutation.
 *
 * A dev grant was the last pouch write that trusted the live object: it added
 * to `player.inventory`, saved afterwards, and answered with the number it had
 * just put there. It is now planned and written inside the same row lock as a
 * purchase, so it cannot race one, and the caller adopts the committed pouch.
 *
 * The dev command still answers in the same command with the count a grant
 * would add (`previewItemGrant`), because it is a dev-only tool and the panel
 * does not wait on a round trip. The `INVENTORY_SYNC` that follows the commit is
 * what carries the authoritative pouch.
 */
import { addItem, createInventory } from './inventory.ts';
import type { ItemsConfig } from './items.ts';
import type { PersistedPlayerState } from './persistence/playerStatePersistence.ts';
import { toInventory, toPersistedState } from './persistence/playerStatePersistence.ts';
import type { StoredMutationContext } from './playerStateMutations.ts';
import { mutatePlayerState } from './playerStateMutations.ts';

export interface ItemGrantOptions extends StoredMutationContext {
  itemsConfig: ItemsConfig;
  itemId: string;
  /** Whole items asked for; `addItem` refuses anything else. */
  count: number;
  /** Called for a stored row that had to be repaired on the way out. */
  onRepair?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * How many items a grant would add to this pouch, without touching it.
 *
 * Used for the dev command's same-command reply. It runs the same `addItem` the
 * locked write runs, so the answer is the count that write will take when the
 * live pouch and the row agree - which the adoption rule keeps them.
 */
export function previewItemGrant(
  itemsConfig: ItemsConfig,
  slots: PersistedPlayerState['slots'],
  itemId: string,
  count: number,
): number {
  const inventory = createInventory(itemsConfig.inventorySlots);
  inventory.slots = slots.map((slot) => (slot ? { itemId: slot.itemId, count: slot.count } : null));
  return addItem(inventory, itemId, count, itemsConfig.itemDefinitions);
}

/**
 * Grant items under the account's row lock.
 *
 * Resolves to the number the plan added to the locked pouch (0 for a full pouch
 * or an unknown item), and hands the committed state to `onCommitted` so the
 * live pouch follows the row rather than the plan.
 */
export function grantItemUnderLock(
  options: ItemGrantOptions,
  onCommitted: (state: PersistedPlayerState) => void,
): Promise<number> {
  const { itemsConfig, itemId, count, onRepair } = options;
  return mutatePlayerState<number>(
    options,
    (current) => {
      const inventory = toInventory(current, {
        itemDefinitions: itemsConfig.itemDefinitions,
        maxSlots: itemsConfig.inventorySlots,
        onRepair,
      });
      const added = addItem(inventory, itemId, count, itemsConfig.itemDefinitions);
      if (added <= 0) return { result: 0 };
      return { next: toPersistedState(inventory, current.spores), result: added };
    },
    onCommitted,
  ).then((added) => added ?? 0);
}
