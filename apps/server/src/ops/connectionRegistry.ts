import type { Plant } from '@plant-legacy/shared/growth';
import { WebSocket } from 'ws';
import {
  type ReconnectStateMachine,
  reconnectStateMachineGetPending,
  reconnectStateMachineOnDisconnect as rmOnDisconnect,
} from './reconnectStateMachine.ts';

export type ConnectionState = 'awaiting_hello' | 'active' | 'closing';

export interface ConnectionRecord {
  ws: WebSocket;
  state: ConnectionState;
  playerId: string;
  accountId: string | undefined;
  plantId: string | null;
  helloTimer: NodeJS.Timeout | null;
  messageHandler: ((data: Buffer) => void) | null;
}

export interface ConnectionRegistry {
  connections: Map<string, ConnectionRecord>;
  helloTimeoutMs: number;
}

export function createConnectionRegistry(helloTimeoutMs: number = 5000): ConnectionRegistry {
  return {
    connections: new Map(),
    helloTimeoutMs,
  };
}

function makePlayerKey(playerId: string): string {
  return `player_${playerId}`;
}

export function connectionRegistryRegister(
  registry: ConnectionRegistry,
  ws: WebSocket,
  playerId: string,
  accountId: string | undefined,
  onHelloTimeout: (playerId: string) => void,
): ConnectionRecord {
  const key = makePlayerKey(playerId);

  const record: ConnectionRecord = {
    ws,
    state: 'awaiting_hello',
    playerId,
    accountId,
    plantId: null,
    helloTimer: null,
    messageHandler: null,
  };

  const helloTimer = setTimeout(() => {
    const conn = registry.connections.get(key);
    if (conn && conn.state === 'awaiting_hello') {
      onHelloTimeout(playerId);
    }
  }, registry.helloTimeoutMs);

  record.helloTimer = helloTimer;
  registry.connections.set(key, record);
  return record;
}

export function connectionRegistryInstallHandler(
  registry: ConnectionRegistry,
  playerId: string,
  handler: (data: Buffer) => void,
): boolean {
  const key = makePlayerKey(playerId);
  const record = registry.connections.get(key);
  if (!record) return false;

  if (record.messageHandler) {
    record.ws.off('message', record.messageHandler);
  }

  record.messageHandler = handler;
  record.ws.on('message', handler);
  record.state = 'active';
  return true;
}

export function connectionRegistryClearHelloTimer(
  registry: ConnectionRegistry,
  playerId: string,
): void {
  const key = makePlayerKey(playerId);
  const record = registry.connections.get(key);
  if (record?.helloTimer) {
    clearTimeout(record.helloTimer);
    record.helloTimer = null;
  }
}

export function connectionRegistrySetPlant(
  registry: ConnectionRegistry,
  playerId: string,
  plantId: string,
): boolean {
  const key = makePlayerKey(playerId);
  const record = registry.connections.get(key);
  if (!record) return false;
  record.plantId = plantId;
  return true;
}

export function connectionRegistryTransferPlant(
  registry: ConnectionRegistry,
  oldPlayerId: string,
  newPlayerId: string,
): boolean {
  const oldKey = makePlayerKey(oldPlayerId);
  const newKey = makePlayerKey(newPlayerId);

  const oldRecord = registry.connections.get(oldKey);
  if (!oldRecord?.plantId) return false;

  const plantId = oldRecord.plantId;

  // Close old socket
  if (oldRecord.ws.readyState === WebSocket.OPEN) {
    oldRecord.ws.close(1000, 'reclaimed by new connection');
  }

  // Clean up old connection
  if (oldRecord.helloTimer) clearTimeout(oldRecord.helloTimer);
  if (oldRecord.messageHandler) oldRecord.ws.off('message', oldRecord.messageHandler);
  registry.connections.delete(oldKey);

  // Update new connection
  const newRecord = registry.connections.get(newKey);
  if (!newRecord) return false;
  newRecord.plantId = plantId;
  newRecord.accountId = oldRecord.accountId;

  return true;
}

export function connectionRegistryGetPlantId(
  registry: ConnectionRegistry,
  playerId: string,
): string | null {
  const key = makePlayerKey(playerId);
  return registry.connections.get(key)?.plantId ?? null;
}

export function connectionRegistryGetAccountId(
  registry: ConnectionRegistry,
  playerId: string,
): string | undefined {
  const key = makePlayerKey(playerId);
  return registry.connections.get(key)?.accountId;
}

/** D01: Dev action - get connection count */
export function connectionRegistryGetConnectionCount(registry: ConnectionRegistry): number {
  return registry.connections.size;
}

export function connectionRegistryRemove(
  registry: ConnectionRegistry,
  playerId: string,
  reconnectMachine: ReconnectStateMachine,
  onRemovePlant: (plantId: string) => void,
  onLog: (msg: string, meta: Record<string, unknown>) => void,
): void {
  const key = makePlayerKey(playerId);
  const record = registry.connections.get(key);
  if (!record) return;

  if (record.helloTimer) clearTimeout(record.helloTimer);
  if (record.messageHandler) record.ws.off('message', record.messageHandler);

  if (record.plantId && record.accountId !== undefined) {
    // Check if there's a pending reclaim for this account
    const pending = reconnectStateMachineGetPending(
      reconnectMachine,
      record.accountId,
      record.plantId,
    );
    if (pending) {
      // Reclaim pending, don't remove plant yet
      registry.connections.delete(key);
      return;
    }
  }

  if (record.plantId) {
    if (!reconnectMachine.persistenceEnabled) {
      onRemovePlant(record.plantId);
    } else {
      rmOnDisconnect(
        reconnectMachine,
        { id: record.plantId, ownerId: record.accountId ?? record.playerId } as Plant,
        record.accountId,
        onRemovePlant,
        onLog,
      );
    }
  }

  registry.connections.delete(key);
}
