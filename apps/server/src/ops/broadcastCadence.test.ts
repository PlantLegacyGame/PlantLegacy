import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cadenceIntervalMs, stepCadence } from './broadcastCadence.ts';

describe('broadcast cadence', () => {
  it('sends every tick when the wire rate equals the tick rate', () => {
    let accumulator = 0;
    let sends = 0;
    for (let i = 0; i < 20; i += 1) {
      const step = stepCadence(accumulator, 50, 20);
      accumulator = step.nextAccumulatorMs;
      if (step.due) sends += 1;
    }
    assert.equal(sends, 20);
  });

  it('sends at the configured wire rate when the tick is faster', () => {
    let accumulator = 0;
    let sends = 0;
    // 60 Hz ticks, 20 Hz wire: one send every three ticks.
    for (let i = 0; i < 60; i += 1) {
      const step = stepCadence(accumulator, 1000 / 60, 20);
      accumulator = step.nextAccumulatorMs;
      if (step.due) sends += 1;
    }
    assert.equal(sends, 20);
  });

  it('carries the remainder instead of rounding up to a whole tick', () => {
    // 30 Hz ticks cannot land exactly on a 20 Hz cadence every tick; over one
    // second the count must still be 20, not 15 or 30.
    let accumulator = 0;
    let sends = 0;
    for (let i = 0; i < 30; i += 1) {
      const step = stepCadence(accumulator, 1000 / 30, 20);
      accumulator = step.nextAccumulatorMs;
      if (step.due) sends += 1;
    }
    assert.equal(sends, 20);
  });

  it('treats a non-positive rate as one send per second rather than dividing by zero', () => {
    assert.equal(cadenceIntervalMs(0), 1000);
    const step = stepCadence(0, 1001, 0);
    assert.equal(step.due, true);
    assert.ok(step.nextAccumulatorMs < 1000);
  });

  it('never sends on a zero-length frame', () => {
    const step = stepCadence(999, 0, 20);
    assert.equal(step.due, false);
    assert.equal(step.nextAccumulatorMs, 999);
  });
});
