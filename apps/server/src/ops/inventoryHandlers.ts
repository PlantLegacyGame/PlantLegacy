import type { GrowthConfig, Plant } from '@plant-legacy/shared/growth';
import type { WebSocket } from 'ws';
import { type Inventory, setSlot, swapSlots } from './inventory.ts';
import type { ItemsConfig } from './items.ts';
import { MESSAGE_TYPE, type RejectPayload } from './net.ts';
import {
  type PersistedPlayerState,
  toInventory,
  toPersistedState,
} from './persistence/playerStatePersistence.ts';
import { clampPlantStorage } from './plantCapacity.ts';
import { earnSpores, type SporeConfig } from './spores.ts';

export interface InventoryPlayer {
  ws: WebSocket;
  playerId: string;
  plantId: string | null;
  inventory: Inventory;
  /** The purse, in spores. Server-owned; the client only reads it. */
  spores: number;
}

/** The part of the ports the sync needs, so a caller can send one without a world. */
export interface InventorySyncPorts {
  itemsConfig: ItemsConfig;
  send(ws: WebSocket, type: number, payload: unknown): void;
}

export interface InventoryLog {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

/**
 * What the inventory handlers need from the world they run in.
 *
 * Listed rather than taken from `World` so these handlers can be exercised
 * without a socket, a tick loop or a config directory.
 */
export interface InventoryPorts extends InventorySyncPorts {
  /** Earn rates for spores; absent means this world has no purse (tests). */
  sporeConfig?: SporeConfig;
  getPlant(plantId: string): Plant | undefined;
  growthConfig(): GrowthConfig;
  depositFertilizer(worldX: number, worldZ: number): void;
  depositDung(worldX: number, worldZ: number): void;
  log: InventoryLog;
  /** Write the restart copy after a successful pouch/purse change. */
  persist?: (player: InventoryPlayer) => void;
  /**
   * Apply one pouch/purse change under the account's `player_state` row lock.
   *
   * The change is planned against the state read inside the lock, not against
   * the live object, so two clicks cannot spend the same item. The port commits,
   * then copies the committed state onto the live player before resolving.
   * Absent (tests, and a session with no store) the handler applies the same
   * plan to the live object itself.
   */
  mutateState?: <T>(
    player: InventoryPlayer,
    apply: (current: PersistedPlayerState) => { next?: PersistedPlayerState; result: T } | null,
  ) => Promise<T | null>;
}

export function sendInventorySync(
  ports: InventorySyncPorts,
  player: Pick<InventoryPlayer, 'ws' | 'inventory' | 'spores'>,
): void {
  const slots = player.inventory.slots.map((slot) =>
    slot ? { itemId: slot.itemId, count: slot.count } : { itemId: null, count: null },
  );
  ports.send(player.ws, MESSAGE_TYPE.INVENTORY_SYNC, {
    slots,
    maxSlots: player.inventory.maxSlots,
    // The purse travels with the pouch. The shop's balance, the HUD chip and the
    // inventory read one number, and it is this one.
    sporeBalance: player.spores,
    // The definitions travel with the slots. The client used to have only an
    // item id, so it drew "Starter Dung" from a table it invented and had no
    // description to show at all. Sending the server's own definition means
    // the panel can never describe an effect the server would not perform.
    definitions: Array.from(ports.itemsConfig.itemDefinitions.values()).map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      stackLimit: def.stack_limit,
      use: def.use,
    })),
  });
}

export function sendInventorySlotUpdate(
  ports: InventoryPorts,
  player: Pick<InventoryPlayer, 'ws' | 'inventory'>,
  slotIndex: number,
): void {
  if (slotIndex < 0 || slotIndex >= player.inventory.maxSlots) return;
  const slot = player.inventory.slots[slotIndex];
  ports.send(player.ws, MESSAGE_TYPE.INVENTORY_SLOT_UPDATE, {
    slotIndex,
    itemId: slot?.itemId ?? null,
    count: slot?.count ?? null,
  });
}

/** What an item use did, so the effect is applied only after the row commits. */
export interface ItemUseEffect {
  water: number;
  minerals: number;
  energy: number;
  category: string;
}

export type ItemUseResult =
  | { ok: true; effect: ItemUseEffect }
  | { ok: false; reason: 'item_gone' };

/** Options for turning a stored row into a working pouch. */
function stateOptions(ports: InventoryPorts, maxSlots: number) {
  return {
    itemDefinitions: ports.itemsConfig.itemDefinitions,
    maxSlots,
    onRepair: (message: string, meta?: Record<string, unknown>) => ports.log.warn(message, meta),
  };
}

/**
 * Run a change against the live object, for a session with no stored row.
 *
 * The same plan the locked path uses, applied to a state built from the live
 * pouch, so a guest and an account cannot disagree about what an action means.
 */
function applyToLive<T>(
  ports: InventoryPorts,
  player: InventoryPlayer,
  apply: (current: PersistedPlayerState) => { next?: PersistedPlayerState; result: T } | null,
): T | null {
  const change = apply(toPersistedState(player.inventory, player.spores));
  if (!change) return null;
  if (change.next) {
    player.inventory.slots = toInventory(
      change.next,
      stateOptions(ports, player.inventory.maxSlots),
    ).slots;
    player.spores = change.next.spores;
  }
  return change.result;
}

