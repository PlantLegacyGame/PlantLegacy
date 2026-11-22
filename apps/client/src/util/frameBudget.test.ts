import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FrameBudget, frameStatsOf } from './frameBudget.ts';

describe('the frame budget', () => {
  it('reports nothing until a frame is recorded', () => {
    assert.deepEqual(new FrameBudget(10).stats(), {
      frames: 0,
      fps: 0,
      p50Ms: 0,
      p95Ms: 0,
      worstMs: 0,
      longFrames: 0,
    });
    assert.deepEqual(new FrameBudget(10).costStats(), {
      frames: 0,
      p50Ms: 0,
      p95Ms: 0,
      worstMs: 0,
    });
  });

  it('records pacing and cost separately, and merges them once', () => {
    // 33 ms frames with 2 ms of our code: the GPU is the limit, not the loop.
    const budget = new FrameBudget(10);
    for (let i = 0; i < 10; i += 1) {
      budget.record(33.3);
      budget.recordCost(2);
    }
    const stats = frameStatsOf(budget);
    assert.equal(stats.fps, 30);
    assert.ok(stats.p50Ms > 33 && stats.p50Ms < 34);
    assert.equal(stats.longFrames, 10);
    assert.equal(stats.cpuP50Ms, 2, 'our own work in that frame');
    assert.equal(stats.cpuFrames, 10);
    assert.equal(stats.cpuWorstMs, 2);
    assert.equal(stats.gpuMs, null, 'no driver timing was supplied');
  });

  it('reports the GPU cost next to our own', () => {
    const budget = new FrameBudget(10);
    budget.record(33.3);
    budget.recordCost(2);
    const stats = frameStatsOf(budget, 29.4);
    assert.equal(stats.cpuP50Ms, 2);
    assert.equal(stats.gpuMs, 29.4);
    assert.equal(frameStatsOf(budget, Number.NaN).gpuMs, null, 'a bad reading is no reading');
    assert.equal(frameStatsOf(budget, 0).gpuMs, null);
  });

  it('keeps cost when no interval was recorded, which is a hidden tab', () => {
    const budget = new FrameBudget(10);
    budget.recordCost(4);
    budget.recordCost(6);
    assert.equal(budget.stats().frames, 0, 'nothing animated');
    const stats = frameStatsOf(budget);
    assert.equal(stats.fps, 0);
    assert.equal(stats.cpuFrames, 2);
    assert.equal(stats.cpuP95Ms, 6);
  });

  it('keeps only the newest samples in its window', () => {
    const budget = new FrameBudget(4);
    for (const interval of [100, 100, 100, 100, 16, 16, 16, 16]) budget.record(interval);
    const stats = budget.stats();
    assert.equal(stats.frames, 4);
    assert.equal(stats.fps, 63, 'the slow start has rolled out of the window');
    assert.equal(stats.worstMs, 16);
  });

  it('counts frames that missed a 60 Hz vsync as long', () => {
    const budget = new FrameBudget(10);
    budget.record(16.7);
    budget.record(24);
    budget.record(33.3);
    assert.equal(budget.stats().longFrames, 1, 'only the frame past the half-vsync threshold');
  });

  it('ignores a sample that is not a real measurement', () => {
    const budget = new FrameBudget(4);
    budget.record(Number.NaN);
    budget.record(-5);
    budget.recordCost(Number.NaN);
    assert.equal(budget.stats().frames, 0);
    assert.equal(budget.costStats().frames, 0);
    budget.record(16);
    budget.recordCost(3);
    assert.equal(budget.stats().frames, 1);
    assert.equal(budget.costStats().frames, 1);
  });

  it('clears both rings on reset', () => {
    const budget = new FrameBudget(4);
    budget.record(16);
    budget.recordCost(3);
    budget.reset();
    assert.equal(budget.stats().frames, 0);
    assert.equal(budget.costStats().frames, 0);
  });
});
