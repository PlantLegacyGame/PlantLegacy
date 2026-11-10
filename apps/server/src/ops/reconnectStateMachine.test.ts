import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Plant } from '@plant-legacy/shared/growth';
import {
  createReconnectStateMachine,
  makeReclaimKey,
  reconnectStateMachineCancelPending,
  reconnectStateMachineGetPending,
  reconnectStateMachineOnDisconnect,
  reconnectStateMachineReclaimByAccount,
  reconnectStateMachineReclaimByPlantId,
} from './reconnectStateMachine.ts';

function makePlant(id = 'plant_1', ownerId = 'acc_1'): Plant {
  return {
    id,
    ownerId,
    worldId: 'world_0',
    rootNodeId: 'node_0',
    nodes: new Map(),
    totalBiomass: 10,
    totalEnergy: 20,
    totalUpkeep: 1,
    storedWater: 100,
    storedMinerals: 100,
    lastGrowthTick: 0,
    growthCooldownUntil: 0,
    growthSeq: 0,
  };
}

describe('ReconnectStateMachine', () => {
  it('builds reclaim keys correctly for account and anonymous', () => {
    assert.equal(makeReclaimKey('acc_123', 'plant_456'), 'acc_123');
    assert.equal(makeReclaimKey(undefined, 'plant_456'), 'anon_plant_456');
  });

  it('removes plant immediately when persistence is disabled (ADR-029)', () => {
    const machine = createReconnectStateMachine(5000, false);
    const plant = makePlant('plant_1', 'acc_1');
    let removedId: string | null = null;

    reconnectStateMachineOnDisconnect(
      machine,
      plant,
      'acc_1',
      (id) => {
        removedId = id;
      },
      () => {},
    );

    assert.equal(removedId, 'plant_1');
    assert.equal(reconnectStateMachineGetPending(machine, 'acc_1', 'plant_1'), undefined);
  });

  it('holds plant for reconnect window when persistence is enabled', () => {
    const machine = createReconnectStateMachine(10000, true);
    const plant = makePlant('plant_1', 'acc_1');
    let removed = false;

    reconnectStateMachineOnDisconnect(
      machine,
      plant,
      'acc_1',
      () => {
        removed = true;
      },
      () => {},
    );

    assert.equal(removed, false);
    const pending = reconnectStateMachineGetPending(machine, 'acc_1', 'plant_1');
    assert.ok(pending);
    assert.equal(pending.plantId, 'plant_1');
    assert.equal(pending.accountId, 'acc_1');
    assert.equal(pending.generation, 1);

    // Cancel to clean up the timer
    reconnectStateMachineCancelPending(machine, 'plant_1', 'acc_1');
  });

  it('reclaims plant by account and cancels the timer', () => {
    const machine = createReconnectStateMachine(10000, true);
    const plant = makePlant('plant_1', 'acc_1');

    reconnectStateMachineOnDisconnect(
      machine,
      plant,
      'acc_1',
      () => {},
      () => {},
    );

    const reclaimed = reconnectStateMachineReclaimByAccount(machine, 'acc_1', () => {});
    assert.ok(reclaimed);
    assert.equal(reclaimed.plantId, 'plant_1');
    assert.equal(reclaimed.generation, 1);

    // Verify pending removal is deleted
    assert.equal(reconnectStateMachineGetPending(machine, 'acc_1', 'plant_1'), undefined);

    // Second reclaim attempt returns null
    const second = reconnectStateMachineReclaimByAccount(machine, 'acc_1', () => {});
    assert.equal(second, null);
  });

  it('reclaims anonymous plant by plantId', () => {
    const machine = createReconnectStateMachine(10000, true);
    const plant = makePlant('plant_anon_1', 'anon_user');

    reconnectStateMachineOnDisconnect(
      machine,
      plant,
      undefined,
      () => {},
      () => {},
    );

    const reclaimed = reconnectStateMachineReclaimByPlantId(machine, 'plant_anon_1', () => {});
    assert.ok(reclaimed);
    assert.equal(reclaimed.plantId, 'plant_anon_1');

    assert.equal(reconnectStateMachineGetPending(machine, undefined, 'plant_anon_1'), undefined);
  });

  it('cancels pending removal explicitly', () => {
    const machine = createReconnectStateMachine(10000, true);
    const plant = makePlant('plant_1', 'acc_1');

    reconnectStateMachineOnDisconnect(
      machine,
      plant,
      'acc_1',
      () => {},
      () => {},
    );

    const cancelled = reconnectStateMachineCancelPending(machine, 'plant_1', 'acc_1');
    assert.equal(cancelled, true);
    assert.equal(reconnectStateMachineCancelPending(machine, 'plant_1', 'acc_1'), false);
  });
});
