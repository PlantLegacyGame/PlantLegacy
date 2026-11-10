import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import type { WebSocket } from 'ws';
import {
  connectionRegistryClearHelloTimer,
  connectionRegistryGetAccountId,
  connectionRegistryGetPlantId,
  connectionRegistryInstallHandler,
  connectionRegistryRegister,
  connectionRegistryRemove,
  connectionRegistrySetPlant,
  connectionRegistryTransferPlant,
  createConnectionRegistry,
} from './connectionRegistry.ts';
import { createReconnectStateMachine } from './reconnectStateMachine.ts';

class MockWebSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  closedWith: { code?: number; reason?: string } | null = null;

  close(code?: number, reason?: string) {
    this.readyState = 3; // WebSocket.CLOSED
    this.closedWith = { code, reason };
    this.emit('close');
  }
}

describe('ConnectionRegistry', () => {
  it('registers connection and sets up HELLO timeout', async () => {
    const registry = createConnectionRegistry(50);
    const ws = new MockWebSocket() as unknown as WebSocket;
    let timedOutPlayer: string | null = null;

    connectionRegistryRegister(registry, ws, 'p1', 'acc_1', (pid) => {
      timedOutPlayer = pid;
    });

    assert.equal(connectionRegistryGetAccountId(registry, 'p1'), 'acc_1');
    assert.equal(connectionRegistryGetPlantId(registry, 'p1'), null);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(timedOutPlayer, 'p1');
  });

  it('clears HELLO timeout on success', async () => {
    const registry = createConnectionRegistry(50);
    const ws = new MockWebSocket() as unknown as WebSocket;
    let timedOut = false;

    connectionRegistryRegister(registry, ws, 'p1', 'acc_1', () => {
      timedOut = true;
    });

    connectionRegistryClearHelloTimer(registry, 'p1');

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(timedOut, false);
  });

  it('installs message handler and tracks plant', () => {
    const registry = createConnectionRegistry(5000);
    const ws = new MockWebSocket() as unknown as WebSocket;

    connectionRegistryRegister(registry, ws, 'p1', 'acc_1', () => {});
    connectionRegistrySetPlant(registry, 'p1', 'plant_1');
    assert.equal(connectionRegistryGetPlantId(registry, 'p1'), 'plant_1');

    let messageReceived: Buffer | null = null;
    connectionRegistryInstallHandler(registry, 'p1', (data) => {
      messageReceived = data;
    });

    const msg = Buffer.from('test');
    (ws as unknown as EventEmitter).emit('message', msg);
    assert.equal(messageReceived, msg);
  });

  it('transfers plant to a new connection and closes old socket on reclaim', () => {
    const registry = createConnectionRegistry(5000);
    const oldWs = new MockWebSocket() as unknown as WebSocket;
    const newWs = new MockWebSocket() as unknown as WebSocket;

    connectionRegistryRegister(registry, oldWs, 'old_p', 'acc_1', () => {});
    connectionRegistrySetPlant(registry, 'old_p', 'plant_1');

    connectionRegistryRegister(registry, newWs, 'new_p', 'acc_1', () => {});

    const transferred = connectionRegistryTransferPlant(registry, 'old_p', 'new_p');
    assert.equal(transferred, true);

    // Old socket should be closed
    assert.equal((oldWs as unknown as MockWebSocket).readyState, 3);
    assert.equal(connectionRegistryGetPlantId(registry, 'old_p'), null);
    assert.equal(connectionRegistryGetPlantId(registry, 'new_p'), 'plant_1');
  });

  it('removes connection and handles plant disconnect', () => {
    const registry = createConnectionRegistry(5000);
    const ws = new MockWebSocket() as unknown as WebSocket;
    const rm = createReconnectStateMachine(5000, false); // persistence disabled

    connectionRegistryRegister(registry, ws, 'p1', 'acc_1', () => {});
    connectionRegistrySetPlant(registry, 'p1', 'plant_1');

    let removedPlantId: string | null = null;
    connectionRegistryRemove(
      registry,
      'p1',
      rm,
      (pid) => {
        removedPlantId = pid;
      },
      () => {},
    );

    assert.equal(removedPlantId, 'plant_1');
    assert.equal(connectionRegistryGetPlantId(registry, 'p1'), null);
  });
});
