import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ItemDefinition } from '@plant-legacy/shared/schemas';
import {
  addItem,
  createInventory,
  getFreeSlotCount,
  getItemCount,
  getSlot,
  getUsedSlotCount,
  hasItem,
  removeItem,
  setSlot,
  swapSlots,
} from './inventory.ts';

function def(id: string, stackLimit: number): ItemDefinition {
  return {
    id,
    category: 'dung',
    stack_limit: stackLimit,
    name: id,
    description: `${id} for tests`,
    use: { kind: 'resources', water: 1, minerals: 1, energy: 0 },
    tradeable: false,
    mailable: false,
    listable: false,
    account_bound: false,
  };
}

const defs = new Map([
  ['seed', def('seed', 3)],
  ['dung', def('dung', 10)],
]);

describe('inventory stacking and slots', () => {
  it('fills an existing stack before opening a new slot', () => {
    const inventory = createInventory(3);
    addItem(inventory, 'seed', 2, defs);
    const added = addItem(inventory, 'seed', 2, defs);
    assert.equal(added, 2);
    assert.deepEqual(getSlot(inventory, 0), { itemId: 'seed', count: 3 });
    assert.deepEqual(getSlot(inventory, 1), { itemId: 'seed', count: 1 });
    assert.equal(getUsedSlotCount(inventory), 2);
  });

  it('returns only the amount that fitted when the inventory is full', () => {
    const inventory = createInventory(1);
    const added = addItem(inventory, 'seed', 7, defs);
    assert.equal(added, 3);
    assert.equal(getItemCount(inventory, 'seed'), 3);
    assert.equal(getFreeSlotCount(inventory), 0);
  });

  it('rejects unknown items and unusable counts without changing the slots', () => {
    const inventory = createInventory(2);
    assert.equal(addItem(inventory, 'missing', 1, defs), 0);
    assert.equal(addItem(inventory, 'seed', 0, defs), 0);
    assert.equal(addItem(inventory, 'seed', -3, defs), 0);
    assert.equal(addItem(inventory, 'seed', 1.5, defs), 0);
    assert.equal(addItem(inventory, 'seed', Number.NaN, defs), 0);
    assert.equal(getUsedSlotCount(inventory), 0);
  });

  it('removes across stacks and clears emptied slots', () => {
    const inventory = createInventory(2);
    addItem(inventory, 'seed', 5, defs);
    assert.equal(removeItem(inventory, 'seed', 4), 4);
    assert.equal(getSlot(inventory, 0), null);
    assert.deepEqual(getSlot(inventory, 1), { itemId: 'seed', count: 1 });
    assert.equal(removeItem(inventory, 'seed', 9), 1);
    assert.equal(getUsedSlotCount(inventory), 0);
  });

  it('ignores removal counts that are not positive integers', () => {
    const inventory = createInventory(1);
    addItem(inventory, 'seed', 2, defs);
    assert.equal(removeItem(inventory, 'seed', 0), 0);
    assert.equal(removeItem(inventory, 'seed', -1), 0);
    assert.equal(removeItem(inventory, 'seed', 0.5), 0);
    assert.equal(getItemCount(inventory, 'seed'), 2);
  });

  it('answers presence questions from the whole inventory', () => {
    const inventory = createInventory(2);
    addItem(inventory, 'seed', 5, defs);
    assert.equal(hasItem(inventory, 'seed', 5), true);
    assert.equal(hasItem(inventory, 'seed', 6), false);
    assert.equal(hasItem(inventory, 'dung', 1), false);
  });

  it('validates a directly set slot against bounds and the stack limit', () => {
    const inventory = createInventory(2);
    assert.equal(setSlot(inventory, 0, { itemId: 'seed', count: 2 }, defs), true);
    assert.equal(setSlot(inventory, 0, { itemId: 'seed', count: 4 }, defs), false);
    assert.equal(setSlot(inventory, 0, { itemId: 'seed', count: 0 }, defs), false);
    assert.equal(setSlot(inventory, 0, { itemId: '', count: 1 }, defs), false);
    assert.equal(setSlot(inventory, 0, { itemId: 'missing', count: 1 }, defs), false);
    assert.equal(setSlot(inventory, 9, { itemId: 'seed', count: 1 }, defs), false);
    assert.deepEqual(getSlot(inventory, 0), { itemId: 'seed', count: 2 });
    assert.equal(setSlot(inventory, 0, null), true);
    assert.equal(getSlot(inventory, 0), null);
  });

  it('swaps slots by reference and ignores out-of-range indices', () => {
    const inventory = createInventory(2);
    setSlot(inventory, 0, { itemId: 'seed', count: 1 }, defs);
    setSlot(inventory, 1, { itemId: 'dung', count: 2 }, defs);
    assert.equal(swapSlots(inventory, 0, 1), true);
    assert.deepEqual(getSlot(inventory, 0), { itemId: 'dung', count: 2 });
    assert.deepEqual(getSlot(inventory, 1), { itemId: 'seed', count: 1 });
    assert.equal(swapSlots(inventory, 0, 0), true);
    assert.equal(swapSlots(inventory, -1, 0), false);
    assert.equal(swapSlots(inventory, 0, 2), false);
  });
});
