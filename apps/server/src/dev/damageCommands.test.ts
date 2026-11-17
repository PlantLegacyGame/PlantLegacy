import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type DamageCommandPorts,
  handleDamageCommand,
  type PlantTarget,
} from './damageCommands.ts';

const target: PlantTarget = { plantId: 'p1', playerId: 'pl1', root: { x: 3, z: -4 } };

function createPorts(overrides: Partial<DamageCommandPorts> = {}) {
  const calls: string[] = [];
  const responses: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const ports: DamageCommandPorts = {
    defaultToolDamage: () => 12,
    applyToolDamage: (amount) => calls.push(`damage:${amount}`),
    killPlant: () => calls.push('kill'),
    forceUproot: (cause) => {
      calls.push(`uproot:${cause}`);
      return true;
    },
    requestReroot: (dirX, dirZ) => {
      calls.push(`reroot:${dirX},${dirZ}`);
      return true;
    },
    forceSwarm: (x, z) => calls.push(`swarm:${x},${z}`),
    forceCollapse: (x, z) => calls.push(`collapse:${x},${z}`),
    processDamageEvents: () => calls.push('events'),
    processPlantDeaths: () => calls.push('deaths'),
    respond: (action, payload) => responses.push({ action, payload }),
    ...overrides,
  };
  return { ports, calls, responses };
}

describe('handleDamageCommand', () => {
  it('claims only injuries', () => {
    const { ports, calls } = createPorts();
    assert.equal(handleDamageCommand(ports, { type: 'dev_fill_energy' }, target), false);
    assert.deepEqual(calls, []);
  });

  it('answers no_plant once when the caller has no plant to hurt', () => {
    const { ports, calls, responses } = createPorts();
    for (const type of [
      'dev_kill_plant',
      'dev_damage_plant',
      'dev_uproot_plant',
      'dev_reroot',
      'dev_herbivore_swarm',
      'dev_terrain_collapse',
    ]) {
      handleDamageCommand(ports, { type }, undefined);
    }
    assert.deepEqual(calls, []);
    assert.equal(responses.length, 6);
    assert.deepEqual(responses[0]?.payload, { ok: false, error: 'no_plant' });
  });

  it('kills, then settles the death before answering', () => {
    const { ports, calls, responses } = createPorts();
    handleDamageCommand(ports, { type: 'dev_kill_plant' }, target);
    assert.deepEqual(calls, ['kill', 'deaths', 'events']);
    assert.equal(responses[0]?.payload.ok, true);
  });

  it('uses the configured tool damage when no amount is given', () => {
    const { ports, calls, responses } = createPorts();
    handleDamageCommand(ports, { type: 'dev_damage_plant' }, target);
    handleDamageCommand(ports, { type: 'dev_damage_plant', amount: 99 }, target);
    assert.deepEqual(calls, [
      'damage:12',
      'events',
      'deaths',
      'events',
      'damage:99',
      'events',
      'deaths',
      'events',
    ]);
    assert.equal(responses[0]?.payload.amount, 12);
    assert.equal(responses[1]?.payload.amount, 99);
  });

  it('keeps an unknown uproot cause on gust', () => {
    const { ports, calls } = createPorts();
    handleDamageCommand(ports, { type: 'dev_uproot_plant', cause: 'meteor' }, target);
    handleDamageCommand(ports, { type: 'dev_uproot_plant', cause: 'collapse' }, target);
    assert.deepEqual(calls, ['uproot:gust', 'events', 'uproot:collapse', 'events']);
  });

  it('defaults reroot steering to +x', () => {
    const { ports, calls, responses } = createPorts();
    handleDamageCommand(ports, { type: 'dev_reroot' }, target);
    assert.deepEqual(calls, ['reroot:1,0']);
    assert.deepEqual(responses[0]?.payload, { ok: true, dirX: 1, dirZ: 0 });
  });

  it('starts a swarm and a collapse at the crown', () => {
    const { ports, calls } = createPorts();
    handleDamageCommand(ports, { type: 'dev_herbivore_swarm' }, target);
    handleDamageCommand(ports, { type: 'dev_terrain_collapse' }, target);
    assert.deepEqual(calls, [
      'swarm:3,-4',
      'events',
      'collapse:3,-4',
      'events',
      'deaths',
      'events',
    ]);
  });

  it('starts at the origin when the plant has no crown', () => {
    const { ports } = createPorts();
    const calls: string[] = [];
    handleDamageCommand(
      { ...ports, forceSwarm: (x, z) => calls.push(`swarm:${x},${z}`) },
      { type: 'dev_herbivore_swarm' },
      { ...target, root: null },
    );
    assert.deepEqual(calls, ['swarm:0,0']);
  });
});
