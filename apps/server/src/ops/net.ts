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
  moveSpeed: number;
}

import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger, readNumber, readObject } from '@plant-legacy/shared/config';

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
    moveSpeed: readNumber(configs, 'net_proto', 'move_speed'),
  };
}

export const MESSAGE_TYPE = {
  // Client -> Server
  HELLO: 1,
  INPUT: 2,
  PING: 3,
  GROWTH_INTENT: 4,

  // Server -> Client
  WELCOME: 10,
  STATE: 11,
  KEYFRAME: 12,
  REJECT: 13,
  PONG: 14,
  ERROR: 15,
  GROWTH_EVENT: 16,
} as const;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

export interface CubeState {
  id: string;
  x: number;
  z: number;
  rotation: number;
  color: number;
  lastInputTick: number;
}

export interface PlayerInput {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  tick: number;
}

export interface HelloPayload {
  clientVersion: number;
}

export interface WelcomePayload {
  playerId: string;
  cubeId: string;
  plantId: string;
  tick: number;
  cubes: CubeState[];
  rootNode: { id: string; x: number; y: number; z: number; type: string; biomass: number };
  totalBiomass: number;
}

export interface InputPayload {
  input: PlayerInput;
}

export interface StatePayload {
  tick: number;
  cubes: CubeState[];
}

export interface KeyframePayload {
  tick: number;
  cubes: CubeState[];
}

export interface RejectPayload {
  reason: string;
  originalType: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
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

export function validateMovement(
  cube: CubeState,
  input: PlayerInput,
  config: NetProtoConfig,
  _tick: number,
): { valid: boolean; newX: number; newZ: number; newRotation: number; reason?: string } {
  const dt = 1 / config.tickRateHz;
  const speed = config.moveSpeed;
  const maxVelocity = config.maxVelocityUnitsPerTick;
  const rotationSpeed = Math.PI; // radians per second

  let newX = cube.x;
  let newZ = cube.z;
  let newRotation = cube.rotation;

  // Calculate movement vector in local space
  let dx = 0;
  let dz = 0;

  if (input.moveForward) dz -= 1;
  if (input.moveBackward) dz += 1;
  if (input.moveLeft) dx -= 1;
  if (input.moveRight) dx += 1;

  // Normalize diagonal movement
  if (dx !== 0 && dz !== 0) {
    const len = Math.sqrt(dx * dx + dz * dz);
    dx /= len;
    dz /= len;
  }

  // Apply rotation if moving
  if (dx !== 0 || dz !== 0) {
    const targetRotation = Math.atan2(dx, dz);
    const rotationDiff = targetRotation - newRotation;
    // Normalize to [-PI, PI]
    const normalizedDiff = ((rotationDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
    const maxRotationChange = rotationSpeed * dt;
    newRotation += clamp(normalizedDiff, -maxRotationChange, maxRotationChange);
  }

  // Move: forward/backward along facing, left/right strafe perpendicular
  const facingX = Math.sin(newRotation);
  const facingZ = Math.cos(newRotation);
  const strafeX = facingZ; // 90 deg right: (cos, -sin)
  const strafeZ = -facingX;

  const forwardDist = -dz * speed * dt; // dz = -1 for forward
  const strafeDist = dx * speed * dt; // dx = 1 for right

  newX += facingX * forwardDist + strafeX * strafeDist;
  newZ += facingZ * forwardDist + strafeZ * strafeDist;

  // Check velocity limit
  const actualDx = newX - cube.x;
  const actualDz = newZ - cube.z;
  const actualVelocity = Math.sqrt(actualDx * actualDx + actualDz * actualDz);

  if (actualVelocity > maxVelocity) {
    return {
      valid: false,
      newX: cube.x,
      newZ: cube.z,
      newRotation: cube.rotation,
      reason: `velocity_exceeded: ${actualVelocity.toFixed(3)} > ${maxVelocity}`,
    };
  }

  // Check world bounds
  if (
    newX < config.worldBounds.minX ||
    newX > config.worldBounds.maxX ||
    newZ < config.worldBounds.minZ ||
    newZ > config.worldBounds.maxZ
  ) {
    return {
      valid: false,
      newX: cube.x,
      newZ: cube.z,
      newRotation: cube.rotation,
      reason: 'out_of_bounds',
    };
  }

  // Quantize
  newX = quantizePosition(newX, config.positionQuantization);
  newZ = quantizePosition(newZ, config.positionQuantization);
  newRotation = quantizeAngle(newRotation, config.angleQuantizationBits);

  return { valid: true, newX, newZ, newRotation };
}

export function createCube(id: string, color: number): CubeState {
  return {
    id,
    x: 0,
    z: 0,
    rotation: 0,
    color,
    lastInputTick: 0,
  };
}
