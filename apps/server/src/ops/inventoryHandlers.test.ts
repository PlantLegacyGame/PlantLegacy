import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GrowthConfig, Plant, PlantNode } from '@plant-legacy/shared/growth';
import type { ItemDefinition } from '@plant-legacy/shared/schemas';
import type { WebSocket } from 'ws';
import { createInventory } from './inventory.ts';
import {
  type InventoryPlayer,
  type InventoryPorts,
  sendInventorySync,
  swapInventorySlots,
  useInventorySlot,
} from './inventoryHandlers.ts';
import type { ItemsConfig } from './items.ts';
import type { PersistedPlayerState } from './persistence/playerStatePersistence.ts';

const growthConfig = {
  energyCapacityFloor: 1000,
  energyCapacityPerBiomass: 10,
  waterCapacityFloor: 1000,
  waterCapacityPerRootBiomass: 10,
  mineralCapacityFloor: 1000,
  mineralCapacityPerRootBiomass: 10,
} as GrowthConfig;

function makeDef(overrides: Partial<ItemDefinition> = {}): ItemDefinition {
  return {
    id: 'fertilizer_basic',
    category: 'fertilizer',
    stack_limit: 10,
    name: 'Basic Fertilizer',
    description: 'Adds minerals to the soil.',
    use: { kind: 'resources', water: 0, minerals: 5, energy: 0 },
    tradeable: true,
    mailable: true,
    listable: true,
    account_bound: false,
    ...overrides,
  };
}

function makeRoot(): PlantNode {
  return {
    id: 'n1',
    plantId: 'p1',
    type: 'root',
    layer: 'root',
    x: 4,
    y: 0,
    z: -2,
    biomass: 4,
    age: 1,
    parentId: null,
    children: [],
    statModifiers: {},
    resourceDrawWater: 0,
    resourceDrawNutrients: 0,
    resourceDrawMinerals: 0,
    upkeepBiomassPerSecond: 0,
    growthDirectionBias: 'downward',
    lastGrowthTick: 0,
    growthProgress: 1,
    isSeed: false,
  };
}

function makePlant(): Plant {
  const root = makeRoot();
  return {
    id: 'p1',
    ownerId: 'player_1',
    worldId: 'world_0',
    nodes: new Map([[root.id, root]]),
    rootNodeId: root.id,
    totalBiomass: 4,
    totalEnergy: 0,
    totalUpkeep: 0,
    storedWater: 0,
    storedMinerals: 0,
    lastGrowthTick: 0,
    growthCooldownUntil: 0,
    growthSeq: 0,
  };
}

function makeHarness(defs: ItemDefinition[] = [makeDef()]) {
  const plant = makePlant();
  const sent: Array<{ type: number; payload: unknown }> = [];
  const warnings: string[] = [];
  const deposits: string[] = [];

  const itemsConfig: ItemsConfig = {
    itemDefinitions: new Map(defs.map((def) => [def.id, def])),
    startingInventory: [],
    inventorySlots: 4,
    effects: {
      fertilizerMineralsGain: 0,
      dungWaterGain: 0,
      dungMineralsGain: 0,
      essenceEnergyGain: 0,
    },
  };

  const ports: InventoryPorts = {
    itemsConfig,
    send: (_ws, type, payload) => {
      sent.push({ type, payload });
    },
    getPlant: (plantId) => (plantId === plant.id ? plant : undefined),
    growthConfig: () => growthConfig,
    depositFertilizer: () => {
      deposits.push('fertilizer');
    },
    depositDung: () => {
      deposits.push('dung');
    },
    log: {
      info: () => {},
      warn: (message) => {
        warnings.push(message);
      },
    },
  };

  const player: InventoryPlayer = {
    ws: { readyState: 1 } as WebSocket,
    playerId: 'player_1',
    plantId: plant.id,
    inventory: createInventory(itemsConfig.inventorySlots),
    spores: 0,
  };

  return { ports, player, plant, sent, warnings, deposits };
}

