export interface NetProtoConfig {
  protocolVersion: number;
  maxMessageSizeBytes: number;
  /** Unsent-socket backlog above which tick broadcasts are skipped. */
  maxBufferedBytes: number;
  /** Sustained inbound messages allowed per connection per second. */
  maxMessagesPerSecond: number;
  /** Short inbound burst a connection may spend before the sustained rate applies. */
  messageBurst: number;
  tickRateHz: number;
  positionQuantization: number;
  angleQuantizationBits: number;
  keyframeIntervalTicks: number;
  worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  clientSendRateHz: number;
  /** Broadcast cadence for weather/day-night, independent of the tick rate. */
  weatherSendRateHz: number;
  helloTimeoutMs: number;
  reconnectWindowMs: number;
}

import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger, readObject } from '@plant-legacy/shared/config';
import type { Layer, NodeStatModifiers, NodeType, PlantNode } from '@plant-legacy/shared/growth';

// One table for the wire, owned by the shared package. This module re-exports it
// so existing server call sites keep importing from here.
export { MESSAGE_TYPE } from '@plant-legacy/shared/protocol';

import { type MESSAGE_TYPE, PROTOCOL_VERSION } from '@plant-legacy/shared/protocol';

export function loadNetProtoConfig(configs: Map<string, ConfigFile>): NetProtoConfig {
  const rawWorldBounds = readObject<{
    min_x: number;
    max_x: number;
    min_z: number;
    max_z: number;
  }>(configs, 'net_proto', 'world_bounds');

  // One protocol version, in code. `protocol_version` stays in the config so
  // docs/tasks and the config validator keep describing it, but the two used to
  // be independent: editing only the JSON changed the server's handshake while
  // the client kept the constant, and everyone got a version mismatch. The boot
  // check makes the config agree with the code instead of overriding it.
  const configuredProtocolVersion = readInteger(configs, 'net_proto', 'protocol_version');
  if (configuredProtocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      `net_proto.json: protocol_version ${configuredProtocolVersion} must equal PROTOCOL_VERSION ${PROTOCOL_VERSION}; bump both together in @plant-legacy/shared/protocol`,
    );
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    maxMessageSizeBytes: readInteger(configs, 'net_proto', 'max_message_size_bytes'),
    maxBufferedBytes: readInteger(configs, 'net_proto', 'max_buffered_bytes'),
    maxMessagesPerSecond: readInteger(configs, 'net_proto', 'max_messages_per_second'),
    messageBurst: readInteger(configs, 'net_proto', 'message_burst'),
    tickRateHz: readInteger(configs, 'net_proto', 'tick_rate_hz'),
    positionQuantization: readInteger(configs, 'net_proto', 'position_quantization'),
    angleQuantizationBits: readInteger(configs, 'net_proto', 'angle_quantization_bits'),
    keyframeIntervalTicks: readInteger(configs, 'net_proto', 'keyframe_interval_ticks'),
    worldBounds: {
      minX: rawWorldBounds.min_x,
      maxX: rawWorldBounds.max_x,
      minZ: rawWorldBounds.min_z,
      maxZ: rawWorldBounds.max_z,
    },
    clientSendRateHz: readInteger(configs, 'net_proto', 'client_send_rate_hz'),
    weatherSendRateHz: readInteger(configs, 'net_proto', 'weather_send_rate_hz'),
    helloTimeoutMs: readInteger(configs, 'net_proto', 'hello_timeout_ms'),
    reconnectWindowMs: readInteger(configs, 'net_proto', 'reconnect_window_ms'),
  };
}

// The message table itself lives in `@plant-legacy/shared/protocol` (imported and
// re-exported at the top of this file). Two copies of the wire numbers is how
// REPORT once shared WELCOME's number 10 and every report was silently dropped.
export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

export interface PlayerInput {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  tick: number;
}

export interface HelloPayload {
  clientVersion: number;
  accessToken?: string;
  plantId?: string;
  reconnectToken?: string;
  /** Display name from the menu; sanitized and length-capped before use. */
  displayName?: string;
}

export interface SeasonUpdatePayload {
  season: number;
  /** Whole seconds left before the calamity, as of the sending tick. */
  remainingSeconds: number;
  lengthTicks: number;
  /** True only on the update that announces a rollover. */
  calamity: boolean;
}

