import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boltPoints } from './lightningBolt.ts';

describe('boltPoints', () => {
  it('starts at the impact and ends in the sky', () => {
    const points = boltPoints(70, 4, () => 0.5);
    assert.equal(points.length, 5);
    assert.deepEqual([points[0].x, points[0].y, points[0].z], [0, 0, 0]);
    assert.equal(points[4].y, 70);
    // The top joint stays on the line: only mid-air joints wander.
    assert.equal(points[4].x, 0);
    assert.equal(points[4].z, 0);
  });

  it('wanders off the line in the middle, so it reads as lightning', () => {
    const points = boltPoints(70, 4, () => 1);
    for (let i = 1; i < points.length - 1; i += 1) {
      assert.ok(Math.abs(points[i].x) > 0, `joint ${i} sits on the pillar`);
    }
  });

  it('keeps every joint inside the jitter band', () => {
    for (const r of [0, 0.25, 0.75, 1]) {
      for (const point of boltPoints(70, 4, () => r)) {
        assert.ok(Math.abs(point.x) <= 4.4 + 1e-9);
        assert.ok(Math.abs(point.z) <= 4.4 + 1e-9);
      }
    }
  });

  it('rises monotonically, so the column never doubles back', () => {
    const points = boltPoints(70, 4, () => 0.9);
    for (let i = 1; i < points.length; i += 1) {
      assert.ok(points[i].y > points[i - 1].y);
    }
  });

  it('survives a segment count of one', () => {
    const points = boltPoints(10, 1, () => 0.5);
    assert.equal(points.length, 2);
    assert.equal(points[1].y, 10);
  });
});
