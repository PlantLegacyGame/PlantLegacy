import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger, readNumber, readObject } from '@plant-legacy/shared/config';
import type { GrowthConfig, NodeTypeDefinition } from '@plant-legacy/shared/growth';

export function loadGrowthConfig(configs: Map<string, ConfigFile>): GrowthConfig {
  return {
    rootGrowthSpeed: readNumber(configs, 'growth', 'root_growth_speed'),
    canopyGrowthSpeed: readNumber(configs, 'growth', 'canopy_growth_speed'),
    nodeCostBase: readInteger(configs, 'growth', 'node_cost_base'),
    maxNodesPerPlant: readInteger(configs, 'growth', 'max_nodes_per_plant'),
    growthCooldown: readNumber(configs, 'growth', 'growth_cooldown'),
    rootOverlapPressureDamage: readNumber(configs, 'growth', 'root_overlap_pressure_damage'),
    lightBlockingPerNode: readInteger(configs, 'growth', 'light_blocking_per_node'),
    rootNode: readObject<NodeTypeDefinition>(configs, 'growth', 'root_node'),
    stemNode: readObject<NodeTypeDefinition>(configs, 'growth', 'stem_node'),
    leafNode: readObject<NodeTypeDefinition>(configs, 'growth', 'leaf_node'),
    flowerNode: readObject<NodeTypeDefinition>(configs, 'growth', 'flower_node'),
    sporeSacNode: readObject<NodeTypeDefinition>(configs, 'growth', 'spore_sac_node'),
    vineNode: readObject<NodeTypeDefinition>(configs, 'growth', 'vine_node'),
    growthIntentCooldown: readNumber(configs, 'growth', 'growth_intent_cooldown'),
    rootAttackDamageMultiplier: readNumber(configs, 'growth', 'root_attack_damage_multiplier'),
  };
}
