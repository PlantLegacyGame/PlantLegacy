import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigFile } from '@plant-legacy/shared/config';
import { loadItemsConfig, resolveItemUse } from './items.ts';

function itemsConfig(
  definitions: Array<{
    id: string;
    category: string;
    name: string;
    description: string;
    use_kind: string;
    use_reason: string;
    account_bound: boolean;
    tradeable: boolean;
    mailable: boolean;
    listable: boolean;
    stack_limit: number;
  }>,
): Map<string, ConfigFile> {
  const file: ConfigFile = {
    _meta: {
      system: 'items',
      version: '0.1.0',
      schema: 'extended-1',
      owner_task: 'T08A',
      status: 'active',
    },
    values: {
      item_definitions: { type: 'schema_array', value: definitions, schema: {} },
      starting_inventory: {
        type: 'schema_array',
        value: [{ item_id: 'seed', count: 1 }],
        schema: {},
      },
      inventory_slots: { type: 'integer', value: 10, range: [1, 100] },
      fertilizer_minerals_gain: { type: 'number', value: 50, range: [1, 1000] },
      dung_water_gain: { type: 'number', value: 30, range: [1, 1000] },
      dung_minerals_gain: { type: 'number', value: 20, range: [1, 1000] },
      essence_energy_gain: { type: 'number', value: 500, range: [1, 10000] },
    },
  };
  return new Map([['items', file]]);
}

const base = {
  id: 'seed',
  category: 'dung',
  name: 'Test Seed',
  description: 'A seed used only by this test. Use: 30 water and 20 minerals.',
  use_kind: 'resources',
  use_reason: '',
  account_bound: false,
  tradeable: true,
  mailable: true,
  listable: true,
  stack_limit: 1,
};

describe('items config invariants', () => {
  it('loads definitions and normalises snake_case starting inventory', () => {
    const config = loadItemsConfig(itemsConfig([base]));
    assert.equal(config.itemDefinitions.get('seed')?.stack_limit, 1);
    assert.deepEqual(config.startingInventory, [{ itemId: 'seed', count: 1 }]);
  });

  it('rejects an account-bound item that is also tradeable', () => {
    assert.throws(
      () => loadItemsConfig(itemsConfig([{ ...base, account_bound: true }])),
      /account-bound/,
    );
  });

  it('rejects a non-positive or fractional stack limit', () => {
    assert.throws(() => loadItemsConfig(itemsConfig([{ ...base, stack_limit: 0 }])), /stack_limit/);
    assert.throws(
      () => loadItemsConfig(itemsConfig([{ ...base, stack_limit: 1.5 }])),
      /stack_limit/,
    );
  });

  it('keeps the name, description and concrete use instead of dropping them', () => {
    // The loader used to read name and description and then store neither, so
    // the client had no description to show and invented the name from the id.
    const config = loadItemsConfig(itemsConfig([base]));
    const definition = config.itemDefinitions.get('seed');
    assert.equal(definition?.name, 'Test Seed');
    assert.match(definition?.description ?? '', /30 water and 20 minerals/);
    assert.deepEqual(definition?.use, { kind: 'resources', water: 30, minerals: 20, energy: 0 });
  });

  it('rejects an item with no display name or no description', () => {
    assert.throws(() => loadItemsConfig(itemsConfig([{ ...base, name: ' ' }])), /display name/);
    assert.throws(
      () => loadItemsConfig(itemsConfig([{ ...base, description: '' }])),
      /no description/,
    );
  });
});

describe('item use declarations', () => {
  const effects = {
    fertilizerMineralsGain: 50,
    dungWaterGain: 30,
    dungMineralsGain: 20,
    essenceEnergyGain: 500,
  };

  it('resolves each implemented category to the numbers it will grant', () => {
    assert.deepEqual(resolveItemUse('f', 'fertilizer', 'resources', '', effects), {
      kind: 'resources',
      water: 0,
      minerals: 50,
      energy: 0,
    });
    assert.deepEqual(resolveItemUse('d', 'dung', 'resources', '', effects), {
      kind: 'resources',
      water: 30,
      minerals: 20,
      energy: 0,
    });
    assert.deepEqual(resolveItemUse('e', 'essence', 'resources', '', effects), {
      kind: 'resources',
      water: 0,
      minerals: 0,
      energy: 500,
    });
  });

  it('keeps the reason for an item the server cannot use yet', () => {
    assert.deepEqual(
      resolveItemUse(
        'b',
        'booster',
        'unavailable',
        'Timed boosters are not implemented yet',
        effects,
      ),
      { kind: 'unavailable', reason: 'Timed boosters are not implemented yet' },
    );
  });

  it('refuses the declarations that would make the button lie', () => {
    assert.throws(
      () => resolveItemUse('b', 'booster', 'resources', '', effects),
      /no server handler/,
    );
    assert.throws(
      () => resolveItemUse('f', 'fertilizer', 'unavailable', 'x', effects),
      /is implemented/,
    );
    assert.throws(() => resolveItemUse('b', 'booster', 'unavailable', ' ', effects), /no reason/);
    assert.throws(() => resolveItemUse('b', 'booster', 'maybe', '', effects), /use_kind/);
  });
});
