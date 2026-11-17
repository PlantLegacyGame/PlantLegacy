import type { UprootCause, UprootPhase } from '@plant-legacy/shared/damage';
import type {
  Layer,
  NodeType,
  Plant,
  PlantMutation,
  PlantNode,
  PlantUprootState,
} from '@plant-legacy/shared/growth';
import type { Pool } from 'pg';
import type { SeasonSnapshot } from '../seasonClock.ts';

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
  /** T04 fields. Absent on a v1 snapshot, which restores as "no mutations". */
  mutations?: PlantMutation[];
  mutationPressure?: Record<string, number>;
  mutationShedCooldownUntil?: number;
  mutationSignature?: number;
  /** T06 uproot state. Absent means rooted (v3+ only). */
  uproot?: PlantUprootState;
}

export interface PlantEvent {
  type: 'growth' | 'damage' | 'uproot' | 'reroot' | 'upkeep' | 'tier_change' | 'removal';
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
  trunk: 11,
  rhizome: 12,
  culm: 13,
  floating_leaf: 14,
  pneumatophore: 15,
  thorn: 16,
  stolon: 17,
  tuber: 18,
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
  'trunk',
  'rhizome',
  'culm',
  'floating_leaf',
  'pneumatophore',
  'thorn',
  'stolon',
  'tuber',
];
const BYTE_TO_LAYER: Layer[] = ['root', 'canopy'];

const UPROOT_PHASE_TO_BYTE: Record<UprootPhase, number> = {
  rooted: 0,
  uprooted: 1,
  tumbling: 2,
  rerooting: 3,
};
const BYTE_TO_UPROOT_PHASE: UprootPhase[] = ['rooted', 'uprooted', 'tumbling', 'rerooting'];
const UPROOT_CAUSE_TO_BYTE: Record<UprootCause, number> = {
  saturation: 0,
  gust: 1,
  collapse: 2,
  structural_damage: 3,
};
const BYTE_TO_UPROOT_CAUSE: UprootCause[] = ['saturation', 'gust', 'collapse', 'structural_damage'];

const MAGIC = 0x504c4e54; // 'PLNT' in little-endian
/** v3 adds the T06 uproot block. v1/v2 snapshots still load. */
const VERSION = 4;
const MIN_SUPPORTED_VERSION = 1;
const PRESSURE_CATEGORIES = [
  'root',
  'stem',
  'leaf',
  'flower',
  'spore_sac',
  'vine',
  'defense',
  'storage',
] as const;

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

  // T04 mutation block. Written after every pre-existing field so the v1 layout
  // stays readable by the same reader. v4 appends each mutation's level and the
  // cards chosen on the way up, inside the same loop.
  const mutations = plant.mutations ?? [];
  payload.writeUint8(Math.min(255, mutations.length));
  for (const mutation of mutations.slice(0, 255)) {
    payload.writeString(mutation.id);
    payload.writeBigInt64(BigInt(mutation.acquiredTick));
    payload.writeString(mutation.nodeId ?? '');
    const level = Math.max(1, Math.min(255, Math.round(mutation.level ?? 1)));
    payload.writeUint8(level);
    const cards = (mutation.cards ?? []).slice(0, 255);
    payload.writeUint8(cards.length);
    for (const card of cards) payload.writeString(card);
  }
  for (const category of PRESSURE_CATEGORIES) {
    payload.writeFloat64(plant.mutationPressure?.[category] ?? 0);
  }
  payload.writeBigInt64(BigInt(plant.mutationShedCooldownUntil ?? 0));
  payload.writeUint8(Math.max(0, Math.min(255, plant.mutationSignature ?? 0)));

  // T06 uproot block. A rooted plant writes one byte and nothing else, so the
  // common case stays as small as the previous version.
  const uproot = plant.uproot;
  const uprooted = uproot !== undefined && uproot.phase !== 'rooted';
  payload.writeUint8(uprooted ? 1 : 0);
  if (uprooted) {
    payload.writeUint8(UPROOT_PHASE_TO_BYTE[uproot.phase]);
    payload.writeUint8(UPROOT_CAUSE_TO_BYTE[uproot.cause ?? 'structural_damage']);
    payload.writeBigInt64(BigInt(uproot.sinceTick));
    payload.writeFloat64(uproot.damageHp);
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
  if (offset + 2 > view.byteLength) {
    throw new Error('Snapshot truncated while reading a string length');
  }
  const length = view.getUint16(offset, true);
  offset += 2;
  if (offset + length > view.byteLength) {
    throw new Error(
      `Snapshot string length ${length} runs past the payload (${view.byteLength - offset} bytes left)`,
    );
  }
  const decoder = new TextDecoder();
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const str = decoder.decode(bytes);
  return { str, offset: offset + length };
}

