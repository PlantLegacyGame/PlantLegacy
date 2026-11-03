import type { Layer, NodeType, Plant, PlantNode } from '@plant-legacy/shared/growth';
import type { Pool } from 'pg';

export interface PlantSnapshot {
  id: string;
  worldId: string;
  ownerId: string;
  nodes: Map<string, PlantNode>;
  rootNodeId: string | null;
  totalBiomass: number;
  totalUpkeep: number;
  lastGrowthTick: number;
  growthCooldownUntil: number;
  tier: 'active' | 'near' | 'dormant';
  lastTick: number;
}

export interface PlantEvent {
  type: 'growth' | 'damage' | 'upkeep' | 'tier_change' | 'removal';
  tick: number;
  data: Record<string, unknown>;
}

const NODE_TYPE_TO_BYTE: Record<NodeType, number> = {
  root: 0,
  stem: 1,
  leaf: 2,
  flower: 3,
  spore_sac: 4,
  vine: 5,
};

const LAYER_TO_BYTE: Record<Layer, number> = {
  root: 0,
  canopy: 1,
};

const BYTE_TO_NODE_TYPE: NodeType[] = ['root', 'stem', 'leaf', 'flower', 'spore_sac', 'vine'];
const BYTE_TO_LAYER: Layer[] = ['root', 'canopy'];

function writeString(view: DataView, offset: number, str: string): number {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  view.setUint16(offset, bytes.length, true);
  offset += 2;
  for (let i = 0; i < bytes.length; i++) {
    view.setUint8(offset + i, bytes[i]);
  }
  return offset + bytes.length;
}

function readString(view: DataView, offset: number): { str: string; offset: number } {
  const length = view.getUint16(offset, true);
  offset += 2;
  const decoder = new TextDecoder();
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const str = decoder.decode(bytes);
  return { str, offset: offset + length };
}

export function serializePlant(plant: Plant): Uint8Array {
  const nodeCount = plant.nodes.size;
  const nodeDataSize = nodeCount * (32 + 2 + 1 + 1 + 8 + 8 + 4 + 4 + 4 + 4 + 1 + 2);
  const estimatedSize = 1024 + nodeDataSize;
  const buffer = new ArrayBuffer(estimatedSize);
  const view = new DataView(buffer);
  let offset = 0;

  offset = writeString(view, offset, plant.id);
  offset = writeString(view, offset, plant.worldId);
  offset = writeString(view, offset, plant.ownerId);

  offset = writeString(view, offset, plant.rootNodeId ?? '');

  view.setFloat64(offset, plant.totalBiomass, true);
  offset += 8;
  view.setFloat64(offset, plant.totalUpkeep, true);
  offset += 8;
  view.setBigInt64(offset, BigInt(plant.lastGrowthTick), true);
  offset += 8;
  view.setBigInt64(offset, BigInt(plant.growthCooldownUntil), true);
  offset += 8;

  const tierByte = plant.tier === 'active' ? 0 : plant.tier === 'near' ? 1 : 2;
  view.setUint8(offset, tierByte);
  offset += 1;

  view.setBigInt64(offset, BigInt(plant.lastTick ?? 0), true);
  offset += 8;

  view.setUint16(offset, nodeCount, true);
  offset += 2;

  for (const node of plant.nodes.values()) {
    offset = writeString(view, offset, node.id);
    offset = writeString(view, offset, node.plantId);
    view.setUint8(offset, NODE_TYPE_TO_BYTE[node.type]);
    offset += 1;
    view.setUint8(offset, LAYER_TO_BYTE[node.layer]);
    offset += 1;
    view.setFloat64(offset, node.x, true);
    offset += 8;
    view.setFloat64(offset, node.y, true);
    offset += 8;
    view.setFloat64(offset, node.z, true);
    offset += 8;
    view.setFloat64(offset, node.biomass, true);
    offset += 8;
    view.setBigInt64(offset, BigInt(node.age), true);
    offset += 8;
    offset = writeString(view, offset, node.parentId ?? '');
    view.setUint16(offset, node.children.length, true);
    offset += 2;
    for (const childId of node.children) {
      offset = writeString(view, offset, childId);
    }
    view.setFloat64(offset, node.resourceDrawWater, true);
    offset += 8;
    view.setFloat64(offset, node.resourceDrawNutrients, true);
    offset += 8;
    view.setFloat64(offset, node.upkeepBiomassPerSecond, true);
    offset += 8;
    view.setUint8(
      offset,
      node.growthDirectionBias === 'downward'
        ? 0
        : node.growthDirectionBias === 'upward'
          ? 1
          : node.growthDirectionBias === 'outward'
            ? 2
            : 3,
    );
    offset += 1;
    view.setBigInt64(offset, BigInt(node.lastGrowthTick), true);
    offset += 8;
  }

  return new Uint8Array(buffer.slice(0, offset));
}

