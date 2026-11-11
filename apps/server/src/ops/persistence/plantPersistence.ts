import type { Layer, NodeType, Plant, PlantNode } from '@plant-legacy/shared/growth';
import type { Pool } from 'pg';

export interface PlantSnapshot {
  id: string;
  worldId: string;
  ownerId: string;
  nodes: Map<string, PlantNode>;
  rootNodeId: string | null;
  totalBiomass: number;
  totalEnergy: number;
  totalUpkeep: number;
  storedWater: number;
  storedMinerals: number;
  lastGrowthTick: number;
  growthCooldownUntil: number;
  tier: 'active' | 'near' | 'dormant';
  lastTick: number;
  growthSeq: number;
}

export interface PlantEvent {
  type: 'growth' | 'damage' | 'upkeep' | 'tier_change' | 'removal';
  tick: number;
  data: Record<string, unknown>;
}

const NODE_TYPE_TO_BYTE: Record<NodeType, number> = {
  seed: 0,
  radicle: 1,
  root: 2,
  lateral_root: 3,
  stem: 4,
  branch: 5,
  leaf: 6,
  cotyledon: 7,
  flower: 8,
  spore_sac: 9,
  vine: 10,
};

const LAYER_TO_BYTE: Record<Layer, number> = {
  root: 0,
  canopy: 1,
};

const BYTE_TO_NODE_TYPE: NodeType[] = [
  'seed',
  'radicle',
  'root',
  'lateral_root',
  'stem',
  'branch',
  'leaf',
  'cotyledon',
  'flower',
  'spore_sac',
  'vine',
];
const BYTE_TO_LAYER: Layer[] = ['root', 'canopy'];

const MAGIC = 0x504c4e54; // 'PLNT' in little-endian
const VERSION = 1;

class GrowableBuffer {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number;

  constructor(initialSize = 4096) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  get byteLength(): number {
    return this.offset;
  }

  get internalBuffer(): ArrayBuffer {
    return this.buffer;
  }