describe('useInventorySlot', () => {
  it('applies the definition, enriches the soil and consumes the clicked slot', async () => {
    const { ports, player, plant, sent, deposits } = makeHarness();
    player.inventory.slots[0] = { itemId: 'fertilizer_basic', count: 2 };

    await useInventorySlot(ports, player, 0);

    assert.equal(plant.storedMinerals, 5);
    assert.deepEqual(deposits, ['fertilizer']);
    assert.deepEqual(player.inventory.slots[0], { itemId: 'fertilizer_basic', count: 1 });
    assert.deepEqual(sent, [
      { type: 28, payload: { slotIndex: 0, itemId: 'fertilizer_basic', count: 1 } },
      // A use that moves no spores still earns a line: the ledger records what
      // the pouch did, and the committed balance rides along.
      {
        type: 48,
        payload: {
          kind: 'use',
          label: 'Basic Fertilizer',
          itemId: 'fertilizer_basic',
          count: 1,
          amount: 0,
          balance: 0,
        },
      },
    ]);
  });

  it('empties the slot when the last one is used', async () => {
    const { ports, player } = makeHarness();
    player.inventory.slots[1] = { itemId: 'fertilizer_basic', count: 1 };

    await useInventorySlot(ports, player, 1);

    assert.equal(player.inventory.slots[1], null);
  });

  it('decrements only the slot that was clicked, not the first stack of that item', async () => {
    const { ports, player } = makeHarness();
    player.inventory.slots[0] = { itemId: 'fertilizer_basic', count: 5 };
    player.inventory.slots[2] = { itemId: 'fertilizer_basic', count: 5 };

    await useInventorySlot(ports, player, 2);

    assert.equal(player.inventory.slots[0]?.count, 5);
    assert.equal(player.inventory.slots[2]?.count, 4);
  });

  it('refuses an item whose use is unavailable, and leaves it in the slot', async () => {
    const booster = makeDef({
      id: 'gene_booster',
      category: 'booster',
      use: { kind: 'unavailable', reason: 'no handler yet' },
    });
    const { ports, player, plant, sent, deposits } = makeHarness([booster]);
    player.inventory.slots[0] = { itemId: 'gene_booster', count: 1 };

    await useInventorySlot(ports, player, 0);

    assert.deepEqual(sent, [
      { type: 13, payload: { reason: 'item_not_usable', originalType: 25 } },
    ]);
    assert.deepEqual(player.inventory.slots[0], { itemId: 'gene_booster', count: 1 });
    assert.equal(plant.storedMinerals, 0);
    assert.deepEqual(deposits, []);
  });

  it('warns and sends nothing for an index outside the pack', async () => {
    const { ports, player, sent, warnings } = makeHarness();

    await useInventorySlot(ports, player, 9);

    assert.deepEqual(sent, []);
    assert.deepEqual(warnings, ['Invalid inventory slot index']);
  });

  it('does nothing for an empty slot or an item the config does not know', async () => {
    const { ports, player, sent } = makeHarness();
    player.inventory.slots[0] = { itemId: 'unknown_item', count: 1 };

    await useInventorySlot(ports, player, 0);
    await useInventorySlot(ports, player, 1);

    assert.deepEqual(sent, []);
    assert.deepEqual(player.inventory.slots[0], { itemId: 'unknown_item', count: 1 });
  });

  it('clamps a resource item to the plant capacity instead of going over', async () => {
    const { ports, player, plant } = makeHarness([
      makeDef({
        id: 'full_fertilizer',
        use: { kind: 'resources', water: 50, minerals: 50, energy: 50 },
      }),
    ]);
    player.inventory.slots[0] = { itemId: 'full_fertilizer', count: 1 };
    plant.storedWater = 1000;
    plant.storedMinerals = 1000;
    plant.totalEnergy = 1000;

    await useInventorySlot(ports, player, 0);

    assert.equal(plant.storedWater, 1000, 'water stays at its capacity');
    assert.equal(plant.storedMinerals, 1000, 'minerals stay at their capacity');
    assert.equal(plant.totalEnergy, 1000, 'energy stays at its capacity');
  });

  it('spends the item under the row lock, then applies the effect', async () => {
    const { ports, player, plant, sent } = makeHarness();
    player.inventory.slots[0] = { itemId: 'fertilizer_basic', count: 2 };
    let stored: PersistedPlayerState = {
      slots: [{ itemId: 'fertilizer_basic', count: 2 }, null, null, null],
      spores: 0,
    };
    const order: string[] = [];
    ports.mutateState = async (who, apply) => {
      const change = apply(stored);
      if (!change) return null;
      if (change.next) stored = change.next;
      order.push('commit');
      who.inventory.slots = stored.slots;
      return change.result;
    };

    await useInventorySlot(ports, player, 0);

    assert.deepEqual(stored.slots[0], { itemId: 'fertilizer_basic', count: 1 });
    assert.equal(plant.storedMinerals, 5);
    assert.deepEqual(order, ['commit']);
    assert.deepEqual(sent[0], {
      type: 28,
      payload: { slotIndex: 0, itemId: 'fertilizer_basic', count: 1 },
    });
  });

  it('refuses a use whose item another click already spent, with no effect', async () => {
    const { ports, player, plant, sent } = makeHarness();
    player.inventory.slots[0] = { itemId: 'fertilizer_basic', count: 1 };
    let stored: PersistedPlayerState = { slots: [null, null, null, null], spores: 0 };
    ports.mutateState = async (_who, apply) => {
      const change = apply(stored);
      if (!change) return null;
      if (change.next) stored = change.next;
      return change.result;
    };

    await useInventorySlot(ports, player, 0);

    assert.equal(plant.storedMinerals, 0);
    // The pouch is re-sent so the panel stops offering the spent item.
    assert.equal(sent[0]?.type, 27);
  });
});

