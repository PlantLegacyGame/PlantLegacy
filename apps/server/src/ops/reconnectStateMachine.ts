import type { Plant } from '@plant-legacy/shared/growth';

export type ReclaimKey = string;

export interface PendingRemoval {
  plantId: string;
  accountId: string | undefined;
  generation: number;
  timeout: NodeJS.Timeout;
}

export interface ReconnectStateMachine {
  pendingRemovals: Map<ReclaimKey, PendingRemoval>;
  generation: number;
  reconnectWindowMs: number;
  persistenceEnabled: boolean;
}

export function createReconnectStateMachine(
  reconnectWindowMs: number,
  persistenceEnabled: boolean,
): ReconnectStateMachine {
  return {
    pendingRemovals: new Map(),
    generation: 0,
    reconnectWindowMs,
    persistenceEnabled,
  };
}

export function makeReclaimKey(accountId: string | undefined, plantId: string): ReclaimKey {
  return accountId ?? `anon_${plantId}`;
}

export function reconnectStateMachineOnDisconnect(
  machine: ReconnectStateMachine,
  plant: Plant,
  accountId: string | undefined,
  onRemove: (plantId: string) => void,
  onLog: (msg: string, meta: Record<string, unknown>) => void,
): void {
  const plantId = plant.id;
  const key = makeReclaimKey(accountId, plantId);

  if (!machine.persistenceEnabled) {
    onRemove(plantId);
    onLog('plant removed immediately (persistence disabled)', {
      plantId,
      accountId: accountId ?? 'anonymous',
    });
    return;
  }

  machine.generation++;
  const generation = machine.generation;

  const timeout = setTimeout(() => {
    const pending = machine.pendingRemovals.get(key);
    if (pending && pending.generation === generation) {
      machine.pendingRemovals.delete(key);
      onRemove(plantId);
      onLog('plant removed after reconnect window expired', {
        plantId,
        accountId: accountId ?? 'anonymous',
      });
    }
  }, machine.reconnectWindowMs);

  machine.pendingRemovals.set(key, {
    plantId,
    accountId,
    generation,
    timeout,
  });

  onLog('player disconnected, plant kept for reconnect window', {
    plantId,
    accountId: accountId ?? 'anonymous',
    windowMs: machine.reconnectWindowMs,
  });
}

export function reconnectStateMachineReclaimByAccount(
  machine: ReconnectStateMachine,
  accountId: string,
  onLog: (msg: string, meta: Record<string, unknown>) => void,
): { plantId: string; generation: number } | null {
  const key = makeReclaimKey(accountId, '');
  const pending = machine.pendingRemovals.get(key);
  if (!pending) return null;

  clearTimeout(pending.timeout);
  machine.pendingRemovals.delete(key);

  onLog('plant reclaimed by account', {
    accountId,
    plantId: pending.plantId,
    generation: pending.generation,
  });

  return { plantId: pending.plantId, generation: pending.generation };
}

export function reconnectStateMachineReclaimByPlantId(
  machine: ReconnectStateMachine,
  plantId: string,
  onLog: (msg: string, meta: Record<string, unknown>) => void,
): { plantId: string; generation: number } | null {
  const key = makeReclaimKey(undefined, plantId);
  const pending = machine.pendingRemovals.get(key);
  if (!pending) return null;

  clearTimeout(pending.timeout);
  machine.pendingRemovals.delete(key);

  onLog('plant reclaimed by id', {
    plantId,
    generation: pending.generation,
  });

  return { plantId: pending.plantId, generation: pending.generation };
}

export function reconnectStateMachineCancelPending(
  machine: ReconnectStateMachine,
  plantId: string,
  accountId: string | undefined,
): boolean {
  const key = makeReclaimKey(accountId, plantId);
  const pending = machine.pendingRemovals.get(key);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  machine.pendingRemovals.delete(key);
  return true;
}

export function reconnectStateMachineGetPending(
  machine: ReconnectStateMachine,
  accountId: string | undefined,
  plantId: string,
): PendingRemoval | undefined {
  const key = makeReclaimKey(accountId, plantId);
  return machine.pendingRemovals.get(key);
}
