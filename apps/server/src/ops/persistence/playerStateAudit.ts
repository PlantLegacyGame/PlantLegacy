/**
 * Postgres round-trip audit for the locked pouch and purse.
 *
 * Not a unit test: this needs a real database, because the property under audit
 * is that a change survives the transaction and comes back the same to the next
 * reader. It drives the real `useInventorySlot` handler, the shared award and
 * the dev item grant through a real `PlayerStateStore`, then re-loads the row so
 * every assertion is about what Postgres committed rather than what the process
 * believes.
 *
 *   DATABASE_URL=postgres://plant:plant@127.0.0.1:5432/plant_legacy \
 *     node apps/server/src/ops/persistence/playerStateAudit.ts
 *
 * The account it creates is deleted at the end, whatever happens.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GrowthConfig, Plant, PlantNode } from '@plant-legacy/shared/growth';
import type { ItemDefinition } from '@plant-legacy/shared/schemas';
import { Pool } from 'pg';
import type { WebSocket } from 'ws';
import {
  type InventoryPlayer,
  type InventoryPorts,
  useInventorySlot,
} from '../inventoryHandlers.ts';
import { grantItemUnderLock } from '../itemGrant.ts';
import type { ItemsConfig } from '../items.ts';
import { awardSporesStored, mutatePlayerState } from '../playerStateMutations.ts';
import type { SporeConfig } from '../spores.ts';
import { runMigrations } from './migrate.ts';
import {
  type PersistedPlayerState,
  PlayerStateStore,
  toInventory,
  toPersistedState,
} from './playerStatePersistence.ts';

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
  [
    'starter_dung',
    {
      id: 'starter_dung',
      name: 'Starter Dung',
      description: 'Water, and a little back in spores.',
      category: 'dung',
      stack_limit: 5,
      account_bound: false,
      tradeable: true,
      mailable: true,
      listable: true,
      use: { kind: 'resources', water: 5, minerals: 0, energy: 0 },
    } as ItemDefinition,
  ],
]);

const storeOptions = { itemDefinitions: definitions, maxSlots: 4, maxSpores: 1000 };
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
const sporeConfig = { earnDung: 8, maxBalance: 1000 } as SporeConfig;
const growthConfig = {
  energyCapacityFloor: 1000,
  energyCapacityPerBiomass: 10,
  waterCapacityFloor: 1000,
  waterCapacityPerRootBiomass: 10,
  mineralCapacityFloor: 1000,
  mineralCapacityPerRootBiomass: 10,
} as GrowthConfig;
const emptySlots: PersistedPlayerState['slots'] = [null, null, null, null];

function makePlant(): Plant {
  const root: PlantNode = {
    id: 'n1',
    plantId: 'p1',
    type: 'root',
    layer: 'root',
    x: 0,
    y: 0,
    z: 0,
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
  return {
    id: 'p1',
    ownerId: 'audit',
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

async function playerFrom(
  store: PlayerStateStore,
  ownerId: string,
  plantId: string,
): Promise<InventoryPlayer> {
  const state = await store.load(ownerId);
  assert.ok(state, 'the seeded row must load');
  return {
    ws: {} as WebSocket,
    playerId: 'audit_player',
    plantId,
    inventory: toInventory(state, storeOptions),
    spores: state.spores,
  };
}

function makePorts(
  store: PlayerStateStore,
  ownerId: string,
  plant: Plant,
  _player: InventoryPlayer,
): InventoryPorts {
  return {
    itemsConfig,
    sporeConfig,
    send: () => {},
    getPlant: (plantId) => (plantId === plant.id ? plant : undefined),
    growthConfig: () => growthConfig,
    depositFertilizer: () => {},
    depositDung: () => {},
    log: { info: () => {}, warn: () => undefined },
    // The same composition the world uses: the plan runs against the row read
    // inside the lock, and the live copy adopts the committed state.
    mutateState: (target, apply) =>
      mutatePlayerState(
        {
          store,
          accountId: ownerId,
          unavailable: false,
          initial: toPersistedState(target.inventory, target.spores),
        },
        apply,
        (state) => {
          target.inventory.slots = toInventory(state, storeOptions).slots;
          target.spores = state.spores;
        },
      ),
  };
}

function pass(what: string, detail: string): void {
  console.log(`PASS ${what}: ${detail}`);
}

/**
 * One use, then a fresh load: the decrement and the dung's spores must both be
 * in the row, and the live pouch must agree with it.
 */
