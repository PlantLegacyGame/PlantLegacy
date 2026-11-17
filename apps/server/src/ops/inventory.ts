import type { ItemDefinition } from '@plant-legacy/shared/schemas';

export interface InventoryItem {
  itemId: string;
  count: number;
}

export interface Inventory {
  slots: (InventoryItem | null)[];
  maxSlots: number;
}

export function createInventory(maxSlots: number): Inventory {
  return {
    slots: new Array(maxSlots).fill(null),
    maxSlots,
  };
}

export function addItem(
  inventory: Inventory,
  itemId: string,
  count: number,
  itemDefs: Map<string, ItemDefinition>,
): number {
  const def = itemDefs.get(itemId);
  if (!def) return 0;
  // Counts arrive from config and, later, from server-side grants. Reject a
  // fractional, negative or non-finite count here so a bad caller cannot create
  // a nano-stack or erase a slot by adding a negative amount.
  if (!Number.isInteger(count) || count <= 0) return 0;
  if (!Number.isInteger(def.stack_limit) || def.stack_limit < 1) return 0;

  const maxStack = def.stack_limit;
  let remaining = count;

  // Try to fill existing stacks first
  for (let i = 0; i < inventory.slots.length && remaining > 0; i++) {
    const slot = inventory.slots[i];
    if (slot && slot.itemId === itemId && slot.count < maxStack) {
      const space = maxStack - slot.count;
      const toAdd = Math.min(space, remaining);
      slot.count += toAdd;
      remaining -= toAdd;
    }
  }

  // Try to find empty slots
  for (let i = 0; i < inventory.slots.length && remaining > 0; i++) {
    if (!inventory.slots[i]) {
      const toAdd = Math.min(maxStack, remaining);
      inventory.slots[i] = { itemId, count: toAdd };
      remaining -= toAdd;
    }
  }

  return count - remaining;
}

export function removeItem(inventory: Inventory, itemId: string, count: number): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  let remaining = count;

  for (let i = 0; i < inventory.slots.length && remaining > 0; i++) {
    const slot = inventory.slots[i];
    if (slot && slot.itemId === itemId) {
      const toRemove = Math.min(slot.count, remaining);
      slot.count -= toRemove;
      remaining -= toRemove;
      if (slot.count === 0) {
        inventory.slots[i] = null;
      }
    }
  }

  return count - remaining;
}

export function getItemCount(inventory: Inventory, itemId: string): number {
  let count = 0;
  for (const slot of inventory.slots) {
    if (slot && slot.itemId === itemId) {
      count += slot.count;
    }
  }
  return count;
}

export function hasItem(inventory: Inventory, itemId: string, count: number): boolean {
  return getItemCount(inventory, itemId) >= count;
}

export function getSlot(inventory: Inventory, index: number): InventoryItem | null {
  if (index < 0 || index >= inventory.slots.length) return null;
  return inventory.slots[index];
}

export function setSlot(
  inventory: Inventory,
  index: number,
  item: InventoryItem | null,
  itemDefs?: Map<string, ItemDefinition>,
): boolean {
  if (index < 0 || index >= inventory.slots.length) return false;
  if (item !== null) {
    if (typeof item.itemId !== 'string' || item.itemId.length === 0) return false;
    if (!Number.isInteger(item.count) || item.count <= 0) return false;
    const def = itemDefs?.get(item.itemId);
    if (itemDefs && !def) return false;
    if (def && item.count > def.stack_limit) return false;
  }
  inventory.slots[index] = item;
  return true;
}

export function swapSlots(inventory: Inventory, fromIndex: number, toIndex: number): boolean {
  if (fromIndex < 0 || fromIndex >= inventory.slots.length) return false;
  if (toIndex < 0 || toIndex >= inventory.slots.length) return false;
  if (fromIndex === toIndex) return true;
  const temp = inventory.slots[fromIndex];
  inventory.slots[fromIndex] = inventory.slots[toIndex];
  inventory.slots[toIndex] = temp;
  return true;
}

export function getUsedSlotCount(inventory: Inventory): number {
  return inventory.slots.filter((s) => s !== null).length;
}

export function getFreeSlotCount(inventory: Inventory): number {
  return inventory.slots.filter((s) => s === null).length;
}
