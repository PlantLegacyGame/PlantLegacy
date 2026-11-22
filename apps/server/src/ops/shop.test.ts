import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ItemDefinition } from '@plant-legacy/shared/schemas';
import type { WebSocket } from 'ws';
import { createInventory } from './inventory.ts';

import type { ItemsConfig } from './items.ts';
import { MESSAGE_TYPE } from './net.ts';
import { purchaseShopItem, type ShopPlayer, type ShopPorts } from './shop.ts';
import type { SporeConfig } from './spores.ts';

const SPORES: SporeConfig = {
  startingBalance: 0,
  earnDung: 5,
  earnMutation: 15,
  earnFragment: 3,
  earnKill: 30,
  maxBalance: 1000,
};

function definition(id: string): ItemDefinition {
  return {
    id,
    name: id,
    description: '',
    category: 'fertilizer',
    stack_limit: 10,
    use: { kind: 'resources', water: 1, minerals: 0, energy: 0 },
  } as unknown as ItemDefinition;
}

function make(itemsSlots = 4) {
  const definitions = new Map<string, ItemDefinition>([
    ['starter_fertilizer', definition('starter_fertilizer')],
  ]);
  const itemsConfig: ItemsConfig = {
    itemDefinitions: definitions,
    startingInventory: [],
    inventorySlots: itemsSlots,
    effects: {} as ItemsConfig['effects'],
  };
  const sent: Array<{ type: number; payload: unknown }> = [];
  const ports: ShopPorts = {
    itemsConfig,
    shopConfig: {
      enabled: true,
      currencyName: 'spores',
      items: [{ id: 'starter_fertilizer', name: 'Starter Fertilizer', price: 30 }],
    },
    sporeConfig: SPORES,
    send: (_ws, type, payload) => sent.push({ type, payload }),
    log: { info: () => {} },
  };
  const player: ShopPlayer = {
    ws: {} as WebSocket,
    playerId: 'p1',
    inventory: createInventory(itemsSlots),
    spores: 100,
  };
  return { ports, player, sent };
}

describe('shop purchase', () => {
  it('spends the configured price and puts the item in the pouch', () => {
    const { ports, player, sent } = make();
    assert.equal(purchaseShopItem(ports, player, 'starter_fertilizer'), true);
    assert.equal(player.spores, 70);
    assert.equal(player.inventory.slots[0]?.itemId, 'starter_fertilizer');
    const sync = sent.at(-1);
    assert.ok(sync);
    assert.equal(sync.type, MESSAGE_TYPE.INVENTORY_SYNC);
    assert.equal((sync.payload as { sporeBalance: number }).sporeBalance, 70);
    assert.equal((sync.payload as { slots: unknown[] }).slots.length, 4);
  });

  it('refuses when the balance is short, and grants nothing', () => {
    const { ports, player, sent } = make();
    player.spores = 20;
    assert.equal(purchaseShopItem(ports, player, 'starter_fertilizer'), false);
    assert.equal(player.spores, 20);
    assert.equal(player.inventory.slots[0], null);
    const rejection = sent.at(-1);
    assert.ok(rejection);
    assert.equal(rejection.type, MESSAGE_TYPE.REJECT);
    assert.equal((rejection.payload as { reason: string }).reason, 'insufficient_spores');
  });

  it('refuses an item that is not in the catalogue', () => {
    const { ports, player } = make();
    assert.equal(purchaseShopItem(ports, player, 'golden_apple'), false);
    assert.equal(player.spores, 100);
  });

  it('refuses when the pouch is full rather than charging for nothing', () => {
    const { ports, player } = make(1);
    player.inventory.slots[0] = { itemId: 'starter_fertilizer', count: 10 };
    assert.equal(purchaseShopItem(ports, player, 'starter_fertilizer'), false);
    assert.equal(player.spores, 100);
    assert.equal((player.inventory.slots[0] as { count: number }).count, 10);
  });
});
