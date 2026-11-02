import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigFile } from '@plant-legacy/shared/config';
import { createCube, loadNetProtoConfig, validateMovement } from './net.ts';

function makeTestConfig(
  overrides: Partial<{
    tickRateHz: number;
    moveSpeed: number;
    maxVelocityUnitsPerTick: number;
    positionQuantization: number;
    angleQuantizationBits: number;
    worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  }> = {},
): ReturnType<typeof loadNetProtoConfig> {
  const configs = new Map<string, ConfigFile>();
  const baseConfig: ConfigFile = {
    _meta: {
      system: 'net_proto',
      version: '0.1.0',
      schema: 'extended-1',
      owner_task: 'T03P',
      status: 'draft',
    },
    values: {
      protocol_version: { type: 'integer', value: 1, range: [1, 255] },
      max_message_size_bytes: { type: 'integer', value: 16384, range: [1024, 1048576] },
      tick_rate_hz: { type: 'integer', value: overrides.tickRateHz ?? 20, range: [10, 60] },
      position_quantization: {
        type: 'integer',
        value: overrides.positionQuantization ?? 64,
        range: [16, 256],
      },
      angle_quantization_bits: {
        type: 'integer',
        value: overrides.angleQuantizationBits ?? 16,
        range: [8, 32],
      },
      keyframe_interval_ticks: { type: 'integer', value: 10, range: [1, 60] },
      max_velocity_units_per_tick: {
        type: 'number',
        value: overrides.maxVelocityUnitsPerTick ?? 0.5,
        range: [0.1, 10.0],
      },
      world_bounds: {
        type: 'object',
        value: {
          min_x: overrides.worldBounds?.minX ?? -1000,
          max_x: overrides.worldBounds?.maxX ?? 1000,
          min_z: overrides.worldBounds?.minZ ?? -1000,
          max_z: overrides.worldBounds?.maxZ ?? 1000,
        },
      },
      client_send_rate_hz: { type: 'integer', value: 20, range: [5, 60] },
      move_speed: { type: 'number', value: overrides.moveSpeed ?? 5.0, range: [0.1, 20.0] },
    },
  };
  configs.set('net_proto', baseConfig);
  return loadNetProtoConfig(configs);
}

