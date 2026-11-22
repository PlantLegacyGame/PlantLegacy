/**
 * A purchase planned against the stored row instead of the live pouch.
 *
 * The live object is the fast path for guests and for a session whose row could
 * not be read. An account with a row plans its purchase against the pouch and
 * purse read inside `SELECT ... FOR UPDATE`, writes that plan, and hands the
 * caller the state the database committed - never the plan, which the store may
 * have clamped on the way in.
 *
 * The composition lives here rather than inline in `World` so the planning and
 * the adoption can be checked together without booting a world.
 */

import type { ItemsConfig } from './items.ts';
import type { PersistedPlayerState } from './persistence/playerStatePersistence.ts';
import { toInventory, toPersistedState } from './persistence/playerStatePersistence.ts';
import type { StoredMutationContext } from './playerStateMutations.ts';
import { mutatePlayerState } from './playerStateMutations.ts';
import { planShopPurchase, type ShopConfig, type ShopPurchasePlan } from './shop.ts';
import type { SporeConfig } from './spores.ts';

export interface LockedPurchaseOptions extends StoredMutationContext {
  itemsConfig: ItemsConfig;
  shopConfig: ShopConfig;
  sporeConfig: SporeConfig;
  /** The item the player asked to buy. */
  itemId: string;
  /** Called for a stored row that had to be repaired on the way out. */
  onRepair?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Buy one item under the account's row lock.
 *
 * Resolves to the plan (so the caller can answer a refusal with its reason) or
 * null if the store refused for its own reasons. `onCommitted` receives the row
 * as written; the caller adopts that, not the plan.
 */
export function purchaseUnderLock(
  options: LockedPurchaseOptions,
  onCommitted: (state: PersistedPlayerState) => void,
): Promise<ShopPurchasePlan | null> {
  const { itemsConfig, shopConfig, sporeConfig, itemId, onRepair } = options;
  return mutatePlayerState<ShopPurchasePlan>(
    options,
    (current) => {
      const inventory = toInventory(current, {
        itemDefinitions: itemsConfig.itemDefinitions,
        maxSlots: itemsConfig.inventorySlots,
        onRepair,
      });
      const plan = planShopPurchase(
        { itemsConfig, shopConfig, sporeConfig },
        inventory,
        current.spores,
        itemId,
      );
      if (!plan.ok) return { result: plan };
      return { next: toPersistedState(plan.inventory, plan.spores), result: plan };
    },
    onCommitted,
  );
}
