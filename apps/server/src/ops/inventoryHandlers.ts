import type { GrowthConfig, Plant } from '@plant-legacy/shared/growth';
import type { WebSocket } from 'ws';
import { type Inventory, setSlot, swapSlots } from './inventory.ts';
import type { ItemsConfig } from './items.ts';
import { MESSAGE_TYPE, type RejectPayload } from './net.ts';
import { clampPlantStorage } from './plantCapacity.ts';

export interface InventoryPlayer {
  ws: WebSocket;
  playerId: string;
  plantId: string | null;
  inventory: Inventory;
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
export interface InventoryPorts {
  itemsConfig: ItemsConfig;
  send(ws: WebSocket, type: number, payload: unknown): void;
  getPlant(plantId: string): Plant | undefined;
  growthConfig(): GrowthConfig;
  depositFertilizer(worldX: number, worldZ: number): void;
  depositDung(worldX: number, worldZ: number): void;
  log: InventoryLog;
}

export function sendInventorySync(
  ports: InventoryPorts,
  player: Pick<InventoryPlayer, 'ws' | 'inventory'>,
): void {
  const slots = player.inventory.slots.map((slot) =>
    slot ? { itemId: slot.itemId, count: slot.count } : { itemId: null, count: null },
  );
  ports.send(player.ws, MESSAGE_TYPE.INVENTORY_SYNC, {
    slots,
    maxSlots: player.inventory.maxSlots,
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

/**
 * Use one item from a slot.
 *
 * One handler for every item: the definition owns what Use does, and an item
 * that cannot be used yet says so out loud instead of the old silent no-op
 * (gene boosters and both seed types were clicked into a void). Only the slot
 * that was clicked is decremented, so two stacks of the same item stay separate.
 */
export function useInventorySlot(
  ports: InventoryPorts,
  player: InventoryPlayer,
  slotIndex: number,
): void {
  if (slotIndex < 0 || slotIndex >= player.inventory.maxSlots) {
    ports.log.warn('Invalid inventory slot index', { playerId: player.playerId, slotIndex });
    return;
  }

  const slot = player.inventory.slots[slotIndex];
  if (!slot) return;

  const itemDef = ports.itemsConfig.itemDefinitions.get(slot.itemId);
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
  const plant = ports.getPlant(player.plantId);
  if (!plant) return;

  const use = itemDef.use;
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

  setSlot(
    player.inventory,
    slotIndex,
    slot.count > 1 ? { itemId: slot.itemId, count: slot.count - 1 } : null,
  );
  sendInventorySlotUpdate(ports, player, slotIndex);

  ports.log.info('Item used', {
    playerId: player.playerId,
    itemId: slot.itemId,
    category: itemDef.category,
  });
}

/** Swap two slots and tell the client about both, so the panel cannot half-update. */
export function swapInventorySlots(
  ports: InventoryPorts,
  player: Pick<InventoryPlayer, 'ws' | 'inventory'>,
  fromIndex: number,
  toIndex: number,
): void {
  if (!swapSlots(player.inventory, fromIndex, toIndex)) return;
  sendInventorySlotUpdate(ports, player, fromIndex);
  sendInventorySlotUpdate(ports, player, toIndex);
}
