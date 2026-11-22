import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FrameBudget } from './frameBudget.ts';

describe('the frame budget', () => {
  it('reports nothing until a frame is recorded', () => {
    assert.deepEqual(new FrameBudget(10).stats(), {
      frames: 0,
      fps: 0,
      p50Ms: 0,
      p95Ms: 0,
      worstMs: 0,
      cpuP50Ms: 0,
      cpuP95Ms: 0,
      longFrames: 0,
    });
  });

  it('separates a GPU-bound frame from our own work in the same frame', () => {
    // 33 ms frames with 2 ms of our code: the GPU is the limit, not the loop.
    const gpuBound = new FrameBudget(10);
    for (let i = 0; i < 10; i += 1) gpuBound.record(33.3, 2);
    const gpu = gpuBound.stats();
    assert.equal(gpu.fps, 30);
    assert.ok(gpu.p50Ms > 33 && gpu.p50Ms < 34);
    assert.equal(gpu.cpuP50Ms, 2, 'our own work in that frame');
    assert.equal(gpu.longFrames, 10);

    const cpuBound = new FrameBudget(10);
    for (let i = 0; i < 10; i += 1) cpuBound.record(33.3, 30);
    assert.equal(cpuBound.stats().cpuP50Ms, 30);
  });

  it('keeps only the newest samples in its window', () => {
    const budget = new FrameBudget(4);
    for (const interval of [100, 100, 100, 100, 16, 16, 16, 16]) budget.record(interval, 1);
    const stats = budget.stats();
    assert.equal(stats.frames, 4);
    assert.equal(stats.fps, 63, 'the slow start has rolled out of the window');
    assert.equal(stats.worstMs, 16);
  });

  it('counts frames that missed a 60 Hz vsync as long', () => {
    const budget = new FrameBudget(10);
    budget.record(16.7, 1);
    budget.record(24, 1);
    budget.record(33.3, 1);
    assert.equal(budget.stats().longFrames, 1, 'only the frame past the half-vsync threshold');
  });

  it('ignores a sample that is not a real measurement', () => {
    const budget = new FrameBudget(4);
    budget.record(Number.NaN, 1);
    budget.record(-5, 1);
    budget.record(16, Number.NaN);
    assert.equal(budget.stats().frames, 0);
    budget.record(16, 1);
    assert.equal(budget.stats().frames, 1);
  });

  it('clears on reset', () => {
    const budget = new FrameBudget(4);
    budget.record(16, 1);
    budget.reset();
    assert.equal(budget.stats().frames, 0);
  });
});