export function deserializePlant(data: Uint8Array): PlantSnapshot {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const { str: id, offset: o1 } = readString(view, offset);
  offset = o1;
  const { str: worldId, offset: o2 } = readString(view, offset);
  offset = o2;
  const { str: ownerId, offset: o3 } = readString(view, offset);
  offset = o3;
  const { str: rootNodeId, offset: o4 } = readString(view, offset);
  offset = o4;

  const totalBiomass = view.getFloat64(offset, true);
  offset += 8;
  const totalUpkeep = view.getFloat64(offset, true);
  offset += 8;
  const lastGrowthTick = Number(view.getBigInt64(offset, true));
  offset += 8;
  const growthCooldownUntil = Number(view.getBigInt64(offset, true));
  offset += 8;

  const tierByte = view.getUint8(offset);
  offset += 1;
  const tier = tierByte === 0 ? 'active' : tierByte === 1 ? 'near' : 'dormant';

  const lastTick = Number(view.getBigInt64(offset, true));
  offset += 8;

  const nodeCount = view.getUint16(offset, true);
  offset += 2;

  const nodes = new Map<string, PlantNode>();

  for (let i = 0; i < nodeCount; i++) {
    const { str: nodeId, offset: o5 } = readString(view, offset);
    offset = o5;
    const { str: plantId, offset: o6 } = readString(view, offset);
    offset = o6;
    const typeByte = view.getUint8(offset);
    offset += 1;
    const layerByte = view.getUint8(offset);
    offset += 1;
    const x = view.getFloat64(offset, true);
    offset += 8;
    const y = view.getFloat64(offset, true);
    offset += 8;
    const z = view.getFloat64(offset, true);
    offset += 8;
    const biomass = view.getFloat64(offset, true);
    offset += 8;
    const age = Number(view.getBigInt64(offset, true));
    offset += 8;
    const { str: parentId, offset: o7 } = readString(view, offset);
    offset = o7;
    const childCount = view.getUint16(offset, true);
    offset += 2;
    const children: string[] = [];
    for (let j = 0; j < childCount; j++) {
      const { str: childId, offset: o8 } = readString(view, offset);
      offset = o8;
      children.push(childId);
    }
    const resourceDrawWater = view.getFloat64(offset, true);
    offset += 8;
    const resourceDrawNutrients = view.getFloat64(offset, true);
    offset += 8;
    const upkeepBiomassPerSecond = view.getFloat64(offset, true);
    offset += 8;
    const biasByte = view.getUint8(offset);
    offset += 1;
    const growthDirectionBias =
      biasByte === 0
        ? 'downward'
        : biasByte === 1
          ? 'upward'
          : biasByte === 2
            ? 'outward'
            : 'horizontal';
    const lastGrowthTick = Number(view.getBigInt64(offset, true));
    offset += 8;

    const node: PlantNode = {
      id: nodeId,
      plantId,
      type: BYTE_TO_NODE_TYPE[typeByte],
      layer: BYTE_TO_LAYER[layerByte],
      x,
      y,
      z,
      biomass,
      age,
      parentId: parentId || null,
      children,
      statModifiers: {},
      resourceDrawWater,
      resourceDrawNutrients,
      upkeepBiomassPerSecond,
      growthDirectionBias,
      lastGrowthTick,
    };
    nodes.set(nodeId, node);
  }

  return {
    id,
    worldId,
    ownerId,
    nodes,
    rootNodeId: rootNodeId || null,
    totalBiomass,
    totalUpkeep,
    lastGrowthTick,
    growthCooldownUntil,
    tier,
    lastTick,
  };
}

export class PlantPersistence {
  private pool: Pool;
  private worldId: string;

  constructor(pool: Pool, worldId: string) {
    this.pool = pool;
    this.worldId = worldId;
  }

  async savePlant(plant: Plant): Promise<void> {
    const snapshot = serializePlant(plant);
    const eventLog = '[]';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO world_plants (id, world_id, owner_id, snapshot, event_log, root_node_id, total_biomass, total_upkeep, node_count, max_nodes, last_growth_tick, growth_cooldown_until, tier, last_tick)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           snapshot = EXCLUDED.snapshot,
           event_log = EXCLUDED.event_log,
           root_node_id = EXCLUDED.root_node_id,
           total_biomass = EXCLUDED.total_biomass,
           total_upkeep = EXCLUDED.total_upkeep,
           node_count = EXCLUDED.node_count,
           max_nodes = EXCLUDED.max_nodes,
           last_growth_tick = EXCLUDED.last_growth_tick,
           growth_cooldown_until = EXCLUDED.growth_cooldown_until,
           tier = EXCLUDED.tier,
           last_tick = EXCLUDED.last_tick,
           updated_at = NOW()`,
        [
          plant.id,
          this.worldId,
          plant.ownerId,
          snapshot,
          eventLog,
          plant.rootNodeId,
          plant.totalBiomass,
          plant.totalUpkeep,
          plant.nodes.size,
          plant.maxNodesPerPlant ?? 2000,
          plant.lastGrowthTick,
          plant.growthCooldownUntil,
          'dormant',
          plant.lastGrowthTick,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async loadPlant(plantId: string): Promise<PlantSnapshot | null> {
    const result = await this.pool.query(
      'SELECT snapshot FROM world_plants WHERE id = $1 AND world_id = $2',
      [plantId, this.worldId],
    );
    if (result.rows.length === 0) return null;
    return deserializePlant(result.rows[0].snapshot);
  }

  async loadPlantsByOwner(ownerId: string): Promise<PlantSnapshot[]> {
    const result = await this.pool.query(
      'SELECT snapshot FROM world_plants WHERE owner_id = $1 AND world_id = $2',
      [ownerId, this.worldId],
    );
    return result.rows.map((row) => deserializePlant(row.snapshot));
  }

  async loadAllPlants(): Promise<PlantSnapshot[]> {
    const result = await this.pool.query('SELECT snapshot FROM world_plants WHERE world_id = $1', [
      this.worldId,
    ]);
    return result.rows.map((row) => deserializePlant(row.snapshot));
  }

  async deletePlant(plantId: string): Promise<void> {
    await this.pool.query('DELETE FROM world_plants WHERE id = $1 AND world_id = $2', [
      plantId,
      this.worldId,
    ]);
  }

  async getPlantCount(): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*) FROM world_plants WHERE world_id = $1', [
      this.worldId,
    ]);
    return parseInt(result.rows[0].count, 10);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