async function itemUseRoundTrip(store: PlayerStateStore, ownerId: string): Promise<void> {
  await store.save(ownerId, {
    slots: [{ itemId: 'starter_fertilizer', count: 2 }, null, null, null],
    spores: 0,
  });
  const plant = makePlant();
  const player = await playerFrom(store, ownerId, plant.id);
  await useInventorySlot(makePorts(store, ownerId, plant, player), player, 0);

  const row = await store.load(ownerId);
  assert.ok(row);
  assert.equal(row.slots[0]?.count, 1, 'the row must hold the decrement');
  assert.equal(player.inventory.slots[0]?.count, 1, 'the live pouch must match the row');
  assert.equal(plant.storedMinerals, 5, 'the plant gains minerals after the commit');
  pass('item use round trip', 'fertilizer 2 -> 1 in the row, +5 minerals on the plant');
}

/**
 * Two clicks on the last item, both admitted by the on-screen pouch. Exactly one
 * may consume it, or the row would be overdrawn.
 */
async function concurrentLastItem(store: PlayerStateStore, ownerId: string): Promise<void> {
  await store.save(ownerId, {
    slots: [{ itemId: 'starter_fertilizer', count: 1 }, null, null, null],
    spores: 0,
  });
  const plant = makePlant();
  const player = await playerFrom(store, ownerId, plant.id);
  const ports = makePorts(store, ownerId, plant, player);

  await Promise.all([useInventorySlot(ports, player, 0), useInventorySlot(ports, player, 0)]);

  const row = await store.load(ownerId);
  assert.ok(row);
  assert.equal(row.slots[0], null, 'the item is gone from the row');
  assert.equal(plant.storedMinerals, 5, 'the second click must not pay minerals again');
  assert.equal(player.inventory.slots[0], null, 'the live pouch must match the row');
  pass('concurrent last item', 'one of two clicks consumed it; +5 minerals once');
}

/** Dung pays spores in the same row write as the consumption. */
async function dungPaysInTheSameRow(store: PlayerStateStore, ownerId: string): Promise<void> {
  await store.save(ownerId, {
    slots: [{ itemId: 'starter_dung', count: 3 }, null, null, null],
    spores: 100,
  });
  const plant = makePlant();
  const player = await playerFrom(store, ownerId, plant.id);
  await useInventorySlot(makePorts(store, ownerId, plant, player), player, 0);

  const row = await store.load(ownerId);
  assert.ok(row);
  assert.equal(row.slots[0]?.count, 2, 'the row must hold the decrement');
  assert.equal(row.spores, 108, 'the row must hold the dung spores');
  assert.equal(player.spores, 108, 'the live purse must match the row');
  pass('dung spores round trip', '100 -> 108 in the row with the stack at 2');
}

/** Two awards in flight: the sum must survive, clamped by the purse maximum. */
async function concurrentAwards(store: PlayerStateStore, ownerId: string): Promise<void> {
  await store.save(ownerId, { slots: emptySlots, spores: 0 });
  const player = await playerFrom(store, ownerId, 'p1');
  const context = {
    store,
    accountId: ownerId,
    unavailable: false,
    initial: toPersistedState(player.inventory, player.spores),
  };
  const adopt = (state: PersistedPlayerState): void => {
    player.spores = state.spores;
  };
  await Promise.all([
    awardSporesStored({ ...context, amount: 7, maxBalance: 1000 }, (state) => adopt(state)),
    awardSporesStored({ ...context, amount: 8, maxBalance: 1000 }, (state) => adopt(state)),
  ]);

  const row = await store.load(ownerId);
  assert.ok(row);
  assert.equal(row.spores, 15, 'both awards must be in the row');
  pass('concurrent awards', '7 + 8 -> 15 in the row');
}

/**
 * The requested guarantee: a plan the store clamps (a stack over its limit, a
 * purse over its maximum) must not be adopted. The live copy follows the row.
 */