/** One locked change, or the live-object equivalent when there is no row. */
function mutateState<T>(
  ports: InventoryPorts,
  player: InventoryPlayer,
  apply: (current: PersistedPlayerState) => { next?: PersistedPlayerState; result: T } | null,
): Promise<T | null> {
  return ports.mutateState
    ? ports.mutateState(player, apply)
    : Promise.resolve(applyToLive(ports, player, apply));
}

/**
 * Use one item from a slot.
 *
 * One handler for every item: the definition owns what Use does, and an item
 * that cannot be used yet says so out loud instead of the old silent no-op
 * (gene boosters and both seed types were clicked into a void). Only the slot
 * that was clicked is decremented, so two stacks of the same item stay separate.
 *
 * The decrement and any spores the item pays are one change under the
 * `player_state` row lock; the plant's resource gain is applied after the commit,
 * so a refused change cannot leave a free handful of minerals behind.
 */
export async function useInventorySlot(
  ports: InventoryPorts,
  player: InventoryPlayer,
  slotIndex: number,
): Promise<void> {
  if (slotIndex < 0 || slotIndex >= player.inventory.maxSlots) {
    ports.log.warn('Invalid inventory slot index', { playerId: player.playerId, slotIndex });
    return;
  }

  // This read only answers refusals that do not depend on the row (a slot that
  // is empty on screen, an item that is not usable, a plant that is gone). How
  // many are left is decided under the lock.
  const slot = player.inventory.slots[slotIndex];
  if (!slot) return;
  const itemId = slot.itemId;

  const itemDef = ports.itemsConfig.itemDefinitions.get(itemId);
  if (!itemDef) return;

  if (itemDef.use.kind !== 'resources') {
    const reject: RejectPayload = {
      reason: 'item_not_usable',
      originalType: MESSAGE_TYPE.INVENTORY_SLOT_USE,
    };
    ports.send(player.ws, MESSAGE_TYPE.REJECT, reject);
    return;
  }

  if (!player.plantId) return;
  if (!ports.getPlant(player.plantId)) return;

  const use = itemDef.use;
  const sporesBefore = player.spores;
  const effect: ItemUseEffect = {
    water: use.water,
    minerals: use.minerals,
    energy: use.energy,
    category: itemDef.category,
  };

  const result = await mutateState<ItemUseResult>(ports, player, (current) => {
    const inventory = toInventory(current, stateOptions(ports, player.inventory.maxSlots));
    const held = inventory.slots[slotIndex];
    if (!held || held.itemId !== itemId) return { result: { ok: false, reason: 'item_gone' } };
    setSlot(
      inventory,
      slotIndex,
      held.count > 1 ? { itemId, count: held.count - 1 } : null,
      ports.itemsConfig.itemDefinitions,
    );
    let spores = current.spores;
    // Dung is the world's own reward: consuming it pays spores, and the number
    // the shop checks is the number the HUD shows. Paid in the same row write as
    // the consumption, so a retry cannot pay twice.
    if (itemDef.category === 'dung' && ports.sporeConfig) {
      spores = earnSpores(current.spores, ports.sporeConfig.earnDung, ports.sporeConfig.maxBalance);
    }
    return { next: toPersistedState(inventory, spores), result: { ok: true, effect } };
  });

  if (!result) return;
  if (!result.ok) {
    // A click that got there first took the last one. Re-send the pouch so the
    // panel stops offering it.
    sendInventorySync(ports, player);
    return;
  }

  const plant = ports.getPlant(player.plantId);
  if (plant) {
    if (use.water > 0) plant.storedWater += use.water;
    if (use.minerals > 0) plant.storedMinerals += use.minerals;
    if (use.energy > 0) plant.totalEnergy += use.energy;
    clampPlantStorage(plant, ports.growthConfig());

    // Enrich the soil under the root too: `dung_deposit` and `fertilizer_deposit`
    // were configured but never applied, because nothing ever called these two.
    const rootNode = plant.rootNodeId != null ? plant.nodes.get(plant.rootNodeId) : undefined;
    if (rootNode) {
      if (itemDef.category === 'fertilizer') ports.depositFertilizer(rootNode.x, rootNode.z);
      else if (itemDef.category === 'dung') ports.depositDung(rootNode.x, rootNode.z);
    }
  }

  sendInventorySlotUpdate(ports, player, slotIndex);
  // Dung pays spores, and the chip and the shop read one balance: send it when
  // it moved, whichever path committed the change.
  if (player.spores !== sporesBefore) sendInventorySync(ports, player);
  // The locked port already carried the purse with the pouch; the fallback did
  // not, so it still needs the restart write.
  if (!ports.mutateState) ports.persist?.(player);
  ports.log.info('Item used', {
    playerId: player.playerId,
    itemId,
    category: itemDef.category,
  });
}

/** Swap two slots and tell the client about both, so the panel cannot half-update. */
export async function swapInventorySlots(
  ports: InventoryPorts,
  player: InventoryPlayer,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  const swapped = await mutateState<boolean>(ports, player, (current) => {
    const inventory = toInventory(current, stateOptions(ports, player.inventory.maxSlots));
    if (!swapSlots(inventory, fromIndex, toIndex)) return null;
    return { next: toPersistedState(inventory, current.spores), result: true };
  });
  if (!swapped) return;
  sendInventorySlotUpdate(ports, player, fromIndex);
  sendInventorySlotUpdate(ports, player, toIndex);
  if (!ports.mutateState) ports.persist?.(player);
}