export interface MutationStatePayload {
  plantId: string;
  mutations: Array<{
    id: string;
    name: string;
    kind: string;
    visualSignature: number;
    energyPerSecond: number;
    biomassPerSecond: number;
    level: number;
    maxLevel: number;
    levelCostEnergy: number;
    levelCostBiomass: number;
    levelBlocked?: string;
  }>;
  totalUpkeepEnergyPerSecond: number;
  /** Plant-wide look parameters (petal count, leaf and seed scale). */
  appearance: { petalCount: number; leafScale: number; seedScale: number };
  /** Adaptive pressure per growth category; the readout, never a rule. */
  pressure: Record<string, number>;
  /** Strongest visual signature held (0 = none). */
  signature: number;
  shedCooldownRemainingS: number;
  /**
   * Cards laid out for a pending level-up. Null unless the player asked, so the
   * panel only shows a deal that came from the server.
   */
  levelOffer: {
    mutationId: string;
    level: number;
    cards: Array<{ id: string; label: string; step: number }>;
  } | null;
}

export interface MutationShedPayload {
  plantId: string;
  mutationId: string;
}

/**
 * Level a mutation: no `cardId` deals the cards, a `cardId` takes one of them.
 */
export interface MutationLevelPayload {
  plantId: string;
  mutationId: string;
  cardId?: string;
}

export interface RerootIntentPayload {
  /** World XZ direction the player is steering the crawl. Normalised server-side. */
  dirX: number;
  dirZ: number;
}

export interface PlantDamagePayload {
  plantId: string;
  nodeId: string | null;
  destroyedNodeIds: string[];
  source: 'weather' | 'tool' | 'herbivore' | 'terrain';
  amount: number;
  totalBiomass: number;
}

export interface PlantUprootPayload {
  plantId: string;
  phase: 'rooted' | 'uprooted' | 'tumbling' | 'rerooting';
  cause?: 'saturation' | 'gust' | 'collapse' | 'structural_damage';
  x: number;
  y: number;
  z: number;
  tiltRad: number;
  headingRad: number;
  /** Seconds left to reach soil before settling is refused. */
  windowRemainingS: number;
  /** Node positions after the rigid uproot transform, for immediate redraw. */
  nodes?: Array<{ id: string; x: number; y: number; z: number }>;
}

export interface DropSpawnPayload {
  id: string;
  kind: 'fragment' | 'remains' | 'dung';
  x: number;
  y: number;
  z: number;
  sourcePlantId: string | null;
  expiresAtMs: number;
}

export interface FaunaEventPayload {
  phase: 'start' | 'end';
  x: number;
  z: number;
  radiusM: number;
}

export interface KillCreditPayload {
  plantId: string;
  credit: {
    kind: 'player' | 'plant' | 'none';
    playerId: string | null;
    plantId: string | null;
    amount: number;
  };
}

export interface WelcomePayload {
  playerId: string;
  plantId: string;
  /** Secret that authorises reclaiming this plant after a disconnect. */
  reconnectToken: string;
  tick: number;
  rootNode: { id: string; x: number; y: number; z: number; type: string; biomass: number };
  totalBiomass: number;
  totalEnergy: number;
  /**
   * What changed while the player was away, filled on a reconnect or reclaim.
   * Deltas are after-minus-before over the time the plant spent offline.
   */
  away?: {
    seconds: number;
    nodesBefore: number;
    nodesAfter: number;
    biomass: number;
    energy: number;
    water: number;
    minerals: number;
  };
  /**
   * Set when this player's previous plant died while they were away and the
   * server has just handed them a replacement seed.
   */
  previousPlantDied?: { cause: string; source?: string; secondsAgo: number };
  // Full node set for immediate client render (ADR-021)
  nodes?: Array<{
    id: string;
    plantId: string;
    type: NodeType;
    layer: Layer;
    x: number;
    y: number;
    z: number;
    biomass: number;
    /** 0..1 tissue health against this part's own quota. */
    health?: number;
    age: number;
    parentId: string | null;
    children: string[];
    statModifiers: NodeStatModifiers;
    resourceDrawWater: number;
    resourceDrawNutrients: number;
    upkeepBiomassPerSecond: number;
    growthDirectionBias: string;
    lastGrowthTick: number;
    growthProgress: number;
    isSeed: boolean;
    /** T04: signature index this node draws (0 = none). */
    mutationFlags?: number;
    // Server-authoritative target position for connected growth rendering
    targetX?: number;
    targetY?: number;
    targetZ?: number;
    // Server-authoritative parent attachment position for client sync
    parentAttachX?: number;
    parentAttachY?: number;
    parentAttachZ?: number;
    /** Where along the parent's segment this node leaves it (1 = its end). */
    attachFraction?: number;
  }>;
}