function validateEnvelope(data: Uint8Array): {
  payloadOffset: number;
  payloadLength: number;
  version: number;
} {
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
  if (version < MIN_SUPPORTED_VERSION || version > VERSION) {
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
  return { payloadOffset, payloadLength, version };
}

export function deserializePlant(data: Uint8Array): PlantSnapshot {
  const { payloadOffset, payloadLength, version } = validateEnvelope(data);
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

  const mutations: PlantMutation[] = [];
  let mutationPressure: Record<string, number> | undefined;
  let mutationShedCooldownUntil: number | undefined;
  let mutationSignature: number | undefined;

  if (version >= 2) {
    const mutationCount = view.getUint8(offset);
    offset += 1;
    for (let i = 0; i < mutationCount; i++) {
      const { str: mutationId, offset: m1 } = readString(view, offset);
      offset = m1;
      const acquiredTick = Number(view.getBigInt64(offset, true));
      offset += 8;
      const { str: nodeId, offset: m2 } = readString(view, offset);
      offset = m2;
      // v4 stores the level and the cards that got it there; a v2/v3 save has
      // neither, which loads as level 1 with no cards.
      let level = 1;
      const cards: string[] = [];
      if (version >= 4) {
        level = view.getUint8(offset);
        offset += 1;
        const cardCount = view.getUint8(offset);
        offset += 1;
        for (let c = 0; c < cardCount; c++) {
          const { str: cardId, offset: m3 } = readString(view, offset);
          offset = m3;
          cards.push(cardId);
        }
      }
      mutations.push({ id: mutationId, acquiredTick, nodeId: nodeId || null, level, cards });
    }
    const pressure: Record<string, number> = {};
    for (const category of PRESSURE_CATEGORIES) {
      pressure[category] = view.getFloat64(offset, true);
      offset += 8;
    }
    mutationPressure = pressure;
    mutationShedCooldownUntil = Number(view.getBigInt64(offset, true));
    offset += 8;
    mutationSignature = view.getUint8(offset);
    offset += 1;
  }

  let uproot: PlantUprootState | undefined;
  if (version >= 3) {
    const present = view.getUint8(offset);
    offset += 1;
    if (present) {
      const phase = BYTE_TO_UPROOT_PHASE[view.getUint8(offset)] ?? 'uprooted';
      offset += 1;
      const cause = BYTE_TO_UPROOT_CAUSE[view.getUint8(offset)] ?? 'structural_damage';
      offset += 1;
      const sinceTick = Number(view.getBigInt64(offset, true));
      offset += 8;
      const damageHp = view.getFloat64(offset, true);
      offset += 8;
      // A saved node set already carries the visible pose. Adopt it as the base
      // pose and start a settled body, rather than replaying a tumble that had
      // already finished when the world stopped.
      const basePose = new Map<string, { x: number; y: number; z: number }>();
      const baseAttach = new Map<string, { x: number; y: number; z: number }>();
      for (const node of nodes.values()) {
        basePose.set(node.id, { x: node.x, y: node.y, z: node.z });
        if (node.parentAttachX !== undefined && node.parentAttachZ !== undefined) {
          baseAttach.set(node.id, {
            x: node.parentAttachX,
            y: node.parentAttachY ?? node.y,
            z: node.parentAttachZ,
          });
        }
      }
      uproot = {
        phase: phase === 'rooted' ? 'uprooted' : phase === 'tumbling' ? 'uprooted' : phase,
        cause,
        sinceTick,
        damageHp,
        saturatedSeconds: 0,
        settledSeconds: 0,
        tiltRad: 0,
        headingRad: 0,
        rollRad: 0,
        rollSpeedRad: 0,
        offsetX: 0,
        offsetY: 0,
        offsetZ: 0,
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        crawlX: 0,
        crawlZ: 0,
        tumbleSeconds: 0,
        tumbleSettled: true,
        basePose,
        baseAttach,
      };
    }
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
    mutations,
    mutationPressure,
    mutationShedCooldownUntil,
    mutationSignature,
    uproot,
  };
}

export class PlantPersistence {
  private pool: Pool;
  private worldId: string;
  private onLoadError: ((error: unknown) => void) | undefined;
  /** Pending save per plant id, so two writers cannot race on one row. */
  private saveChains = new Map<string, Promise<void>>();

  constructor(pool: Pool, worldId: string, onLoadError?: (error: unknown) => void) {
    this.pool = pool;
    this.worldId = worldId;
    this.onLoadError = onLoadError;
  }

  /**
   * Persist one plant, after any save already queued for it.
   *
   * Three callers can ask at the same moment - the periodic flush, a
   * disconnect and the shutdown save - and each used to open its own
   * transaction, so the older snapshot could commit last and win. Saves for one
   * plant are chained instead: the next waits for the previous to commit.
   * Different plants still write in parallel. The map holds one settled promise
   * per plant, which is as bounded as the world's plant count.
   */
  async savePlant(plant: Plant, eventLog: PlantEvent[] = []): Promise<void> {
    const key = plant.id;
    const previous = this.saveChains.get(key) ?? Promise.resolve();
    // A failed save must not cancel the next attempt, so the chain swallows the
    // rejection while the caller still receives it from its own promise.
    const next = previous.catch(() => {}).then(() => this.writePlant(plant, eventLog));
    this.saveChains.set(key, next);
    return next;
  }

  private async writePlant(plant: Plant, eventLog: PlantEvent[]): Promise<void> {
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
    // Deserialise per row: one corrupted or truncated snapshot used to throw out
    // of `.map()` and take every other plant down with it, so the world refused
    // to boot until someone edited the database by hand.
    const snapshots: PlantSnapshot[] = [];
    for (const row of result.rows) {
      try {
        snapshots.push(deserializePlant(row.snapshot));
      } catch (error) {
        this.onLoadError?.(error);
      }
    }
    return snapshots;
  }

  /**
   * Boot path: snapshots plus the event log each one was saved with.
   *
   * A row whose snapshot cannot be read is skipped whole; a row whose event log
   * is malformed still yields its plant, with an empty history, because the log
   * is audit data and must never cost the player their plant.
   */
  async loadAllPlantsWithEvents(): Promise<
    Array<{ snapshot: PlantSnapshot; events: PlantEvent[] }>
  > {
    const result = await this.pool.query(
      'SELECT snapshot, event_log FROM world_plants WHERE world_id = $1',
      [this.worldId],
    );
    const loaded: Array<{ snapshot: PlantSnapshot; events: PlantEvent[] }> = [];
    for (const row of result.rows) {
      try {
        const snapshot = deserializePlant(row.snapshot);
        let events: PlantEvent[] = [];
        try {
          const raw: unknown = row.event_log;
          const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
          if (Array.isArray(parsed)) events = parsed as PlantEvent[];
        } catch (error) {
          this.onLoadError?.(error);
        }
        loaded.push({ snapshot, events });
      } catch (error) {
        this.onLoadError?.(error);
      }
    }
    return loaded;
  }

  /** Append one global event (deaths, calamities) to `world_events`. */
  async saveWorldEvent(
    type: string,
    tick: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO world_events (world_id, type, payload, tick) VALUES ($1, $2, $3, $4)',
      [this.worldId, type, JSON.stringify(payload), tick],
    );
  }

  /**
   * Save the season calendar. One row per world: the season is world state, so
   * a replant after a calamity must not reset it.
   */
  async saveSeasonState(state: SeasonSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO world_state (world_id, season, season_remaining_ticks, last_calamity_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (world_id) DO UPDATE SET
         season = EXCLUDED.season,
         season_remaining_ticks = EXCLUDED.season_remaining_ticks,
         last_calamity_at = EXCLUDED.last_calamity_at,
         updated_at = NOW()`,
      [
        this.worldId,
        state.season,
        state.remainingTicks,
        state.lastCalamityAt === null ? null : new Date(state.lastCalamityAt),
      ],
    );
  }

  async loadSeasonState(): Promise<SeasonSnapshot | null> {
    const result = await this.pool.query(
      'SELECT season, season_remaining_ticks, last_calamity_at FROM world_state WHERE world_id = $1',
      [this.worldId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as {
      season: number | string;
      season_remaining_ticks: string | number;
      last_calamity_at: Date | string | null;
    };
    const season = Number(row.season);
    const remainingTicks = Number(row.season_remaining_ticks);
    const lastCalamityAt = row.last_calamity_at ? new Date(row.last_calamity_at).getTime() : null;
    return {
      season: Number.isFinite(season) ? season : 1,
      remainingTicks: Number.isFinite(remainingTicks) ? remainingTicks : 0,
      lastCalamityAt:
        lastCalamityAt !== null && Number.isFinite(lastCalamityAt) ? lastCalamityAt : null,
    };
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
  /** D01: Dev action - clear all persistence data */
  async clearAll(): Promise<void> {
    await this.pool.query('DELETE FROM world_plants WHERE world_id = $1', [this.worldId]);
    // The calendar is part of "all persistence" too; leaving it behind would
    // keep a season number whose plants no longer exist.
    await this.pool.query('DELETE FROM world_state WHERE world_id = $1', [this.worldId]);
  }
}