describe('validateMovement', () => {
  it('returns valid for normal forward movement', () => {
    const config = makeTestConfig();
    const cube = createCube('test', 0xff0000);
    cube.rotation = Math.PI; // face negative Z (forward)
    const input = {
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, true);
    assert(result.newZ < 0); // moved forward (negative Z)
  });

  it('returns valid for backward movement', () => {
    const config = makeTestConfig();
    const cube = createCube('test', 0xff0000);
    cube.rotation = Math.PI; // face negative Z, backward = positive Z
    const input = {
      moveForward: false,
      moveBackward: true,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, true);
    assert(result.newZ > 0); // moved backward (positive Z)
  });

  it('returns valid for left/right strafing', () => {
    const config = makeTestConfig();
    const cube = createCube('test', 0xff0000);
    cube.rotation = 0; // face positive Z, strafe right = positive X
    const input = {
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: true,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, true);
    assert(result.newX > 0); // moved right (positive X)
  });

  it('rejects when exceeding world bounds (max_x)', () => {
    const config = makeTestConfig({
      worldBounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      moveSpeed: 50,
      maxVelocityUnitsPerTick: 10, // allow higher velocity so bounds check runs
    });
    const cube = createCube('test', 0xff0000);
    cube.x = 9.5;
    cube.rotation = 0; // face positive Z, strafe right = positive X
    const input = {
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: true,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'out_of_bounds');
    assert.equal(result.newX, 9.5); // position unchanged
  });

  it('rejects when exceeding world bounds (min_x)', () => {
    const config = makeTestConfig({
      worldBounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      moveSpeed: 50,
      maxVelocityUnitsPerTick: 10,
    });
    const cube = createCube('test', 0xff0000);
    cube.x = -9.5;
    cube.rotation = 0; // face positive Z, strafe left = negative X
    const input = {
      moveForward: false,
      moveBackward: false,
      moveLeft: true,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'out_of_bounds');
    assert.equal(result.newX, -9.5);
  });

  it('rejects when exceeding world bounds (max_z)', () => {
    const config = makeTestConfig({
      worldBounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      moveSpeed: 50,
      maxVelocityUnitsPerTick: 10,
    });
    const cube = createCube('test', 0xff0000);
    cube.z = 9.5;
    cube.rotation = Math.PI; // face negative Z, forward = negative Z, backward = positive Z
    const input = {
      moveForward: false,
      moveBackward: true,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'out_of_bounds');
    assert.equal(result.newZ, 9.5);
  });

  it('rejects when exceeding world bounds (min_z)', () => {
    const config = makeTestConfig({
      worldBounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      moveSpeed: 50,
      maxVelocityUnitsPerTick: 10,
    });
    const cube = createCube('test', 0xff0000);
    cube.z = -9.5;
    cube.rotation = Math.PI; // face negative Z (forward)
    const input = {
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'out_of_bounds');
    assert.equal(result.newZ, -9.5);
  });

  it('rejects when velocity exceeds maxVelocityUnitsPerTick', () => {
    // With moveSpeed=50, tickRateHz=20 -> dt=0.05 -> movement = 2.5 units/tick
    // maxVelocityUnitsPerTick=0.5, so this should reject
    const config = makeTestConfig({ moveSpeed: 50, maxVelocityUnitsPerTick: 0.5 });
    const cube = createCube('test', 0xff0000);
    const input = {
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, false);
    assert(result.reason?.startsWith('velocity_exceeded:'));
    assert.equal(result.newX, 0);
    assert.equal(result.newZ, 0);
  });

  it('quantizes position and rotation', () => {
    const config = makeTestConfig({ positionQuantization: 64, angleQuantizationBits: 16 });
    const cube = createCube('test', 0xff0000);
    const input = {
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, true);
    // Position should be quantized to 1/64 increments
    assert.equal(result.newX * 64, Math.round(result.newX * 64));
    assert.equal(result.newZ * 64, Math.round(result.newZ * 64));
    // Rotation should be quantized to 16-bit increments
    const maxAngle = 2 ** 16;
    assert.equal(
      (result.newRotation * maxAngle) / (2 * Math.PI),
      Math.round((result.newRotation * maxAngle) / (2 * Math.PI)),
    );
  });

  it('does not move when no input', () => {
    const config = makeTestConfig();
    const cube = createCube('test', 0xff0000);
    const input = {
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, true);
    assert.equal(result.newX, 0);
    assert.equal(result.newZ, 0);
    assert.equal(result.newRotation, 0);
  });

  it('does not falsely reject normal play with config move_speed', () => {
    // move_speed=5.0, tickRateHz=20 -> dt=0.05 -> per-tick movement = 0.25
    // max_velocity_units_per_tick=0.5 -> 0.25 < 0.5, so normal play is valid
    const config = makeTestConfig();
    const cube = createCube('test', 0xff0000);
    cube.rotation = Math.PI; // face negative Z
    const input = {
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });

  it('rejects when move_speed makes per-tick movement exceed max_velocity', () => {
    // move_speed=12.0, tickRateHz=20 -> dt=0.05 -> per-tick movement = 0.6
    // max_velocity_units_per_tick=0.5 -> 0.6 > 0.5, so rejected
    const config = makeTestConfig({
      moveSpeed: 12.0,
      maxVelocityUnitsPerTick: 0.5,
    });
    const cube = createCube('test', 0xff0000);
    cube.rotation = Math.PI; // face negative Z
    const input = {
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, false);
    assert(result.reason?.startsWith('velocity_exceeded:'));
    assert.equal(result.newX, 0);
    assert.equal(result.newZ, 0);
  });

  it('loadNetProtoConfig reads snake_case world_bounds from config', () => {
    const configs = new Map<string, ConfigFile>();
    const baseConfig: ConfigFile = {
      _meta: {
        system: 'net_proto',
        version: '0.1.0',
        schema: 'extended-1',
        owner_task: 'T03P',
        status: 'draft',
      },
      values: {
        protocol_version: { type: 'integer', value: 1, range: [1, 255] },
        max_message_size_bytes: { type: 'integer', value: 16384, range: [1024, 1048576] },
        tick_rate_hz: { type: 'integer', value: 20, range: [10, 60] },
        position_quantization: { type: 'integer', value: 64, range: [16, 256] },
        angle_quantization_bits: { type: 'integer', value: 16, range: [8, 32] },
        keyframe_interval_ticks: { type: 'integer', value: 10, range: [1, 60] },
        max_velocity_units_per_tick: { type: 'number', value: 0.5, range: [0.1, 10.0] },
        world_bounds: {
          type: 'object',
          value: { min_x: -50, max_x: 50, min_z: -50, max_z: 50 },
        },
        client_send_rate_hz: { type: 'integer', value: 20, range: [5, 60] },
        move_speed: { type: 'number', value: 5.0, range: [0.1, 20.0] },
      },
    };
    configs.set('net_proto', baseConfig);
    const config = loadNetProtoConfig(configs);
    assert.equal(config.worldBounds.minX, -50);
    assert.equal(config.worldBounds.maxX, 50);
    assert.equal(config.worldBounds.minZ, -50);
    assert.equal(config.worldBounds.maxZ, 50);
  });

  it('rejects out-of-bounds using config-driven world_bounds', () => {
    const configs = new Map<string, ConfigFile>();
    const baseConfig: ConfigFile = {
      _meta: {
        system: 'net_proto',
        version: '0.1.0',
        schema: 'extended-1',
        owner_task: 'T03P',
        status: 'draft',
      },
      values: {
        protocol_version: { type: 'integer', value: 1, range: [1, 255] },
        max_message_size_bytes: { type: 'integer', value: 16384, range: [1024, 1048576] },
        tick_rate_hz: { type: 'integer', value: 20, range: [10, 60] },
        position_quantization: { type: 'integer', value: 64, range: [16, 256] },
        angle_quantization_bits: { type: 'integer', value: 16, range: [8, 32] },
        keyframe_interval_ticks: { type: 'integer', value: 10, range: [1, 60] },
        max_velocity_units_per_tick: { type: 'number', value: 10, range: [0.1, 10.0] },
        world_bounds: {
          type: 'object',
          value: { min_x: -10, max_x: 10, min_z: -10, max_z: 10 },
        },
        client_send_rate_hz: { type: 'integer', value: 20, range: [5, 60] },
        move_speed: { type: 'number', value: 50, range: [0.1, 20.0] },
      },
    };
    configs.set('net_proto', baseConfig);
    const config = loadNetProtoConfig(configs);
    const cube = createCube('test', 0xff0000);
    cube.x = 9.5;
    cube.rotation = 0;
    const input = {
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: true,
      tick: 1,
    };
    const result = validateMovement(cube, input, config, 1);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'out_of_bounds');
    assert.equal(result.newX, 9.5);
  });
});
