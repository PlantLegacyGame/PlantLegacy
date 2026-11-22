import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ItemDefinition } from '@plant-legacy/shared/schemas';
import type { Pool } from 'pg';
import { createInventory } from '../inventory.ts';
import {
  PlayerStateStore,
  sanitizeSlots,
  toInventory,
  toPersistedState,
} from './playerStatePersistence.ts';

const definitions = new Map<string, ItemDefinition>([
  [
    'dung',
    {
      id: 'dung',
      name: 'Dung',
      description: 'A heap.',
      category: 'dung',
      stack_limit: 5,
      account_bound: false,
      tradeable: true,
      mailable: true,
      listable: true,
      use: { kind: 'resources', water: 0, minerals: 0, energy: 0 },
    } as ItemDefinition,
  ],
  [
    'seed',
    {
      id: 'seed',
      name: 'Seed',
      description: 'A seed.',
      category: 'heirloom_seed',
      stack_limit: 1,
      account_bound: true,
      tradeable: false,
      mailable: false,
      listable: false,
      use: { kind: 'unavailable', reason: 'not usable in this test' },
    } as ItemDefinition,
  ],
]);

const options = { itemDefinitions: definitions, maxSlots: 4, maxSpores: 1000 };

describe('sanitizeSlots', () => {
  it('keeps valid slots and drops unknown or malformed ones', () => {
    const slots = sanitizeSlots(
      [
        { itemId: 'dung', count: 3 },
        { itemId: 'missing', count: 1 },
        { itemId: 'seed', count: 9 },
        { itemId: 'dung', count: 0 },
        { itemId: 'dung', count: 1 },
      ],
      options,
    );
    assert.deepEqual(slots, [
      { itemId: 'dung', count: 3 },
      null,
      { itemId: 'seed', count: 1 },
      null,
    ]);
  });

  it('fills a short or missing array to the configured slot count', () => {
    assert.deepEqual(sanitizeSlots(null, options), [null, null, null, null]);
    assert.deepEqual(sanitizeSlots([{ itemId: 'dung', count: 2 }], options), [
      { itemId: 'dung', count: 2 },
      null,
      null,
      null,
    ]);
  });

  it('reports a repair instead of silently dropping a row', () => {
    const repairs: string[] = [];
    sanitizeSlots([{ itemId: 'missing', count: 1 }], {
      ...options,
      onRepair: (message) => repairs.push(message),
    });
    assert.equal(repairs.length, 1);
    assert.match(repairs[0] ?? '', /no longer exists/);
  });
});

describe('persisted state conversion', () => {
  it('round-trips a pouch and a purse', () => {
    const inventory = createInventory(4);
    inventory.slots[1] = { itemId: 'dung', count: 4 };
    inventory.slots[2] = { itemId: 'seed', count: 1 };
    const state = toPersistedState(inventory, 42);
    const loaded = toInventory(state, options);
    assert.deepEqual(loaded.slots, [
      null,
      { itemId: 'dung', count: 4 },
      { itemId: 'seed', count: 1 },
      null,
    ]);
  });
});

describe('PlayerStateStore', () => {
  it('returns null when the owner has no row', async () => {
    const pool = {
      query: async () => ({ rows: [] }),
    } as unknown as Pool;
    const store = new PlayerStateStore(pool, options);
    assert.equal(await store.load('acct_none'), null);
  });

  it('loads a row through the same sanitiser as a write', async () => {
    const pool = {
      query: async () => ({
        rows: [
          {
            slots: [
              { itemId: 'dung', count: 99 },
              { itemId: 'missing', count: 1 },
            ],
            // pg returns BIGINT as a string, not a JavaScript number.
            spores: '5000',
          },
        ],
      }),
    } as unknown as Pool;
    const store = new PlayerStateStore(pool, options);
    const state = await store.load('acct_one');
    assert.deepEqual(state, {
      slots: [{ itemId: 'dung', count: 5 }, null, null, null],
      spores: 1000,
    });
  });

  it('writes one upsert with the validated slots and purse', async () => {
    let captured: unknown[] = [];
    const pool = {
      query: async (_sql: string, params: unknown[]) => {
        captured = params;
        return { rows: [] };
      },
    } as unknown as Pool;
    const store = new PlayerStateStore(pool, options);
    await store.save('acct_one', {
      slots: [
        { itemId: 'dung', count: 2 },
        { itemId: 'dung', count: 99 },
      ],
      spores: 77,
    });
    assert.equal(captured[0], 'acct_one');
    assert.equal(
      captured[1],
      JSON.stringify([{ itemId: 'dung', count: 2 }, { itemId: 'dung', count: 5 }, null, null]),
    );
    assert.equal(captured[2], 77);
  });
});
