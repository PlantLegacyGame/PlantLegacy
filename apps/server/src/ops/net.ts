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
}

import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger, readNumber, readObject } from '@plant-legacy/shared/config';

export function loadNetProtoConfig(configs: Map<string, ConfigFile>): NetProtoConfig {
  return {
    protocolVersion: readInteger(configs, 'net_proto', 'protocol_version'),
    maxMessageSizeBytes: readInteger(configs, 'net_proto', 'max_message_size_bytes'),
    tickRateHz: readInteger(configs, 'net_proto', 'tick_rate_hz'),
    positionQuantization: readInteger(configs, 'net_proto', 'position_quantization'),
    angleQuantizationBits: readInteger(configs, 'net_proto', 'angle_quantization_bits'),
    keyframeIntervalTicks: readInteger(configs, 'net_proto', 'keyframe_interval_ticks'),
    maxVelocityUnitsPerTick: readNumber(configs, 'net_proto', 'max_velocity_units_per_tick'),
    worldBounds: readObject<{
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    }>(configs, 'net_proto', 'world_bounds'),
    clientSendRateHz: readInteger(configs, 'net_proto', 'client_send_rate_hz'),
  };
}

export const MESSAGE_TYPE = {
  // Client -> Server
  HELLO: 1,
  INPUT: 2,
  PING: 3,

  // Server -> Client
  WELCOME: 10,
  STATE: 11,
  KEYFRAME: 12,
  REJECT: 13,
  PONG: 14,
  ERROR: 15,
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
  tick: number;
  cubes: CubeState[];
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
  const speed = 5.0; // units per second
  const maxVelocity = config.maxVelocityUnitsPerTick;
  const rotationSpeed = Math.PI; // radians per second

  let newX = cube.x;
  let newZ = cube.z;
  let newRotation = cube.rotation;

  // Calculate movement vector
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

  // Move in facing direction
  const moveX = Math.sin(newRotation) * speed * dt;
  const moveZ = Math.cos(newRotation) * speed * dt;

  newX += dx * moveX + dz * moveX;
  newZ += dx * moveZ + dz * moveZ;

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
