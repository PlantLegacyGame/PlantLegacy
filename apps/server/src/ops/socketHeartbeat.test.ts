import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type HeartbeatSocket, heartbeatTick } from './socketHeartbeat.ts';

function fakeSocket(name: string, events: string[]): HeartbeatSocket & { name: string } {
  return {
    name,
    isAlive: true,
    ping() {
      events.push(`ping:${name}`);
    },
    terminate() {
      events.push(`terminate:${name}`);
    },
  };
}

describe('the socket heartbeat', () => {
  it('pings a live socket and marks it waiting for an answer', () => {
    const events: string[] = [];
    const socket = fakeSocket('a', events);
    const dead = heartbeatTick([socket]);
    assert.deepEqual(dead, []);
    assert.deepEqual(events, ['ping:a']);
    assert.equal(socket.isAlive, false, 'no pong yet: the next sweep decides');
  });

  it('terminates a socket that missed its ping, so it stops costing the world', () => {
    // The tab that died without closing: still in `wss.clients`, still being
    // broadcast to, 4.4 MB behind.
    const events: string[] = [];
    const socket = fakeSocket('zombie', events);
    heartbeatTick([socket]); // ping it
    const dead = heartbeatTick([socket]); // no pong came back
    assert.deepEqual(
      dead.map((s) => (s as unknown as { name: string }).name),
      ['zombie'],
    );
    assert.deepEqual(events, ['ping:zombie'], 'a dead socket is not pinged again');
  });

  it('keeps a socket that answered', () => {
    const events: string[] = [];
    const socket = fakeSocket('b', events);
    heartbeatTick([socket]);
    socket.isAlive = true; // the pong arrived
    const dead = heartbeatTick([socket]);
    assert.deepEqual(dead, []);
    assert.deepEqual(events, ['ping:b', 'ping:b']);
  });

  it('treats a socket that throws on ping as gone', () => {
    const broken: HeartbeatSocket = {
      isAlive: true,
      ping() {
        throw new Error('closed');
      },
      terminate() {},
    };
    assert.deepEqual(heartbeatTick([broken]), [broken]);
  });

  it('handles an empty set', () => {
    assert.deepEqual(heartbeatTick([]), []);
  });
});