  private ensureCapacity(additional: number): void {
    const required = this.offset + additional;
    if (required <= this.buffer.byteLength) return;
    let newSize = this.buffer.byteLength * 2;
    while (newSize < required) newSize *= 2;
    const newBuffer = new ArrayBuffer(newSize);
    new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer);
  }

  writeString(str: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.ensureCapacity(2 + bytes.length);
    this.view.setUint16(this.offset, bytes.length, true);
    this.offset += 2;
    new Uint8Array(this.buffer).set(bytes, this.offset);
    this.offset += bytes.length;
  }

  writeUint8(value: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  writeUint16(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  writeUint32(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  writeFloat64(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  writeFloat32(value: number): void {
    this.ensureCapacity(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  writeBigInt64(value: bigint): void {
    this.ensureCapacity(8);
    this.view.setBigInt64(this.offset, value, true);
    this.offset += 8;
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.offset);
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    new Uint8Array(this.buffer).set(bytes, this.offset);
    this.offset += bytes.length;
  }

  getDataView(): DataView {
    return new DataView(this.buffer, 0, this.offset);
  }
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = CRC32_TABLE;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function serializePlant(plant: Plant): Uint8Array {
  const payload = new GrowableBuffer();

  payload.writeString(plant.id);
  payload.writeString(plant.worldId);
  payload.writeString(plant.ownerId);

  payload.writeString(plant.rootNodeId ?? '');

  payload.writeFloat64(plant.totalBiomass);
  payload.writeFloat64(plant.totalEnergy);
  payload.writeFloat64(plant.totalUpkeep);
  payload.writeFloat64(plant.storedWater);
  payload.writeFloat64(plant.storedMinerals);
  payload.writeBigInt64(BigInt(plant.lastGrowthTick));
  payload.writeBigInt64(BigInt(plant.growthCooldownUntil));

  const tierByte = plant.tier === 'active' ? 0 : plant.tier === 'near' ? 1 : 2;
  payload.writeUint8(tierByte);

  payload.writeBigInt64(BigInt(plant.lastTick ?? 0));

  payload.writeBigInt64(BigInt(plant.growthSeq ?? 0));

  const nodeCount = plant.nodes.size;
  payload.writeUint32(nodeCount);

  for (const node of plant.nodes.values()) {
    payload.writeString(node.id);
    payload.writeString(node.plantId);
    payload.writeUint8(NODE_TYPE_TO_BYTE[node.type]);
    payload.writeUint8(LAYER_TO_BYTE[node.layer]);
    payload.writeFloat64(node.x);
    payload.writeFloat64(node.y);
    payload.writeFloat64(node.z);
    payload.writeFloat64(node.biomass);
    payload.writeFloat64(node.age);
    payload.writeString(node.parentId ?? '');
    payload.writeUint32(node.children.length);
    for (const childId of node.children) {
      payload.writeString(childId);
    }
    payload.writeFloat64(node.resourceDrawWater);
    payload.writeFloat64(node.resourceDrawNutrients);
    payload.writeFloat64(node.upkeepBiomassPerSecond);
    const biasByte =
      node.growthDirectionBias === 'downward'
        ? 0
        : node.growthDirectionBias === 'upward'
          ? 1
          : node.growthDirectionBias === 'outward'
            ? 2
            : 3;
    payload.writeUint8(biasByte);
    payload.writeBigInt64(BigInt(node.lastGrowthTick));
    payload.writeFloat32(node.growthProgress ?? 1.0);
    payload.writeUint8(node.isSeed ? 1 : 0);
  }

  const payloadBytes = payload.toUint8Array();
  const crc = crc32(payloadBytes);

  const envelope = new GrowableBuffer(16 + payloadBytes.length + 4);
  envelope.writeUint32(MAGIC);
  envelope.writeUint16(VERSION);
  envelope.writeUint32(payloadBytes.length);
  envelope.writeUint32(crc);
  envelope.writeBytes(payloadBytes);

  return envelope.toUint8Array();
}

function readString(view: DataView, offset: number): { str: string; offset: number } {
  const length = view.getUint16(offset, true);
  offset += 2;
  const decoder = new TextDecoder();
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const str = decoder.decode(bytes);
  return { str, offset: offset + length };
}

function validateEnvelope(data: Uint8Array): { payloadOffset: number; payloadLength: number } {
  if (data.length < 14) {
    throw new Error('Snapshot too short for envelope');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(
      `Invalid snapshot magic: 0x${magic.toString(16)} (expected 0x${MAGIC.toString(16)})`,
    );
  }
  const version = view.getUint16(4, true);
  if (version !== VERSION) {
    throw new Error(`Unsupported snapshot version: ${version} (current is ${VERSION})`);
  }
  const payloadLength = view.getUint32(6, true);
  const crc = view.getUint32(10, true);
  const payloadOffset = 14;
  if (data.length < payloadOffset + payloadLength) {
    throw new Error(
      `Snapshot truncated: expected ${payloadOffset + payloadLength} bytes, got ${data.length}`,
    );
  }
  const payloadBytes = new Uint8Array(data.buffer, data.byteOffset + payloadOffset, payloadLength);
  const actualCrc = crc32(payloadBytes);
  if (actualCrc !== crc) {
    throw new Error(
      `CRC32 mismatch: expected 0x${crc.toString(16)}, got 0x${actualCrc.toString(16)}`,
    );
  }
  return { payloadOffset, payloadLength };
}

export function deserializePlant(data: Uint8Array): PlantSnapshot {
  const { payloadOffset, payloadLength } = validateEnvelope(data);
  const view = new DataView(data.buffer, data.byteOffset + payloadOffset, payloadLength);
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
  const totalEnergy = view.getFloat64(offset, true);
  offset += 8;
  const totalUpkeep = view.getFloat64(offset, true);
  offset += 8;
  const storedWater = view.getFloat64(offset, true);
  offset += 8;
  const storedMinerals = view.getFloat64(offset, true);
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

  const growthSeq = Number(view.getBigInt64(offset, true));
  offset += 8;

  const nodeCount = view.getUint32(offset, true);
  offset += 4;

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
    const age = view.getFloat64(offset, true);
    offset += 8;
    const { str: parentId, offset: o7 } = readString(view, offset);
    offset = o7;
    const childCount = view.getUint32(offset, true);
    offset += 4;
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
    const growthProgress = view.getFloat32(offset, true);
    offset += 4;
    const isSeed = view.getUint8(offset) === 1;
    offset += 1;

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
      resourceDrawMinerals: 0,
      upkeepBiomassPerSecond,
      growthDirectionBias,
      lastGrowthTick,
      growthProgress,
      isSeed,
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
    totalEnergy,
    totalUpkeep,
    storedWater,
    storedMinerals,
    lastGrowthTick,
    growthCooldownUntil,
    tier,
    lastTick,
    growthSeq,
  };
}

export class PlantPersistence {
  private pool: Pool;
  private worldId: string;

  constructor(pool: Pool, worldId: string) {
    this.pool = pool;
    this.worldId = worldId;
  }

  async savePlant(plant: Plant, eventLog: PlantEvent[] = []): Promise<void> {
    const snapshot = serializePlant(plant);
    const eventLogJson = JSON.stringify(eventLog);

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
          eventLogJson,
          plant.rootNodeId,
          plant.totalBiomass,
          plant.totalUpkeep,
          plant.nodes.size,
          plant.maxNodesPerPlant ?? 2000,
          plant.lastGrowthTick,
          plant.growthCooldownUntil,
          plant.tier ?? 'dormant',
          plant.lastTick ?? plant.lastGrowthTick,
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

  async loadPlantWithEvents(
    plantId: string,
  ): Promise<{ snapshot: PlantSnapshot; events: PlantEvent[] } | null> {
    const result = await this.pool.query(
      'SELECT snapshot, event_log FROM world_plants WHERE id = $1 AND world_id = $2',
      [plantId, this.worldId],
    );
    if (result.rows.length === 0) return null;
    return {
      snapshot: deserializePlant(result.rows[0].snapshot),
      events: JSON.parse(result.rows[0].event_log ?? '[]'),
    };
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

  /** D01: Dev action - save all plants */
  async saveAll(): Promise<void> {
    // This would need access to all plants from PlantWorld
    // For now, this is a placeholder - the periodic save in main.ts handles this
  }

  /** D01: Dev action - clear all persistence data */
  async clearAll(): Promise<void> {
    await this.pool.query('DELETE FROM world_plants WHERE world_id = $1', [this.worldId]);
  }
}
