import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleRivalCommand, type RivalCommandPorts } from './rivalCommands.ts';

function createPorts(overrides: Partial<RivalCommandPorts> = {}) {
  const calls: string[] = [];
  const responses: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const ports: RivalCommandPorts = {
    ownRoot: () => ({ x: 10, z: -2 }),
    hasRivalNear: () => false,
    spawnRival: (x, z) => {
      calls.push(`spawn:${x},${z}`);
      return 'plant-rival';
    },
    setDaylight: (fraction) => {
      calls.push(`daylight:${fraction}`);
      return fraction;
    },
    respond: (action, payload) => responses.push({ action, payload }),
    ...overrides,
  };
  return { ports, calls, responses };
}

describe('handleRivalCommand', () => {
  it('claims only the rival action', () => {
    const { ports, calls } = createPorts();
    assert.equal(handleRivalCommand(ports, { type: 'dev_fill_energy' }), false);
    assert.deepEqual(calls, []);
  });

  it('stands a rival beside your seed, in daylight, and says where', () => {
    const { ports, calls, responses } = createPorts();
    assert.equal(handleRivalCommand(ports, { type: 'dev_spawn_rival' }), true);
    // Four metres east, so it never lands on the plant it is there to be seen beside.
    assert.deepEqual(calls, ['daylight:0.5', 'spawn:14,-2']);
    assert.deepEqual(responses[0]?.payload, {
      ok: true,
      plantId: 'plant-rival',
      x: 14,
      z: -2,
      timeOfDay: 0.5,
    });
  });

  it('does not spawn a second rival where one already stands', () => {
    const { ports, calls, responses } = createPorts({ hasRivalNear: () => true });
    handleRivalCommand(ports, { type: 'dev_spawn_rival' });
    assert.deepEqual(calls, ['daylight:0.5']);
    assert.equal(responses[0]?.payload.ok, false);
    assert.equal(responses[0]?.payload.reason, 'already_there');
  });

  it('answers no_plant instead of guessing a position', () => {
    const { ports, calls, responses } = createPorts({ ownRoot: () => null });
    handleRivalCommand(ports, { type: 'dev_spawn_rival' });
    assert.deepEqual(calls, []);
    assert.equal(responses[0]?.payload.ok, false);
    assert.equal(responses[0]?.payload.reason, 'no_plant');
  });

  it('leaves the clock alone when day is false', () => {
    const { ports, calls } = createPorts();
    handleRivalCommand(ports, { type: 'dev_spawn_rival', day: false });
    assert.deepEqual(calls, ['spawn:14,-2']);
  });

  it('reports a refused spawn rather than claiming a rival exists', () => {
    const { ports, responses } = createPorts({ spawnRival: () => null });
    handleRivalCommand(ports, { type: 'dev_spawn_rival' });
    assert.equal(responses[0]?.payload.ok, false);
    assert.equal(responses[0]?.payload.reason, 'spawn_failed');
    assert.equal(responses[0]?.payload.timeOfDay, 0.5);
  });
});
