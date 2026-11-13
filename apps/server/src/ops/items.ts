import type { ConfigFile } from '@plant-legacy/shared/config';
import type { ItemDefinition } from '@plant-legacy/shared/schemas';

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

  const itemDefsArray =
    (values.item_definitions?.value as Array<{
      id: string;
      category: string;
      name: string;
      description: string;
      stack_limit: number;
      tradeable: boolean;
      mailable: boolean;
      listable: boolean;
      account_bound: boolean;
    }>) || [];

  const itemDefinitions = new Map<string, ItemDefinition>();
  for (const def of itemDefsArray) {
    itemDefinitions.set(def.id, {
      id: def.id,
      category: def.category as ItemDefinition['category'],
      stack_limit: def.stack_limit,
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

  const effects: ItemEffects = {
    fertilizerMineralsGain: (values.fertilizer_minerals_gain?.value as number) ?? 0,
    dungWaterGain: (values.dung_water_gain?.value as number) ?? 0,
    dungMineralsGain: (values.dung_minerals_gain?.value as number) ?? 0,
    essenceEnergyGain: (values.essence_energy_gain?.value as number) ?? 0,
  };

  return {
    itemDefinitions,
    startingInventory: normalizedStartingInventory,
    inventorySlots,
    effects,
  };
}
