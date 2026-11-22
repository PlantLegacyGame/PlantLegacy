/**
 * The shop, as the server sees it: a catalogue with prices, and one purchase
 * path.
 *
 * The panel used to be the whole thing. It listed six items priced in biomass,
 * every Buy button was disabled because no caller passed `onBuy`, and even a
 * wired button would have had no balance to check - the purse did not exist. The
 * price is now the server's own number, read from `config/shop.json` (the same
 * file the client draws from), and a purchase is checked and granted here.
 */
import type { ConfigFile } from '@plant-legacy/shared/config';
import { readArray, readBoolean, readString } from '@plant-legacy/shared/config';
import type { WebSocket } from 'ws';
import { addItem, type Inventory } from './inventory.ts';
import { sendInventorySync } from './inventoryHandlers.ts';
import type { ItemsConfig } from './items.ts';
import { MESSAGE_TYPE } from './net.ts';
import { type SporeConfig, spendSpores } from './spores.ts';

export interface ShopEntry {
  id: string;
  name: string;
  price: number;
}

export interface ShopConfig {
  enabled: boolean;
  currencyName: string;
  items: ShopEntry[];
}

interface RawSection {
  items?: Array<{ id?: string; name?: string; price?: number }>;
}

export function loadShopConfig(configs: Map<string, ConfigFile>): ShopConfig {
  const sections = readArray<RawSection[]>(configs, 'shop', 'shop_sections');
  const items: ShopEntry[] = [];
  for (const section of sections) {
    for (const item of section.items ?? []) {
      if (!item.id || typeof item.price !== 'number') continue;
      items.push({ id: item.id, name: item.name ?? item.id, price: item.price });
    }
  }
  return {
    enabled: readBoolean(configs, 'shop', 'shop_enabled'),
    currencyName: readString(configs, 'shop', 'shop_currency_name'),
    items,
  };
}

/** The player fields a purchase touches. */
export interface ShopPlayer {
  ws: WebSocket;
  playerId: string;
  inventory: Inventory;
  spores: number;
}

export interface ShopPorts {
  itemsConfig: ItemsConfig;
  shopConfig: ShopConfig;
  sporeConfig: SporeConfig;
  send(ws: WebSocket, type: number, payload: unknown): void;
  log: { info(message: string, meta?: Record<string, unknown>): void };
  /** Write the restart copy after a purchase or a payout. */
  persist?: (player: ShopPlayer) => void;
}

/**
 * Validate and apply a purchase to an inventory.
 *
 * Pure in the sense that it touches nothing but the inventory and the balance
 * it is given, so the same check can run against a live player or against the
 * state read inside a `player_state` row lock. On success the item is already
 * in `inventory`; on refusal nothing changed.
 */
export type ShopPurchasePlan =
  | { ok: true; spores: number; inventory: Inventory }
  | { ok: false; reason: string };

export function planShopPurchase(
  ports: Pick<ShopPorts, 'itemsConfig' | 'shopConfig' | 'sporeConfig'>,
  inventory: Inventory,
  spores: number,
  itemId: string,
): ShopPurchasePlan {
  if (!ports.shopConfig.enabled) return { ok: false, reason: 'shop_closed' };
  const entry = ports.shopConfig.items.find((item) => item.id === itemId);
  if (!entry) return { ok: false, reason: 'unknown_item' };

  const definition = ports.itemsConfig.itemDefinitions.get(entry.id);
  if (!definition) return { ok: false, reason: 'unknown_item' };

  const nextBalance = spendSpores(spores, entry.price, ports.sporeConfig.maxBalance);
  if (nextBalance === null) return { ok: false, reason: 'insufficient_spores' };

  const added = addItem(inventory, entry.id, 1, ports.itemsConfig.itemDefinitions);
  if (added <= 0) return { ok: false, reason: 'inventory_full' };

  return { ok: true, spores: nextBalance, inventory };
}

/**
 * Buy one item with spores.
 *
 * Refusals are explicit (`REJECT` with a machine reason the client can put in a
 * sentence) rather than a silent no-op: a Buy button that does nothing is the
 * bug this replaces. The grant goes through `addItem`, so the item lands in the
 * pouch the inventory panel and hotbar already read, and the reply is a full
 * `INVENTORY_SYNC` carrying both the new balance and the new slots.
 */
export function purchaseShopItem(ports: ShopPorts, player: ShopPlayer, itemId: string): boolean {
  const reject = (reason: string): false => {
    ports.send(player.ws, MESSAGE_TYPE.REJECT, {
      reason,
      originalType: MESSAGE_TYPE.SHOP_PURCHASE,
    });
    return false;
  };

  const plan = planShopPurchase(ports, player.inventory, player.spores, itemId);
  if (!plan.ok) return reject(plan.reason);

  player.spores = plan.spores;
  const entry = ports.shopConfig.items.find((item) => item.id === itemId);
  sendInventorySync({ itemsConfig: ports.itemsConfig, send: ports.send }, player);
  ports.persist?.(player);
  ports.log.info('Shop purchase', {
    playerId: player.playerId,
    itemId,
    price: entry?.price ?? 0,
    balance: player.spores,
  });
  return true;
}
