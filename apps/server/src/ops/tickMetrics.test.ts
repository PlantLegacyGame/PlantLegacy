import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TickMetrics } from './tickMetrics.ts';

describe('tick metrics', () => {
  it('summarises the window it has actually filled', () => {
    const metrics = new TickMetrics(10, 40);
    metrics.record({ activeMs: 10, nearMs: 2, dormantMs: 1, totalMs: 20 });
    metrics.record({ activeMs: 30, nearMs: 0, dormantMs: 0, totalMs: 40 });

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.samples, 2);
    assert.equal(snapshot.windowTicks, 10);
    assert.equal(snapshot.activeMs.avgMs, 20);
    assert.equal(snapshot.activeMs.maxMs, 30);
    assert.equal(snapshot.totalMs.maxMs, 40);
    assert.equal(snapshot.peakActiveShare, 0.75);
  });

  it('counts a tick as over budget only when Active work passed the threshold', () => {
    const metrics = new TickMetrics(4, 40);
    metrics.record({ activeMs: 39, nearMs: 30, dormantMs: 0, totalMs: 69 });
    metrics.record({ activeMs: 41, nearMs: 0, dormantMs: 0, totalMs: 41 });

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.overBudgetTicks, 1);
    // A long tick made of Near work is not an Active overrun.
    assert.equal(snapshot.totalMs.maxMs, 69);
  });

  it('keeps the last warning and counts warnings inside the window', () => {
    const metrics = new TickMetrics(5, 40);
    metrics.recordWarning({ activeShare: 0.9, activeMs: 45, totalMs: 50, tick: 7 });
    metrics.recordWarning({ activeMs: 60, totalMs: 61, tick: 8 });

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.budgetWarnings, 2);
    assert.deepEqual(snapshot.lastWarning, { activeMs: 60, totalMs: 61, tick: 8 });
  });

  it('overwrites the oldest sample instead of growing', () => {
    const metrics = new TickMetrics(3, 40);
    for (const ms of [10, 20, 30, 40]) {
      metrics.record({ activeMs: ms, nearMs: 0, dormantMs: 0, totalMs: ms });
    }
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.samples, 3);
    // 20/30/40 survive; the 10 ms sample fell out of the ring.
    assert.equal(snapshot.activeMs.avgMs, 30);
    assert.equal(snapshot.activeMs.maxMs, 40);
  });

  it('reports empty summaries before the first tick rather than NaN', () => {
    const metrics = new TickMetrics(5, 40);
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.samples, 0);
    assert.deepEqual(snapshot.activeMs, { avgMs: 0, maxMs: 0 });
    assert.equal(snapshot.peakActiveShare, 0);
  });
});