async function clampedWriteAdoption(store: PlayerStateStore, ownerId: string): Promise<void> {
  await store.save(ownerId, { slots: emptySlots, spores: 100 });
  const player = await playerFrom(store, ownerId, 'p1');

  await mutatePlayerState(
    {
      store,
      accountId: ownerId,
      unavailable: false,
      initial: toPersistedState(player.inventory, player.spores),
    },
    () => ({
      next: { slots: [{ itemId: 'starter_fertilizer', count: 99 }], spores: 5000 },
      result: 'planned',
    }),
    (state) => {
      player.inventory.slots = toInventory(state, storeOptions).slots;
      player.spores = state.spores;
    },
  );

  const row = await store.load(ownerId);
  assert.ok(row);
  assert.equal(row.spores, 1000, 'the row clamps the purse');
  assert.equal(row.slots[0]?.count, 10, 'the row clamps the stack');
  assert.equal(player.spores, 1000, 'the live purse must adopt the clamped row');
  assert.equal(player.inventory.slots[0]?.count, 10, 'the live stack must adopt the clamped row');
  pass('clamped write', 'plan 5000 spores / 99 stack -> row and live copy 1000 / 10');
}

/**
 * The dev grant is a locked write too: it must land in the row, the live pouch
 * must adopt it, and two grants in flight must stop at the stack limit instead
 * of overshooting it.
 */
async function devGrantRoundTrip(store: PlayerStateStore, ownerId: string): Promise<void> {
  await store.save(ownerId, { slots: emptySlots, spores: 0 });
  const player = await playerFrom(store, ownerId, 'p1');
  const context = {
    store,
    accountId: ownerId,
    unavailable: false,
    itemsConfig,
  };
  const adopt = (state: PersistedPlayerState): void => {
    player.inventory.slots = toInventory(state, storeOptions).slots;
    player.spores = state.spores;
  };

  const added = await grantItemUnderLock(
    {
      ...context,
      initial: toPersistedState(player.inventory, player.spores),
      itemId: 'starter_fertilizer',
      count: 3,
    },
    adopt,
  );

  const row = await store.load(ownerId);
  assert.ok(row);
  assert.equal(row.slots[0]?.count, 3, 'the row must hold the grant');
  assert.equal(added, 3, 'the grant must answer with what the row took');
  assert.equal(player.inventory.slots[0]?.count, 3, 'the live pouch must match the row');
  pass('dev grant round trip', '3 fertilizer in the row, and the live pouch agrees');

  // A fresh pouch, then two grants at once against a stack limit of 10: the
  // row must clamp rather than overshoot, and the live stack must read back the
  // clamped row. Nothing here waits for the other grant before planning.
  await store.save(ownerId, { slots: emptySlots, spores: 0 });
  const raced = await playerFrom(store, ownerId, 'p1');
  const racedAdopt = (state: PersistedPlayerState): void => {
    raced.inventory.slots = toInventory(state, storeOptions).slots;
    raced.spores = state.spores;
  };
  await Promise.all([
    grantItemUnderLock(
      {
        ...context,
        initial: toPersistedState(raced.inventory, raced.spores),
        itemId: 'starter_fertilizer',
        count: 7,
      },
      racedAdopt,
    ),
    grantItemUnderLock(
      {
        ...context,
        initial: toPersistedState(raced.inventory, raced.spores),
        itemId: 'starter_fertilizer',
        count: 7,
      },
      racedAdopt,
    ),
  ]);

  const after = await store.load(ownerId);
  assert.ok(after);
  assert.equal(after.slots[0]?.count, 10, 'the row clamps the stack to its limit');
  assert.equal(raced.inventory.slots[0]?.count, 10, 'the live stack must adopt the clamped row');
  pass('concurrent dev grants', '7 + 7 -> 10 in the row, and the live pouch agrees');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (this audit runs against Postgres).');
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({ connectionString: url });
  const ownerId = `audit_${randomBytes(6).toString('hex')}`;
  try {
    await runMigrations(pool, dirname(fileURLToPath(import.meta.url)));
    const store = new PlayerStateStore(pool, storeOptions);
    await itemUseRoundTrip(store, ownerId);
    await concurrentLastItem(store, ownerId);
    await dungPaysInTheSameRow(store, ownerId);
    await concurrentAwards(store, ownerId);
    await clampedWriteAdoption(store, ownerId);
    await devGrantRoundTrip(store, ownerId);
    console.log('OK: every locked-path assertion held against Postgres.');
  } catch (error) {
    console.error('FAIL:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.query('DELETE FROM player_state WHERE owner_id = $1', [ownerId]).catch(() => {});
    await pool.end();
  }
}

void main();
