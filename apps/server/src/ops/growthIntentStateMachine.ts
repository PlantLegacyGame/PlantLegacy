import type { GrowthIntent } from '@plant-legacy/shared/growth';

export interface QueuedGrowthIntent {
  intent: GrowthIntent;
  receivedTick: number;
  intentId: string;
}

export interface GrowthIntentStateMachine {
  pendingIntents: Map<string, QueuedGrowthIntent[]>;
  maxIntentsPerPlayer: number;
  intentIdCounter: number;
}

export function createGrowthIntentStateMachine(
  maxIntentsPerPlayer = 100,
): GrowthIntentStateMachine {
  return {
    pendingIntents: new Map(),
    maxIntentsPerPlayer,
    intentIdCounter: 0,
  };
}

export function growthIntentStateMachineEnqueue(
  machine: GrowthIntentStateMachine,
  playerId: string,
  intent: GrowthIntent,
  currentTick: number,
): { intentId: string; success: boolean; reason?: string } {
  const playerIntents = machine.pendingIntents.get(playerId) ?? [];

  if (playerIntents.length >= machine.maxIntentsPerPlayer) {
    return { intentId: '', success: false, reason: 'intent_queue_full' };
  }

  machine.intentIdCounter++;
  const intentId = `${playerId}_${machine.intentIdCounter}`;

  const queued: QueuedGrowthIntent = {
    intent,
    receivedTick: currentTick,
    intentId,
  };

  playerIntents.push(queued);
  machine.pendingIntents.set(playerId, playerIntents);

  return { intentId, success: true };
}

export function growthIntentStateMachineDrain(
  machine: GrowthIntentStateMachine,
  playerId: string,
  currentTick: number,
): QueuedGrowthIntent[] {
  const playerIntents = machine.pendingIntents.get(playerId);
  if (!playerIntents || playerIntents.length === 0) return [];

  const ready: QueuedGrowthIntent[] = [];
  const remaining: QueuedGrowthIntent[] = [];

  for (const queued of playerIntents) {
    if (queued.receivedTick <= currentTick) {
      ready.push(queued);
    } else {
      remaining.push(queued);
    }
  }

  if (remaining.length > 0) {
    machine.pendingIntents.set(playerId, remaining);
  } else {
    machine.pendingIntents.delete(playerId);
  }

  return ready;
}

export function growthIntentStateMachineClear(
  machine: GrowthIntentStateMachine,
  playerId: string,
): void {
  machine.pendingIntents.delete(playerId);
}

export function growthIntentStateMachineGetPendingCount(
  machine: GrowthIntentStateMachine,
  playerId: string,
): number {
  const playerIntents = machine.pendingIntents.get(playerId);
  return playerIntents?.length ?? 0;
}

export function growthIntentStateMachineGetAllPending(
  machine: GrowthIntentStateMachine,
): Array<{ playerId: string; intents: QueuedGrowthIntent[] }> {
  const result: Array<{ playerId: string; intents: QueuedGrowthIntent[] }> = [];
  for (const [playerId, intents] of machine.pendingIntents.entries()) {
    result.push({
      playerId,
      intents: [...intents],
    });
  }
  return result;
}
