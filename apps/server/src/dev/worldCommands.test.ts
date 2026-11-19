import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleWorldCommand,
  type ResourceRatePatch,
  type WorldCommandPorts,
} from './worldCommands.ts';

function createPorts(overrides: Partial<WorldCommandPorts> = {}) {
  const calls: string[] = [];
  const responses: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const ports: WorldCommandPorts = {
    applyResourceRates: (patch) => calls.push(`rates:${JSON.stringify(patch)}`),
    resetResourceRates: () => calls.push('reset'),
    tileCoordinates: (worldX, worldZ) => ({
      tileX: Math.floor(worldX / 8),
      tileZ: Math.floor(worldZ / 8),
    }),
    setTileResources: (tileX, tileZ, resources) => {
      calls.push(`tile:${tileX},${tileZ}:${JSON.stringify(resources)}`);
      return true;
    },
    setTimeOfDay: (fraction) => calls.push(`time:${fraction}`),
    setTimePaused: (paused) => calls.push(`paused:${paused}`),
    setTimeScale: (scale) => calls.push(`scale:${scale}`),
    broadcastWeather: () => calls.push('broadcast'),
    weatherBroadcast: () => ({ timeOfDay: 0.5, isDay: true, sunIntensity: 1.4 }),
    respond: (action, payload) => responses.push({ action, payload }),
    ...overrides,
  };
  return { ports, calls, responses };
}

describe('handleWorldCommand', () => {
  it('claims only its own actions', () => {
    const { ports } = createPorts();
    assert.equal(handleWorldCommand(ports, { type: 'dev_set_growth' }), false);
    assert.equal(handleWorldCommand(ports, { type: 'dev_set_time', time_of_day: 0.5 }), true);
  });

  it('passes only the rates the command mentioned', () => {
    const { ports, calls } = createPorts();
    handleWorldCommand(ports, {
      type: 'dev_set_resources',
      photosynthesis_rate: 2,
      rain_gain_per_s: 0.75,
    });
    // JSON drops the keys the command did not send, which is the point: the
    // setter behind each of them must not be called.
    const patch = JSON.parse(calls[0]?.replace('rates:', '') ?? '{}') as ResourceRatePatch;
    assert.deepEqual(patch, { photosynthesisRate: 2, rainGainPerS: 0.75 });
  });

  it('drops a non-numeric rate instead of poisoning the simulation with NaN', () => {
    const { ports, calls } = createPorts();
    handleWorldCommand(ports, { type: 'dev_set_resources', diffusion_rate: 'fast' });
    const patch = JSON.parse(calls[0]?.replace('rates:', '') ?? '{}') as ResourceRatePatch;
    assert.equal(patch.diffusionRate, undefined);
  });

  it('resets the resource rates', () => {
    const { ports, calls, responses } = createPorts();
    handleWorldCommand(ports, { type: 'dev_reset_resources' });
    assert.deepEqual(calls, ['reset']);
    assert.equal(responses[0]?.payload.ok, true);
  });

  it('writes a tile named by tile indices or by world position', () => {
    const { ports, calls } = createPorts();
    handleWorldCommand(ports, { type: 'dev_set_tile', x: 2, z: 3, moisture: 0.5 });
    handleWorldCommand(ports, { type: 'dev_set_tile', worldX: 16, worldZ: -8, groundwater: 1 });
    assert.deepEqual(calls, ['tile:2,3:{"moisture":0.5}', 'tile:2,-1:{"groundwater":1}']);
  });

  it('does not write tile (0, 0) when the command names no position', () => {
    const { ports, calls, responses } = createPorts();
    handleWorldCommand(ports, { type: 'dev_set_tile', moisture: 0.5 });
    assert.deepEqual(calls, []);
    assert.deepEqual(responses.at(-1)?.payload, { ok: false, reason: 'bad_tile' });
  });

  it('answers ok only when the tile was actually written', () => {
    const { ports, responses } = createPorts();
    handleWorldCommand(ports, { type: 'dev_set_tile', x: 2, z: 3, moisture: 0.5 });
    assert.deepEqual(responses.at(-1)?.payload, { ok: true });
  });

  it('refuses an out-of-bounds tile instead of claiming success', () => {
    const { ports, responses } = createPorts({ setTileResources: () => false });
    handleWorldCommand(ports, { type: 'dev_set_tile', x: 999999, z: -999999, moisture: 0.5 });
    assert.deepEqual(responses.at(-1)?.payload, { ok: false, reason: 'out_of_bounds' });
  });

  it('moves the world clock and answers with the state it settled on', () => {
    const { ports, calls, responses } = createPorts();
    handleWorldCommand(ports, { type: 'dev_set_time', time_of_day: 0.25 });
    assert.deepEqual(calls, ['time:0.25', 'broadcast']);
    assert.deepEqual(responses[0]?.payload, {
      ok: true,
      timeOfDay: 0.5,
      isDay: true,
      sunIntensity: 1.4,
      timePaused: false,
      timeScale: 1,
    });
  });

  it('freezes and speeds the clock on the server, then tells everyone', () => {
    const { ports, calls, responses } = createPorts({
      weatherBroadcast: () => ({
        timeOfDay: 0.5,
        isDay: true,
        sunIntensity: 1.4,
        timePaused: true,
        timeScale: 30,
      }),
    });

    handleWorldCommand(ports, { type: 'dev_set_time', paused: true });
    handleWorldCommand(ports, { type: 'dev_set_time', scale: 30 });

    assert.deepEqual(calls, ['paused:true', 'broadcast', 'scale:30', 'broadcast']);
    assert.deepEqual(responses.at(-1)?.payload, {
      ok: true,
      timeOfDay: 0.5,
      isDay: true,
      sunIntensity: 1.4,
      timePaused: true,
      timeScale: 30,
    });
  });

  it('treats a command that names no clock setting as bad input', () => {
    const { ports, calls, responses } = createPorts();
    handleWorldCommand(ports, { type: 'dev_set_time' });
    assert.deepEqual(calls, []);
    assert.deepEqual(responses[0]?.payload, { ok: false, reason: 'bad_time' });
  });

  it('refuses a time it cannot read rather than moving the clock to NaN', () => {
    const { ports, calls, responses } = createPorts();
    handleWorldCommand(ports, { type: 'dev_set_time', time_of_day: 'noon' });
    assert.deepEqual(calls, []);
    assert.deepEqual(responses[0]?.payload, { ok: false, reason: 'bad_time' });
  });
});
