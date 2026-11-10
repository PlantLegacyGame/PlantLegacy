export interface NetProtoConfig {
  protocolVersion: number;
  maxMessageSizeBytes: number;
  tickRateHz: number;
  positionQuantization: number;
  angleQuantizationBits: number;
  keyframeIntervalTicks: number;
  maxVelocityUnitsPerTick: number;
  worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  clientSendRateHz: number;
  helloTimeoutMs: number;
}

import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger, readNumber, readObject } from '@plant-legacy/shared/config';
import type { Layer, NodeStatModifiers, NodeType } from '@plant-legacy/shared/growth';

export function loadNetProtoConfig(configs: Map<string, ConfigFile>): NetProtoConfig {
  const rawWorldBounds = readObject<{
    min_x: number;
    max_x: number;
    min_z: number;
    max_z: number;
  }>(configs, 'net_proto', 'world_bounds');

  return {
    protocolVersion: readInteger(configs, 'net_proto', 'protocol_version'),
    maxMessageSizeBytes: readInteger(configs, 'net_proto', 'max_message_size_bytes'),
    tickRateHz: readInteger(configs, 'net_proto', 'tick_rate_hz'),
    positionQuantization: readInteger(configs, 'net_proto', 'position_quantization'),
    angleQuantizationBits: readInteger(configs, 'net_proto', 'angle_quantization_bits'),
    keyframeIntervalTicks: readInteger(configs, 'net_proto', 'keyframe_interval_ticks'),
    maxVelocityUnitsPerTick: readNumber(configs, 'net_proto', 'max_velocity_units_per_tick'),
    worldBounds: {
      minX: rawWorldBounds.min_x,
      maxX: rawWorldBounds.max_x,
      minZ: rawWorldBounds.min_z,
      maxZ: rawWorldBounds.max_z,
    },
    clientSendRateHz: readInteger(configs, 'net_proto', 'client_send_rate_hz'),
    helloTimeoutMs: readInteger(configs, 'net_proto', 'hello_timeout_ms'),
  };
}

export const MESSAGE_TYPE = {
  // Client -> Server
  HELLO: 1,
  INPUT: 2,
  PING: 3,
  GROWTH_INTENT: 4,
  RESOURCE_QUERY: 5,
  PLANT_SYNC_REQUEST: 6,
  GROWTH_OPTIONS_REQUEST: 7,

  // Server -> Client
  WELCOME: 10,
  STATE: 11,
  KEYFRAME: 12,
  REJECT: 13,
  PONG: 14,
  ERROR: 15,
  GROWTH_EVENT: 16,
  RESOURCE_UPDATE: 17,
  PLANT_SYNC: 18,
  PLANT_CREATED: 19,
  PLANT_REMOVED: 20,
  WEATHER_UPDATE: 21,
  GROWTH_OPTIONS_RESULT: 22,

  // Dev commands (client -> server, server -> client)
  DEV_RESPONSE: 99,
} as const;

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
}

export interface WelcomePayload {
  playerId: string;
  plantId: string;
  tick: number;
  rootNode: { id: string; x: number; y: number; z: number; type: string; biomass: number };
  totalBiomass: number;
  totalEnergy: number;
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
}

export interface GrowthEventPayload {
  plantId: string;
  /** Normal single-node growth. */
  newNode?: GrowthEventNode;
  /** Multi-node germination (radicle + cotyledons). */
  newNodes?: GrowthEventNode[];
  /** Replaced node (germination: the seed becomes the root). */
  updatedParentNode?: GrowthEventNode;
  damageDealt?: number;
  totalBiomass?: number;
  totalEnergy?: number;
}

export interface PlantSyncPayload {
  plants: Array<{
    id: string;
    ownerId: string;
    rootNodeId: string | null;
    totalBiomass: number;
    totalEnergy: number;
    totalUpkeep: number;
    nodes: Array<{
      id: string;
      plantId: string;
      type: NodeType;
      layer: Layer;
      x: number;
      y: number;
      z: number;
      biomass: number;
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
    nodes: Array<{
      id: string;
      plantId: string;
      type: NodeType;
      layer: Layer;
      x: number;
      y: number;
      z: number;
      biomass: number;
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

export interface MovementValidationResult {
  valid: boolean;
  newX?: number;
  newZ?: number;
  newRotation?: number;
  reason?: string;
}

export function validateMovement(
  input: PlayerInput,
  config: NetProtoConfig,
  _currentTick: number,
): MovementValidationResult {
  // Camera pan validation - camera is independent entity (DESIGN.md Rule 1)
  // Check velocity bounds
  const maxVelocity = config.maxVelocityUnitsPerTick;
  let moveX = 0;
  let moveZ = 0;
  if (input.moveForward) moveZ -= 1;
  if (input.moveBackward) moveZ += 1;
  if (input.moveLeft) moveX -= 1;
  if (input.moveRight) moveX += 1;
  const velocity = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (velocity > maxVelocity) {
    return { valid: false, reason: 'exceeds_max_velocity' };
  }
  // World bounds check - camera can move freely within world bounds
  // The actual position is managed client-side; server just validates velocity
  return { valid: true };
}
