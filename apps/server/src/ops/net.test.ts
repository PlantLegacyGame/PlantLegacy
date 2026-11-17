import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigFile } from '@plant-legacy/shared/config';
import { PROTOCOL_VERSION } from '@plant-legacy/shared/protocol';
import { loadNetProtoConfig, nodeWireFields } from './net.ts';

function makeTestConfig(
  overrides: Partial<{
    protocolVersion: number;
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
      protocol_version: {
        type: 'integer',
        value: overrides.protocolVersion ?? PROTOCOL_VERSION,
        range: [1, 255],
      },
      max_message_size_bytes: { type: 'integer', value: 16384, range: [1024, 1048576] },
      max_buffered_bytes: { type: 'integer', value: 4194304, range: [65536, 67108864] },
      max_messages_per_second: { type: 'integer', value: 120, range: [1, 1000] },
      message_burst: { type: 'integer', value: 240, range: [1, 5000] },
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
      weather_send_rate_hz: { type: 'integer', value: 2, range: [1, 20] },
      hello_timeout_ms: { type: 'integer', value: 5000, range: [1000, 30000] },
      reconnect_window_ms: { type: 'integer', value: 300000, range: [30000, 86400000] },
    },
  };
  configs.set('net_proto', baseConfig);
  return loadNetProtoConfig(configs);
}

describe('loadNetProtoConfig', () => {
  it('refuses a config protocol version that disagrees with the shared constant', () => {
    // The server compared HELLO against the config while the client sent the
    // constant, so editing only the JSON locked every client out. The boot check
    // makes the two impossible to disagree silently.
    assert.throws(
      () => makeTestConfig({ protocolVersion: PROTOCOL_VERSION + 1 }),
      /protocol_version/,
    );
  });

  it('loads net_proto config with defaults', () => {
    const config = makeTestConfig();
    assert.equal(config.protocolVersion, PROTOCOL_VERSION);
    assert.equal(config.maxMessageSizeBytes, 16384);
    assert.equal(config.maxMessagesPerSecond, 120);
    assert.equal(config.messageBurst, 240);
    assert.equal(config.tickRateHz, 20);
    assert.equal(config.positionQuantization, 64);
    assert.equal(config.angleQuantizationBits, 16);
    assert.equal(config.keyframeIntervalTicks, 10);
    assert.equal(config.clientSendRateHz, 20);
    assert.equal(config.weatherSendRateHz, 2);
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
        protocol_version: { type: 'integer', value: PROTOCOL_VERSION, range: [1, 255] },
        max_message_size_bytes: { type: 'integer', value: 16384, range: [1024, 1048576] },
        max_buffered_bytes: { type: 'integer', value: 4194304, range: [65536, 67108864] },
        max_messages_per_second: { type: 'integer', value: 120, range: [1, 1000] },
        message_burst: { type: 'integer', value: 240, range: [1, 5000] },
        tick_rate_hz: { type: 'integer', value: 20, range: [10, 60] },
        position_quantization: { type: 'integer', value: 64, range: [16, 256] },
        angle_quantization_bits: { type: 'integer', value: 16, range: [8, 32] },
        keyframe_interval_ticks: { type: 'integer', value: 10, range: [1, 60] },
        world_bounds: {
          type: 'object',
          value: { min_x: -50, max_x: 50, min_z: -50, max_z: 50 },
        },
        client_send_rate_hz: { type: 'integer', value: 20, range: [5, 60] },
        weather_send_rate_hz: { type: 'integer', value: 2, range: [1, 20] },
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

describe('node wire fields', () => {
  // One body per payload: WELCOME, PLANT_SYNC, GROWTH_EVENT and PLANT_CREATED
  // all serialise nodes through `nodeWireFields`, so a geometry field missing
  // here is missing everywhere - which is exactly how every rival plant and
  // every gallery body came to be drawn with guessed joints.
  const node = {
    id: 'p1:seed.stem0',
    plantId: 'p1',
    type: 'stem' as const,
    layer: 'canopy' as const,
    x: 1,
    y: 0.35,
    z: 2,
    biomass: 4,
    age: 3,
    parentId: 'p1:seed',
    children: [],
    statModifiers: {},
    resourceDrawWater: 0.2,
    resourceDrawNutrients: 0.2,
    resourceDrawMinerals: 0.6,
    upkeepBiomassPerSecond: 0.02,
    growthDirectionBias: 'upward',
    lastGrowthTick: 7,
    growthProgress: 0.5,
    isSeed: false,
    mutationFlags: 1,
    radius: 0.05,
    parentAttachX: 1,
    parentAttachY: 0.2,
    parentAttachZ: 2,
    attachFraction: 0.55,
    targetX: 1,
    targetY: 0.9,
    targetZ: 2,
    growthTimeSeconds: 2,
    growthStartTick: 5,
  } as unknown as Parameters<typeof nodeWireFields>[0];

  it('carries everything a renderer needs to draw the joint', () => {
    const wire = nodeWireFields(node, 0.8);
    for (const key of [
      'x',
      'y',
      'z',
      'radius',
      'parentAttachX',
      'parentAttachY',
      'parentAttachZ',
      'attachFraction',
      'targetX',
      'targetY',
      'targetZ',
      'growthProgress',
      'mutationFlags',
    ] as const) {
      assert.notEqual(wire[key], undefined, `${key} missing from the wire payload`);
    }
    assert.equal(wire.attachFraction, 0.55);
    assert.equal(wire.health, 0.8);
  });

  it('fills defaults instead of sending undefined to the client', () => {
    const bare = { ...node } as Record<string, unknown>;
    delete bare.growthProgress;
    delete bare.mutationFlags;
    const wire = nodeWireFields(bare as unknown as Parameters<typeof nodeWireFields>[0]);
    assert.equal(wire.growthProgress, 1);
    assert.equal(wire.mutationFlags, 0);
  });
});