describe('swapInventorySlots', () => {
  it('swaps the two slots and reports both to the client', async () => {
    const { ports, player, sent } = makeHarness();
    player.inventory.slots[0] = { itemId: 'fertilizer_basic', count: 3 };

    await swapInventorySlots(ports, player, 0, 3);

    assert.equal(player.inventory.slots[0], null);
    assert.deepEqual(player.inventory.slots[3], { itemId: 'fertilizer_basic', count: 3 });
    assert.deepEqual(sent, [
      { type: 28, payload: { slotIndex: 0, itemId: null, count: null } },
      { type: 28, payload: { slotIndex: 3, itemId: 'fertilizer_basic', count: 3 } },
    ]);
  });

  it('ignores an out-of-range swap', async () => {
    const { ports, player, sent } = makeHarness();
    player.inventory.slots[0] = { itemId: 'fertilizer_basic', count: 3 };

    await swapInventorySlots(ports, player, 0, 9);

    assert.deepEqual(sent, []);
    assert.deepEqual(player.inventory.slots[0], { itemId: 'fertilizer_basic', count: 3 });
  });
});

describe('sendInventorySync', () => {
  it('sends the slots together with the server definitions', () => {
    const { ports, player, sent } = makeHarness();
    player.inventory.slots[0] = { itemId: 'fertilizer_basic', count: 2 };

    sendInventorySync(ports, player);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 27);
    const payload = sent[0].payload as {
      slots: Array<{ itemId: string | null; count: number | null }>;
      maxSlots: number;
      definitions: Array<{ id: string; name: string; stackLimit: number }>;
    };
    assert.deepEqual(payload.slots, [
      { itemId: 'fertilizer_basic', count: 2 },
      { itemId: null, count: null },
      { itemId: null, count: null },
      { itemId: null, count: null },
    ]);
    assert.equal(payload.maxSlots, 4);
    assert.deepEqual(
      payload.definitions.map((def) => def.id),
      ['fertilizer_basic'],
    );
    assert.equal(payload.definitions[0].name, 'Basic Fertilizer');
    assert.equal(payload.definitions[0].stackLimit, 10);
  });
});
