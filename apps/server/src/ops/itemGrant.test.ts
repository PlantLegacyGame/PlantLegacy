import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ItemDefinition } from '@plant-legacy/shared/schemas';
import { createInventory, type Inventory } from './inventory.ts';
import { grantItemUnderLock, previewItemGrant } from './itemGrant.ts';
import type { ItemsConfig } from './items.ts';
import type {
  PersistedPlayerState,
  PlayerStateStore,
} from './persistence/playerStatePersistence.ts';
import { toInventory } from './persistence/playerStatePersistence.ts';

const definitions = new Map<string, ItemDefinition>([
  [
    'starter_fertilizer',
    {
      id: 'starter_fertilizer',
      name: 'Starter Fertilizer',
      description: 'Minerals for the soil.',
      category: 'fertilizer',
      stack_limit: 10,
      account_bound: false,
      tradeable: true,
      mailable: true,
      listable: true,
      use: { kind: 'resources', water: 0, minerals: 5, energy: 0 },
    } as ItemDefinition,
  ],
]);

const itemsConfig: ItemsConfig = {
  itemDefinitions: definitions,
  startingInventory: [],
  inventorySlots: 4,
  effects: {
    fertilizerMineralsGain: 0,
    dungWaterGain: 0,
    dungMineralsGain: 0,
    essenceEnergyGain: 0,
  },
};

const empty: PersistedPlayerState = { slots: [null, null, null, null], spores: 0 };

interface LivePlayer {
  inventory: Inventory;
  spores: number;
}

/** What `World.adoptPlayerState` does: replace the live pouch with the row. */
function adopt(player: LivePlayer, state: PersistedPlayerState): void {
  player.inventory.slots = toInventory(state, {
    itemDefinitions: itemsConfig.itemDefinitions,
    maxSlots: itemsConfig.inventorySlots,
  }).slots;
  player.spores = state.spores;
}

describe('previewItemGrant', () => {
  it('counts what a grant would add without changing the pouch it was given', () => {
    const slots: PersistedPlayerState['slots'] = [
      { itemId: 'starter_fertilizer', count: 9 },
      null,
      null,
      null,
    ];
    const before = JSON.stringify(slots);
    assert.equal(previewItemGrant(itemsConfig, slots, 'starter_fertilizer', 3), 3);
    assert.equal(previewItemGrant(itemsConfig, slots, 'ghost', 1), 0);
    assert.equal(JSON.stringify(slots), before, 'the preview must not write');
  });
});

describe('grantItemUnderLock', () => {
  it('adopts the committed pouch, not the live pouch plus the plan', async () => {
    // The row already held two fertilizer and the live copy had none; the grant
    // took three more there, so what committed is a stack of five.
    const row: PersistedPlayerState = {
      slots: [{ itemId: 'starter_fertilizer', count: 2 }, null, null, null],
      spores: 0,
    };
    const committed: PersistedPlayerState = {
      slots: [{ itemId: 'starter_fertilizer', count: 5 }, null, null, null],
      spores: 0,
    };
    const store = {
      mutate: async (
        _ownerId: string,
        _initial: PersistedPlayerState,
        apply: (
          current: PersistedPlayerState,
        ) => { next?: PersistedPlayerState; result: unknown } | null,
        onCommitted?: (state: PersistedPlayerState) => void,
      ) => {
        const change = apply(row);
        onCommitted?.(committed);
        return change?.result ?? 0;
      },
    } as unknown as PlayerStateStore;

    const player: LivePlayer = { inventory: createInventory(4), spores: 0 };
    const added = await grantItemUnderLock(
      {
        store,
        accountId: 'acct_one',
        unavailable: false,
        initial: empty,
        itemsConfig,
        itemId: 'starter_fertilizer',
        count: 3,
      },
      (state) => adopt(player, state),
    );

    assert.equal(added, 3);
    assert.equal(player.inventory.slots[0]?.count, 5, 'the live stack must follow the row');
  });

  it('grants nothing, and adopts nothing, when the locked pouch is full', async () => {
    const full: PersistedPlayerState = {
      slots: [
        { itemId: 'starter_fertilizer', count: 10 },
        { itemId: 'starter_fertilizer', count: 10 },
        { itemId: 'starter_fertilizer', count: 10 },
        { itemId: 'starter_fertilizer', count: 10 },
      ],
      spores: 0,
    };
    const store = {
      mutate: async (
        _ownerId: string,
        _initial: PersistedPlayerState,
        apply: (
          current: PersistedPlayerState,
        ) => { next?: PersistedPlayerState; result: unknown } | null,
      ) => apply(full)?.result ?? 0,
    } as unknown as PlayerStateStore;

    const added = await grantItemUnderLock(
      {
        store,
        accountId: 'acct_one',
        unavailable: false,
        initial: empty,
        itemsConfig,
        itemId: 'starter_fertilizer',
        count: 1,
      },
      () => assert.fail('a grant that added nothing must not be adopted'),
    );

    assert.equal(added, 0);
  });

  it('falls back to the live pouch for a guest, which is the only copy there', async () => {
    const player: LivePlayer = { inventory: createInventory(4), spores: 0 };
    const added = await grantItemUnderLock(
      {
        store: null,
        accountId: null,
        unavailable: false,
        initial: empty,
        itemsConfig,
        itemId: 'starter_fertilizer',
        count: 2,
      },
      (state) => adopt(player, state),
    );

    assert.equal(added, 2);
    assert.equal(player.inventory.slots[0]?.count, 2);
  });
});
