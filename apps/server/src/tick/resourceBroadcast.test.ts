import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  broadcastResourceDeltas,
  type ResourceBroadcastPorts,
  type ResourceBroadcastState,
} from './resourceBroadcast.ts';

function createPorts(dirtyCount: number, overrides: Partial<ResourceBroadcastPorts> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const ports: ResourceBroadcastPorts = {
    dirtyTileCount: () => dirtyCount,
    dirtyTiles: () => {
      calls.push('dirtyTiles');
      return [{ x: 1, z: 2 }];
    },
    grid: () => ({ width: 4, height: 3, tileSize: 2 }),
    encodeWholeGrid: (tiles) => {
      calls.push('encode');
      return `packed:${tiles.length}`;
    },
    broadcast: (payload) => sent.push(payload),
    now: () => 10_000,
    ...overrides,
  };
  return { ports, sent, calls };
}

const input = { tick: 42, wholeGridThreshold: 1000, minIntervalMs: 1000 };
const fresh: ResourceBroadcastState = { lastWholeGridAt: 0, lastWholeGridBase64: null };

describe('broadcastResourceDeltas', () => {
  it('sends a small delta as a tile list', () => {
    const { ports, sent, calls } = createPorts(3);
    const state = broadcastResourceDeltas(ports, input, fresh);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]?.tiles, [{ x: 1, z: 2 }]);
    assert.equal(sent[0]?.gridBase64, undefined);
    assert.equal(sent[0]?.width, 4);
    assert.equal(state.lastWholeGridAt, 0);
    assert.deepEqual(calls, ['dirtyTiles']);
  });

  it('does nothing, and builds nothing, when no tile is dirty', () => {
    const { ports, sent, calls } = createPorts(0);
    const state = broadcastResourceDeltas(ports, input, fresh);
    assert.deepEqual(sent, []);
    assert.deepEqual(calls, []);
    assert.equal(state, fresh);
  });

  it('packs a whole-grid update and records when it went out', () => {
    const { ports, sent, calls } = createPorts(5000);
    const state = broadcastResourceDeltas(ports, input, fresh);
    assert.equal(sent[0]?.gridBase64, 'packed:1');
    assert.equal(sent[0]?.tiles, undefined);
    assert.equal(state.lastWholeGridAt, 10_000);
    assert.equal(state.lastWholeGridBase64, 'packed:1');
    assert.deepEqual(calls, ['dirtyTiles', 'encode']);
  });

  it('does not resend a whole grid whose packed bytes have not changed', () => {
    // The grid is quantised, so a re-tint of an unchanged field packs to the same
    // bytes. Resending those 192 KB cost the client a decoded texture upload and a
    // dropped frame every second.
    const { ports, sent } = createPorts(5000);
    const first = broadcastResourceDeltas(ports, input, fresh);
    const second = broadcastResourceDeltas({ ...ports, now: () => 11_000 }, input, first);
    assert.equal(sent.length, 1);
    // The clock still moves on: the encode stays on the throttle.
    assert.equal(second.lastWholeGridAt, 11_000);
    assert.equal(second.lastWholeGridBase64, 'packed:1');
  });

  it('sends the whole grid again once the packed bytes change', () => {
    let packed = 'packed:a';
    const { ports, sent } = createPorts(5000, { encodeWholeGrid: () => packed });
    const first = broadcastResourceDeltas(ports, input, fresh);
    packed = 'packed:b';
    const second = broadcastResourceDeltas({ ...ports, now: () => 11_000 }, input, first);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.gridBase64, 'packed:b');
    assert.equal(second.lastWholeGridBase64, 'packed:b');
  });

  it('throttles whole-grid updates to one per interval', () => {
    const { ports, sent } = createPorts(5000);
    const afterFirst = broadcastResourceDeltas(ports, input, fresh);
    const tooSoon = broadcastResourceDeltas(ports, input, afterFirst);
    assert.equal(sent.length, 1);
    assert.equal(tooSoon, afterFirst);

    const afterInterval = broadcastResourceDeltas(
      { ...ports, now: () => 11_000 },
      input,
      afterFirst,
    );
    assert.equal(afterInterval.lastWholeGridAt, 11_000);
  });

  it('never delays a small delta, even right after a whole-grid send', () => {
    const { ports, sent } = createPorts(2);
    const state = broadcastResourceDeltas(ports, input, {
      lastWholeGridAt: 9_999,
      lastWholeGridBase64: null,
    });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]?.tiles, [{ x: 1, z: 2 }]);
    assert.equal(state.lastWholeGridAt, 9_999);
  });
});
