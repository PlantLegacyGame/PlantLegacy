import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ItemDefinition } from '@plant-legacy/shared/schemas';
import { createInventory, type Inventory } from './inventory.ts';
import type { ItemsConfig } from './items.ts';
import type {
  PersistedPlayerState,
  PlayerStateStore,
} from './persistence/playerStatePersistence.ts';
import { toInventory } from './persistence/playerStatePersistence.ts';
import { purchaseUnderLock } from './shopPurchase.ts';
import type { SporeConfig } from './spores.ts';

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
const shopConfig = {
  enabled: true,
  currencyName: 'spores',
  items: [{ id: 'starter_fertilizer', name: 'Starter Fertilizer', price: 30 }],
};
const sporeConfig = { earnDung: 0, maxBalance: 1000 } as SporeConfig;

interface LivePlayer {
  inventory: Inventory;
  spores: number;
}

describe('purchaseUnderLock', () => {
  it('adopts the committed row, not the purchase plan', async () => {
    const initial: PersistedPlayerState = { slots: [null, null, null, null], spores: 100 };
    // The row the store commits holds a capped stack and purse where the plan
    // asked for one item and 70 spores: anything that copies the plan back onto
    // the player would show the player a pouch the database does not have.
    const committed: PersistedPlayerState = {
      slots: [{ itemId: 'starter_fertilizer', count: 10 }, null, null, null],
      spores: 1000,
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
        const change = apply(initial);
        onCommitted?.(committed);
        return change?.result ?? null;
      },
    } as unknown as PlayerStateStore;

    const player: LivePlayer = { inventory: createInventory(4), spores: 100 };
    const plan = await purchaseUnderLock(
      {
        store,
        accountId: 'acct_one',
        unavailable: false,
        initial,
        itemsConfig,
        shopConfig,
        sporeConfig,
        itemId: 'starter_fertilizer',
      },
      (state) => {
        // What `World.adoptPlayerState` does: replace the live copy.
        player.inventory.slots = toInventory(state, {
          itemDefinitions: itemsConfig.itemDefinitions,
          maxSlots: itemsConfig.inventorySlots,
        }).slots;
        player.spores = state.spores;
      },
    );

    if (!plan?.ok) assert.fail('the purchase must be planned against the row');
    assert.equal(plan.spores, 70, 'the plan is the row balance less the price');
    assert.equal(player.spores, 1000, 'the live purse must follow the committed row');
    assert.equal(player.inventory.slots[0]?.count, 10, 'the live stack must follow the row');
    assert.equal(player.inventory.slots[0]?.itemId, 'starter_fertilizer');
  });

  it('answers a refusal from the row it read, and adopts nothing', async () => {
    const initial: PersistedPlayerState = { slots: [null, null, null, null], spores: 10 };
    const store = {
      mutate: async (
        _ownerId: string,
        _initial: PersistedPlayerState,
        apply: (
          current: PersistedPlayerState,
        ) => { next?: PersistedPlayerState; result: unknown } | null,
      ) => apply(initial)?.result ?? null,
    } as unknown as PlayerStateStore;

    const player: LivePlayer = { inventory: createInventory(4), spores: 10 };
    const plan = await purchaseUnderLock(
      {
        store,
        accountId: 'acct_one',
        unavailable: false,
        initial,
        itemsConfig,
        shopConfig,
        sporeConfig,
        itemId: 'starter_fertilizer',
      },
      () => assert.fail('a refused purchase must not be adopted'),
    );

    assert.ok(plan);
    assert.equal(plan.ok, false);
    if (!plan.ok) assert.equal(plan.reason, 'insufficient_spores');
    assert.equal(player.spores, 10);
    assert.equal(player.inventory.slots[0], null);
  });
});
