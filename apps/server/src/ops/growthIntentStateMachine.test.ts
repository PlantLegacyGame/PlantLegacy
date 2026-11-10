import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GrowthIntent, NodeType } from '@plant-legacy/shared/growth';
import {
  createGrowthIntentStateMachine,
  growthIntentStateMachineClear,
  growthIntentStateMachineDrain,
  growthIntentStateMachineEnqueue,
  growthIntentStateMachineGetAllPending,
  growthIntentStateMachineGetPendingCount,
} from './growthIntentStateMachine.ts';

function makeIntent(nodeId = 'node_0', nodeType: NodeType = 'root'): GrowthIntent {
  return {
    plantId: 'plant_1',
    nodeId,
    nodeType,
    direction: { x: 0, y: -1, z: 0 },
    isAttack: false,
    tick: 1,
  };
}

describe('GrowthIntentStateMachine', () => {
  it('enqueues and drains intents for a player', () => {
    const machine = createGrowthIntentStateMachine(10);
    const intent = makeIntent();

    const res = growthIntentStateMachineEnqueue(machine, 'p1', intent, 5);
    assert.equal(res.success, true);
    assert.ok(res.intentId.startsWith('p1_'));
    assert.equal(growthIntentStateMachineGetPendingCount(machine, 'p1'), 1);

    // Drain before tick 5 yields nothing
    const early = growthIntentStateMachineDrain(machine, 'p1', 4);
    assert.equal(early.length, 0);

    // Drain at tick 5 yields the intent
    const drained = growthIntentStateMachineDrain(machine, 'p1', 5);
    assert.equal(drained.length, 1);
    assert.equal(drained[0].intentId, res.intentId);
    assert.equal(drained[0].receivedTick, 5);
    assert.equal(growthIntentStateMachineGetPendingCount(machine, 'p1'), 0);
  });

  it('preserves multiple intents enqueued in the same tick (INV-NET-06)', () => {
    const machine = createGrowthIntentStateMachine(10);
    const intentA = makeIntent('node_0', 'root');
    const intentB = makeIntent('node_1', 'stem');

    const resA = growthIntentStateMachineEnqueue(machine, 'p1', intentA, 10);
    const resB = growthIntentStateMachineEnqueue(machine, 'p1', intentB, 10);

    assert.equal(resA.success, true);
    assert.equal(resB.success, true);
    assert.notEqual(resA.intentId, resB.intentId);
    assert.equal(growthIntentStateMachineGetPendingCount(machine, 'p1'), 2);

    const drained = growthIntentStateMachineDrain(machine, 'p1', 10);
    assert.equal(drained.length, 2);
    assert.equal(drained[0].intentId, resA.intentId);
    assert.equal(drained[1].intentId, resB.intentId);
    assert.equal(growthIntentStateMachineGetPendingCount(machine, 'p1'), 0);
  });

  it('rejects enqueue when maxIntentsPerPlayer limit is reached', () => {
    const machine = createGrowthIntentStateMachine(2);
    const intent = makeIntent();

    assert.equal(growthIntentStateMachineEnqueue(machine, 'p1', intent, 1).success, true);
    assert.equal(growthIntentStateMachineEnqueue(machine, 'p1', intent, 1).success, true);

    const overflow = growthIntentStateMachineEnqueue(machine, 'p1', intent, 1);
    assert.equal(overflow.success, false);
    assert.equal(overflow.reason, 'intent_queue_full');
  });

  it('clears pending intents for a player', () => {
    const machine = createGrowthIntentStateMachine(10);
    growthIntentStateMachineEnqueue(machine, 'p1', makeIntent(), 1);
    growthIntentStateMachineClear(machine, 'p1');
    assert.equal(growthIntentStateMachineGetPendingCount(machine, 'p1'), 0);
    assert.equal(growthIntentStateMachineDrain(machine, 'p1', 10).length, 0);
  });

  it('lists all pending intents across all players', () => {
    const machine = createGrowthIntentStateMachine(10);
    growthIntentStateMachineEnqueue(machine, 'p1', makeIntent(), 1);
    growthIntentStateMachineEnqueue(machine, 'p2', makeIntent(), 2);

    const all = growthIntentStateMachineGetAllPending(machine);
    assert.equal(all.length, 2);
    const playerIds = all.map((entry) => entry.playerId);
    assert.ok(playerIds.includes('p1'));
    assert.ok(playerIds.includes('p2'));
  });
});