export interface InputPayload {
  input: PlayerInput;
}

export interface StatePayload {
  tick: number;
  plants: Array<{ id: string; totalBiomass: number; totalEnergy: number; totalUpkeep: number }>;
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  tileSize: number;
}

export interface KeyframePayload {
  tick: number;
  plants: Array<{ id: string; totalBiomass: number; totalUpkeep: number }>;
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  tileSize: number;
}

export interface ReportPayload {
  targetPlayerId: string;
  targetPlayerName?: string;
  reason: string;
  freeText?: string;
  block?: boolean;
  contextSnapshot?: Array<{ playerName: string; message: string; timestamp: number }>;
  timestamp: number;
}

export interface RejectPayload {
  reason: string;
  originalType: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface ResourceUpdatePayload {
  tick: number;
  tiles: Array<{
    tileX?: number;
    tileZ?: number;
    light: number;
    moisture: number;
    minerals: number;
  }>;
  width: number;
  height: number;
  tileSize: number;
  // ADR-019: Include plant energy/biomass for photosynthesis feedback
  totalEnergy?: number;
  totalBiomass?: number;
}

export interface ResourceQueryPayload {
  tileX?: number;
  tileZ?: number;
  worldX?: number;
  worldZ?: number;
}

export interface GrowthOptionsRequestPayload {
  plantId?: string;
  nodeId?: string;
}

export interface GrowthOptionsResponsePayload {
  nodeId: string;
  result?: unknown;
  error?: string;
}

export interface GrowthEventNode {
  id: string;
  plantId: string;
  type: NodeType;
  layer: Layer;
  x: number;
  y: number;
  z: number;
  biomass: number;
  /** 0..1 tissue health against this part's own quota. */
  health?: number;
  age: number;
  parentId: string | null;
  children: string[];
  statModifiers: NodeStatModifiers;
  resourceDrawWater: number;
  resourceDrawNutrients: number;
  upkeepBiomassPerSecond: number;
  growthDirectionBias: string;
  lastGrowthTick: number;
  growthProgress?: number;
  isSeed?: boolean;
  /** T04: signature index this node draws (0 = none). */
  mutationFlags?: number;
  // Server-authoritative growth timing for client sync
  growthTimeSeconds?: number;
  growthStartTick?: number;
  // Parent attachment position for client sync (Fix 3)
  parentAttachX?: number;
  parentAttachY?: number;
  parentAttachZ?: number;
}

export interface GrowthEventPayload {
  plantId: string;
  /** Normal single-node growth. */
  newNode?: GrowthEventNode;
  /** Multi-node germination (radicle + cotyledons). */
  newNodes?: GrowthEventNode[];
  /** Replaced node (germination: the seed becomes the root). */
  updatedParentNode?: GrowthEventNode;
  totalBiomass?: number;
  totalEnergy?: number;
}

export interface PlantSyncPayload {
  plants: Array<{
    id: string;
    ownerId: string;
    /**
     * The owner's display name, when the owner is here to have one.
     *
     * Remote clients used to draw `ownerId.slice(0, 6)`, which is a random
     * prefix for a guest and an opaque id for an account: nothing a player can
     * read. An offline plant's row does not carry a name, so the field stays
     * optional and the client falls back to the id.
     */
    ownerName?: string;
    rootNodeId: string | null;
    totalBiomass: number;
    totalEnergy: number;
    totalUpkeep: number;
    /** T04 look parameters, so a rival draws its own petals and scales. */
    appearance?: { petalCount: number; leafScale: number; seedScale: number };
    /** Dominant mutation's pigment, so a rival draws its own colours. */
    pigment?: {
      visualSignature: number;
      visualParams: [number, number, number];
      visualTarget: 'foliage' | 'woody' | 'seed' | 'bloom' | 'whole' | 'bark';
    };
    nodes: Array<{
      id: string;
      plantId: string;
      type: NodeType;
      layer: Layer;
      x: number;
      y: number;
      z: number;
      biomass: number;
      /** 0..1 tissue health against this part's own quota. */
      health?: number;
      age: number;
      parentId: string | null;
      children: string[];
      statModifiers: NodeStatModifiers;
      resourceDrawWater: number;
      resourceDrawNutrients: number;
      upkeepBiomassPerSecond: number;
      growthDirectionBias: string;
      lastGrowthTick: number;
      growthProgress?: number;
      isSeed?: boolean;
      mutationFlags?: number;
      // Server-authoritative growth timing for client sync
      growthTimeSeconds?: number;
      growthStartTick?: number;
    }>;
  }>;
}

export interface PlantCreatedPayload {
  plant: {
    id: string;
    ownerId: string;
    rootNodeId: string | null;
    totalBiomass: number;
    totalEnergy: number;
    totalUpkeep: number;
    /** T04 look parameters, so a rival draws its own petals and scales. */
    appearance?: { petalCount: number; leafScale: number; seedScale: number };
    /** Dominant mutation's pigment, so a rival draws its own colours. */
    pigment?: {
      visualSignature: number;
      visualParams: [number, number, number];
      visualTarget: 'foliage' | 'woody' | 'seed' | 'bloom' | 'whole' | 'bark';
    };
    nodes: Array<{
      id: string;
      plantId: string;
      type: NodeType;
      layer: Layer;
      x: number;
      y: number;
      z: number;
      biomass: number;
      /** 0..1 tissue health against this part's own quota. */
      health?: number;
      age: number;
      parentId: string | null;
      children: string[];
      statModifiers: NodeStatModifiers;
      resourceDrawWater: number;
      resourceDrawNutrients: number;
      upkeepBiomassPerSecond: number;
      growthDirectionBias: string;
      lastGrowthTick: number;
      growthProgress: number;
      isSeed: boolean;
      mutationFlags?: number;
      // Server-authoritative growth timing for client sync
      growthTimeSeconds?: number;
      growthStartTick?: number;
    }>;
  };
}

export interface PlantRemovedPayload {
  plantId: string;
}

export function quantizePosition(value: number, quantization: number): number {
  return Math.round(value * quantization) / quantization;
}

export function quantizeAngle(value: number, bits: number): number {
  const max = 2 ** bits;
  return (Math.round((value / (2 * Math.PI)) * max) / max) * (2 * Math.PI);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// `validateMovement` used to live here: it checked INPUT against a velocity
// limit and world bounds, and no message handler ever called it, because there
// is no server-side avatar to move (DESIGN Rule 1 - WASD pans the camera). Its
// tests therefore certified a rule the running game did not have. INPUT is an
// ack-only heartbeat; the server keeps `lastInputTick` and nothing else.

/**
 * The wire form of one plant node.
 *
 * Every payload that carries nodes - WELCOME, PLANT_SYNC, the growth event and
 * PLANT_CREATED - has to carry the same fields. It did not: PLANT_CREATED
 * shipped positions only, so every rival plant (and every body in the mutation
 * gallery) was drawn with guessed joints, and the attach fraction was missing
 * everywhere, so a lateral root or a branch could not be placed part-way down
 * its parent. One builder for all four means a field can no longer be
 * forgotten in one of them.
 */
export function nodeWireFields(node: PlantNode, health?: number) {
  return {
    id: node.id,
    plantId: node.plantId,
    type: node.type,
    layer: node.layer,
    x: node.x,
    y: node.y,
    z: node.z,
    biomass: node.biomass,
    health,
    age: node.age,
    parentId: node.parentId,
    children: node.children,
    statModifiers: node.statModifiers,
    resourceDrawWater: node.resourceDrawWater,
    resourceDrawNutrients: node.resourceDrawNutrients,
    upkeepBiomassPerSecond: node.upkeepBiomassPerSecond,
    growthDirectionBias: node.growthDirectionBias,
    lastGrowthTick: node.lastGrowthTick,
    growthProgress: node.growthProgress ?? 1,
    isSeed: node.isSeed ?? false,
    mutationFlags: node.mutationFlags ?? 0,
    radius: node.radius,
    // Where this part is drawn: the point it left its parent, the point it is
    // growing toward, and how far along its parent segment it leaves.
    parentAttachX: node.parentAttachX,
    parentAttachY: node.parentAttachY,
    parentAttachZ: node.parentAttachZ,
    attachFraction: node.attachFraction,
    targetX: node.targetX,
    targetY: node.targetY,
    targetZ: node.targetZ,
    growthTimeSeconds: node.growthTimeSeconds,
    growthStartTick: node.growthStartTick,
  };
}
