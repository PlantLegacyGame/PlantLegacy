import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { broadcastWeather } from './weatherBroadcast.ts';

const weather = { weatherState: 'rain', timeOfDay: 0.3 };

function createPorts() {
  const sent: Array<Record<string, unknown>> = [];
  return { sent, ports: { broadcast: (payload: Record<string, unknown>) => sent.push(payload) } };
}

const input = { tick: 7, dt: 1 / 20, sendRateHz: 2, accumulatorMs: 0, weather };

describe('broadcastWeather', () => {
  it('sends the tick and the weather state once the interval has elapsed', () => {
    const { ports, sent } = createPorts();
    // 50 ms of a 500 ms interval: not yet.
    const first = broadcastWeather(ports, { ...input, accumulatorMs: 0 });
    assert.equal(first.sent, 0);
    assert.equal(first.skipped, 1);
    assert.equal(first.nextAccumulatorMs, 50);

    const second = broadcastWeather(ports, { ...input, accumulatorMs: 500 - 50 + 10 });
    assert.equal(second.sent, 1);
    assert.deepEqual(sent[0], { tick: 7, weatherState: 'rain', timeOfDay: 0.3 });
  });

  it('holds a 2 Hz cadence from a 20 Hz tick: one message every ten ticks', () => {
    const { ports, sent } = createPorts();
    let accumulator = 0;
    for (let tick = 1; tick <= 20; tick += 1) {
      accumulator = broadcastWeather(ports, {
        ...input,
        tick,
        accumulatorMs: accumulator,
      }).nextAccumulatorMs;
    }
    assert.equal(sent.length, 2);
  });
});
