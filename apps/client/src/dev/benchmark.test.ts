import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type BenchmarkPose,
  BenchmarkRunner,
  DEFAULT_BENCHMARK_POSES,
  percentile,
} from './benchmark.ts';

const POSES: BenchmarkPose[] = [
  { id: 'a', distanceM: 5, azimuthDeg: 0, elevationDeg: 0, targetLiftM: 0 },
  { id: 'b', distanceM: 10, azimuthDeg: 90, elevationDeg: 10, targetLiftM: 1 },
];

const CONFIG = { poses: POSES, warmupMs: 100, poseMs: 200 };

test('percentile uses nearest rank', () => {
  const values = [1, 2, 3, 4, 5];
  assert.equal(percentile(values, 50), 3);
  assert.equal(percentile(values, 95), 5);
  assert.equal(percentile(values, 0), 1);
  assert.equal(percentile([], 50), 0);
});

test('warm-up frames are discarded and each pose is measured', () => {
  const applied: string[] = [];
  const runner = new BenchmarkRunner({
    ...CONFIG,
    applyPose: (pose) => applied.push(pose.id),
  });
  runner.start(0);
  assert.deepEqual(applied, ['a']);
  // Warm-up: discarded.
  runner.tick(50, { frameMs: 99, gpuMs: null, triangles: 1, drawCalls: 1 });
  // Measured frames in pose a.
  runner.tick(150, { frameMs: 10, gpuMs: 12, triangles: 100, drawCalls: 2 });
  runner.tick(250, { frameMs: 20, gpuMs: 14, triangles: 100, drawCalls: 2 });
  // Crossing the pose window applies pose b.
  runner.tick(320, { frameMs: 8, gpuMs: null, triangles: 50, drawCalls: 1 });
  assert.deepEqual(applied, ['a', 'b']);
  // Pose b's own warm-up window has passed by now, so this frame is measured.
  runner.tick(500, { frameMs: 8, gpuMs: null, triangles: 50, drawCalls: 1 });
  const report = runner.stop(600);
  assert.ok(report);
  assert.equal(report?.poses.length, 2);
  assert.equal(report?.poses[0].samples, 2);
  assert.equal(report?.poses[0].maxFrameMs, 20);
  assert.equal(report?.poses[0].avgGpuMs, 13);
  assert.equal(report?.poses[1].samples, 1);
  assert.equal(report?.gpuMeasured, true);
});

test('the run finishes after the last pose and calls back once', () => {
  let finished = 0;
  const runner = new BenchmarkRunner({
    ...CONFIG,
    applyPose: () => undefined,
    onFinish: () => {
      finished += 1;
    },
  });
  runner.start(0);
  runner.tick(150, { frameMs: 10, gpuMs: null, triangles: 1, drawCalls: 1 });
  // 301 ms ends pose a, so this tick advances to pose b and is not the end.
  assert.equal(runner.tick(301, { frameMs: 10, gpuMs: null, triangles: 1, drawCalls: 1 }), false);
  const done = runner.tick(602, { frameMs: 10, gpuMs: null, triangles: 1, drawCalls: 1 });
  assert.equal(done, true);
  assert.equal(runner.isRunning, false);
  assert.equal(finished, 1);
  // Ticking after the run does nothing.
  runner.tick(400, { frameMs: 10, gpuMs: null, triangles: 1, drawCalls: 1 });
  assert.equal(finished, 1);
});

test('the default set has six distinct poses', () => {
  assert.equal(DEFAULT_BENCHMARK_POSES.length, 6);
  const ids = new Set(DEFAULT_BENCHMARK_POSES.map((pose) => pose.id));
  assert.equal(ids.size, 6);
});
