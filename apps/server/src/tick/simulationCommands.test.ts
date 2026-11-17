import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type DevAction,
  handleSimulationCommand,
  type SimulationCommandPorts,
} from './simulationCommands.ts';

function createPorts(overrides: Partial<SimulationCommandPorts> = {}) {
  const calls: string[] = [];
  const responses: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const ports: SimulationCommandPorts = {
    setTickRate: (hz) => calls.push(`setTickRate:${hz}`),
    pauseSimulation: () => calls.push('pause'),
    resumeSimulation: () => calls.push('resume'),
    stepSimulationOnce: () => calls.push('step'),
    setInterestCellSize: (size) => calls.push(`cell:${size}`),
    setInterestRingRadius: (radius) => calls.push(`ring:${radius}`),
    setTierRates: (rates) => calls.push(`tiers:${JSON.stringify(rates)}`),
    savePlants: async () => ({ saved: 2 }),
    clearPersistence: async () => {},
    createRandomPlants: (count) => calls.push(`create:${count}`),
    applyConfig: (key, value) => ({ ok: true, key, applied: value }),
    plantSummaries: () => [{ id: 'p1', owner: 'a', biomass: 3 }],
    resourceTiles: () => [{ x: 1, y: 2 }],
    networkStats: () => ({ players: 1, connections: 1, stateSent: 5 }),
    respond: (action, payload) => responses.push({ action, payload }),
    logInfo: (message) => logs.push(message),
    ...overrides,
  };
  return { ports, calls, responses, logs };
}

function action(type: string, extra: Record<string, unknown> = {}): DevAction {
  return { type, ...extra };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('handleSimulationCommand', () => {
  it('claims only its own actions, so the rest of the switch still sees them', () => {
    const { ports, responses } = createPorts();
    assert.equal(handleSimulationCommand(ports, action('dev_set_resources')), false);
    assert.equal(handleSimulationCommand(ports, action('dev_grow_roots')), false);
    assert.equal(handleSimulationCommand(ports, action('dev_set_tick_rate')), true);
    assert.equal(responses.length, 1);
  });

  it('drives the clock: rate, pause, resume and a single step', () => {
    const { ports, calls, responses } = createPorts();
    handleSimulationCommand(ports, action('dev_set_tick_rate', { rate: 7 }));
    handleSimulationCommand(ports, action('dev_pause_simulation'));
    handleSimulationCommand(ports, action('dev_resume_simulation'));
    handleSimulationCommand(ports, action('dev_step_simulation'));
    assert.deepEqual(calls, ['setTickRate:7', 'pause', 'resume', 'step']);
    assert.deepEqual(
      responses.map((r) => r.payload.ok),
      [true, true, true, true],
    );
  });

  it('ignores a set_tick_rate with no rate rather than sending NaN to the clock', () => {
    const { ports, calls } = createPorts();
    handleSimulationCommand(ports, action('dev_set_tick_rate'));
    assert.deepEqual(calls, []);
  });

  it('applies the interest and tier knobs of dev_set_simulation', () => {
    const { ports, calls } = createPorts();
    handleSimulationCommand(
      ports,
      action('dev_set_simulation', {
        cell_size: 4,
        interest_ring_radius: 9,
        active_tick_rate_hz: 12,
        near_tick_rate_hz: 3,
        dormant_step_interval_sec: 30,
      }),
    );
    assert.deepEqual(calls, [
      'cell:4',
      'ring:9',
      'setTickRate:12',
      'tiers:{"nearTickRateHz":3}',
      'tiers:{"dormantStepIntervalSec":30}',
    ]);
  });

  it('rejects a non-positive active rate instead of stopping the clock', () => {
    const { ports, calls } = createPorts();
    handleSimulationCommand(ports, action('dev_set_simulation', { active_tick_rate_hz: 0 }));
    assert.deepEqual(calls, []);
  });

  it('reports what a force-save actually wrote', async () => {
    const { ports, responses } = createPorts({
      savePlants: async () => ({ saved: 4, skipped: 1 }),
    });
    handleSimulationCommand(ports, action('dev_force_save'));
    await settle();
    assert.deepEqual(responses, [
      { action: 'dev_force_save', payload: { ok: true, saved: 4, skipped: 1 } },
    ]);
  });

  it('reports a failed save or clear as a failure, not as success', async () => {
    const failing = createPorts({
      savePlants: async () => {
        throw new Error('disk full');
      },
      clearPersistence: async () => {
        throw new Error('locked');
      },
    });
    handleSimulationCommand(failing.ports, action('dev_force_save'));
    handleSimulationCommand(failing.ports, action('dev_clear_persistence'));
    await settle();
    assert.deepEqual(
      failing.responses.map((r) => r.payload.ok),
      [false, false],
    );
  });

  it('logs the dumps and returns the network counters to the panel', () => {
    const { ports, logs, responses } = createPorts();
    handleSimulationCommand(ports, action('dev_log_plants'));
    handleSimulationCommand(ports, action('dev_log_resources'));
    handleSimulationCommand(ports, action('dev_log_network'));
    assert.deepEqual(logs, ['Dev: Plant dump', 'Dev: Resource dump', 'Dev: Network stats']);
    assert.equal(responses[2]?.payload.stateSent, 5);
  });

  it('acknowledges the client-only renderer actions', () => {
    const { ports, responses } = createPorts();
    for (const type of ['dev_toggle_webgpu', 'dev_reinit_renderer', 'dev_dump_shaders']) {
      handleSimulationCommand(ports, action(type));
    }
    assert.deepEqual(
      responses.map((r) => r.action),
      ['dev_toggle_webgpu', 'dev_reinit_renderer', 'dev_dump_shaders'],
    );
  });

  it('clamps a stress-test count from the client', () => {
    const { ports, calls } = createPorts();
    handleSimulationCommand(ports, action('dev_stress_test', { count: 0 }));
    handleSimulationCommand(ports, action('dev_stress_test', { count: 9999 }));
    handleSimulationCommand(ports, action('dev_stress_test', { count: 'nope' }));
    assert.deepEqual(calls, ['create:1', 'create:500', 'create:100']);
  });

  it('needs both a key and a value for dev_set_config, and answers once', () => {
    const { ports, responses } = createPorts();
    handleSimulationCommand(ports, action('dev_set_config', { key: 'x' }));
    handleSimulationCommand(ports, action('dev_set_config', { key: 'x', value: 3 }));
    assert.equal(responses.length, 2);
    assert.equal(responses[0]?.payload.ok, false);
    assert.deepEqual(responses[1]?.payload, { ok: true, key: 'x', applied: 3 });
  });
});
