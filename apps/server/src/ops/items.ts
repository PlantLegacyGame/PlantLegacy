import type { ConfigFile } from '@plant-legacy/shared/config';
import type { ItemCategory, ItemDefinition, ItemUse } from '@plant-legacy/shared/schemas';

export interface ItemEffects {
  fertilizerMineralsGain: number;
  dungWaterGain: number;
  dungMineralsGain: number;
  essenceEnergyGain: number;
}

export interface ItemsConfig {
  itemDefinitions: Map<string, ItemDefinition>;
  startingInventory: Array<{ itemId: string; count: number }>;
  inventorySlots: number;
  effects: ItemEffects;
}

export function loadItemsConfig(configs: Map<string, ConfigFile>): ItemsConfig {
  const file = configs.get('items');
  if (!file) {
    return {
      itemDefinitions: new Map(),
      startingInventory: [],
      inventorySlots: 10,
      effects: {
        fertilizerMineralsGain: 0,
        dungWaterGain: 0,
        dungMineralsGain: 0,
        essenceEnergyGain: 0,
      },
    };
  }

  const values = file.values || {};

  const effects: ItemEffects = {
    fertilizerMineralsGain: (values.fertilizer_minerals_gain?.value as number) ?? 0,
    dungWaterGain: (values.dung_water_gain?.value as number) ?? 0,
    dungMineralsGain: (values.dung_minerals_gain?.value as number) ?? 0,
    essenceEnergyGain: (values.essence_energy_gain?.value as number) ?? 0,
  };

  const itemDefsArray =
    (values.item_definitions?.value as Array<{
      id: string;
      category: string;
      name: string;
      description: string;
      use_kind: string;
      use_reason: string;
      stack_limit: number;
      tradeable: boolean;
      mailable: boolean;
      listable: boolean;
      account_bound: boolean;
    }>) || [];

  const itemDefinitions = new Map<string, ItemDefinition>();
  for (const def of itemDefsArray) {
    // RULE_23: an account-bound item cannot be traded, mailed or listed. Fail at
    // load instead of enforcing it in one movement path and forgetting another.
    if (def.account_bound && (def.tradeable || def.mailable || def.listable)) {
      throw new Error(
        `items.json: account-bound item "${def.id}" must not be tradeable, mailable or listable`,
      );
    }
    if (!Number.isInteger(def.stack_limit) || def.stack_limit < 1) {
      throw new Error(`items.json: item "${def.id}" has an invalid stack_limit`);
    }
    if (typeof def.name !== 'string' || def.name.trim() === '') {
      throw new Error(`items.json: item "${def.id}" has no display name`);
    }
    if (typeof def.description !== 'string' || def.description.trim() === '') {
      throw new Error(`items.json: item "${def.id}" has no description`);
    }
    itemDefinitions.set(def.id, {
      id: def.id,
      category: def.category as ItemCategory,
      stack_limit: def.stack_limit,
      name: def.name,
      description: def.description,
      use: resolveItemUse(
        def.id,
        def.category as ItemCategory,
        def.use_kind,
        def.use_reason,
        effects,
      ),
      tradeable: def.tradeable,
      mailable: def.mailable,
      listable: def.listable,
      account_bound: def.account_bound,
    });
  }

  const startingInventory =
    (values.starting_inventory?.value as
      | Array<{ item_id: string; count: number }>
      | Array<{ itemId: string; count: number }>) || [];
  const normalizedStartingInventory = startingInventory.map((item) => ({
    itemId: 'itemId' in item ? item.itemId : item.item_id,
    count: item.count,
  }));
  const inventorySlots = (values.inventory_slots?.value as number) ?? 10;

  return {
    itemDefinitions,
    startingInventory: normalizedStartingInventory,
    inventorySlots,
    effects,
  };
}

/** Categories this server can actually consume. Anything else is unavailable. */
const RESOURCE_CATEGORIES = new Set<ItemCategory>(['fertilizer', 'dung', 'essence']);

/**
 * Turn a config declaration into the use the server will perform.
 *
 * The point is to fail at boot rather than at the click: an item that claims a
 * resource effect for a category nothing handles, or that claims to be
 * unavailable when a handler exists, would otherwise be a button that lies.
 */
export function resolveItemUse(
  id: string,
  category: ItemCategory,
  useKind: string | undefined,
  useReason: string | undefined,
  effects: ItemEffects,
): ItemUse {
  const implemented = RESOURCE_CATEGORIES.has(category);
  if (useKind === 'resources') {
    if (!implemented) {
      throw new Error(
        `items.json: item "${id}" declares use_kind resources, but category "${category}" has no server handler`,
      );
    }
    if (category === 'fertilizer') {
      return { kind: 'resources', water: 0, minerals: effects.fertilizerMineralsGain, energy: 0 };
    }
    if (category === 'dung') {
      return {
        kind: 'resources',
        water: effects.dungWaterGain,
        minerals: effects.dungMineralsGain,
        energy: 0,
      };
    }
    return { kind: 'resources', water: 0, minerals: 0, energy: effects.essenceEnergyGain };
  }
  if (useKind === 'unavailable') {
    if (implemented) {
      throw new Error(
        `items.json: item "${id}" is marked unavailable, but category "${category}" is implemented`,
      );
    }
    const reason = (useReason ?? '').trim();
    if (reason === '') {
      throw new Error(`items.json: item "${id}" is unavailable but gives no reason`);
    }
    return { kind: 'unavailable', reason };
  }
  throw new Error(`items.json: item "${id}" must declare use_kind "resources" or "unavailable"`);
}
