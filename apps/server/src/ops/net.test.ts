import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigFile } from '@plant-legacy/shared/config';
import { loadNetProtoConfig } from './net.ts';

function makeTestConfig(
  overrides: Partial<{
    tickRateHz: number;
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
      max_velocity_units_per_tick: { type: 'number', value: 0.5, range: [0.1, 10.0] },
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
      hello_timeout_ms: { type: 'integer', value: 5000, range: [1000, 30000] },
      reconnect_window_ms: { type: 'integer', value: 300000, range: [30000, 86400000] },
    },
  };
  configs.set('net_proto', baseConfig);
  return loadNetProtoConfig(configs);
}

describe('loadNetProtoConfig', () => {
  it('loads net_proto config with defaults', () => {
    const config = makeTestConfig();
    assert.equal(config.protocolVersion, 1);
    assert.equal(config.maxMessageSizeBytes, 16384);
    assert.equal(config.tickRateHz, 20);
    assert.equal(config.positionQuantization, 64);
    assert.equal(config.angleQuantizationBits, 16);
    assert.equal(config.keyframeIntervalTicks, 10);
    assert.equal(config.maxVelocityUnitsPerTick, 0.5);
    assert.equal(config.clientSendRateHz, 20);
    assert.equal(config.helloTimeoutMs, 5000);
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
        hello_timeout_ms: { type: 'integer', value: 5000, range: [1000, 30000] },
        reconnect_window_ms: { type: 'integer', value: 300000, range: [30000, 86400000] },
      },
    };
    configs.set('net_proto', baseConfig);
    const config = loadNetProtoConfig(configs);
    assert.equal(config.worldBounds.minX, -50);
    assert.equal(config.worldBounds.maxX, 50);
    assert.equal(config.worldBounds.minZ, -50);
    assert.equal(config.worldBounds.maxZ, 50);
  });
});
