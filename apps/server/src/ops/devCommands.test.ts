import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_DEV_WEATHER_DURATION_S,
  resolveDevTileCommand,
  resolveDevWeatherCommand,
} from './devCommands.ts';

describe('resolveDevWeatherCommand', () => {
  it('accepts every state the panel can force', () => {
    for (const state of [
      'clear',
      'rain',
      'thunderstorm_telegraph',
      'thunderstorm_active',
      'thunderstorm_aftermath',
    ] as const) {
      const result = resolveDevWeatherCommand({ state });
      assert.deepEqual(result, { ok: true, command: { state, durationS: 180 } });
    }
  });

  it('refuses an unknown or missing state instead of forcing the default sky', () => {
    assert.deepEqual(resolveDevWeatherCommand({ state: 'snow' }), {
      ok: false,
      error: 'unknown_weather_state',
    });
    assert.deepEqual(resolveDevWeatherCommand({}), { ok: false, error: 'unknown_weather_state' });
    assert.deepEqual(resolveDevWeatherCommand({ state: 7 }), {
      ok: false,
      error: 'unknown_weather_state',
    });
  });

  it('falls back to the default duration for a value that is not a positive number', () => {
    const bad = [0, -30, Number.NaN, 'soon', null];
    for (const duration_s of bad) {
      const result = resolveDevWeatherCommand({ state: 'rain', duration_s });
      assert.deepEqual(result, {
        ok: true,
        command: { state: 'rain', durationS: DEFAULT_DEV_WEATHER_DURATION_S },
      });
    }
    assert.deepEqual(resolveDevWeatherCommand({ state: 'rain', duration_s: 30 }), {
      ok: true,
      command: { state: 'rain', durationS: 30 },
    });
  });
});

describe('resolveDevTileCommand', () => {
  const toTile = (worldX: number, worldZ: number) => ({
    tileX: Math.floor(worldX / 2),
    tileZ: Math.floor(worldZ / 2),
  });

  it('writes only the resources the command named', () => {
    assert.deepEqual(resolveDevTileCommand({ x: 3, z: 4, light: 0.5, groundwater: 2 }, toTile), {
      tileX: 3,
      tileZ: 4,
      resources: { light: 0.5, groundwater: 2 },
    });
  });

  it('converts world coordinates when no tile index is given', () => {
    assert.deepEqual(resolveDevTileCommand({ worldX: 12, worldZ: 7 }, toTile), {
      tileX: 6,
      tileZ: 3,
      resources: {},
    });
  });

  it('prefers explicit tile indices over world coordinates', () => {
    assert.deepEqual(resolveDevTileCommand({ x: 1, z: 1, worldX: 12, worldZ: 7 }, toTile), {
      tileX: 1,
      tileZ: 1,
      resources: {},
    });
  });

  it('has nothing to write when the command names no position', () => {
    assert.equal(resolveDevTileCommand({ light: 1 }, toTile), null);
    assert.equal(resolveDevTileCommand({ x: 3 }, toTile), null);
    assert.equal(resolveDevTileCommand({ worldX: 12 }, toTile), null);
  });

  it('ignores a non-numeric resource rather than writing NaN into the tile', () => {
    assert.deepEqual(resolveDevTileCommand({ x: 0, z: 0, light: 'bright' }, toTile), {
      tileX: 0,
      tileZ: 0,
      resources: {},
    });
  });
});
