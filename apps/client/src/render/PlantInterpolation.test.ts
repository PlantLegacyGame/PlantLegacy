import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolationDurationMs, NodeInterpolator } from './PlantInterpolation.ts';

const OUT = { x: 0, y: 0, z: 0 };

test('a captured position is reached at the end of the segment', () => {
  const lerp = new NodeInterpolator();
  lerp.capture('a', 0, 0, 0, 1000, 100);
  assert.equal(lerp.sample('a', 1000, OUT), true);
  assert.equal(OUT.x, 0);
  lerp.capture('a', 10, 0, 0, 1000, 100);
  assert.equal(lerp.sample('a', 1050, OUT), true);
  assert.ok(Math.abs(OUT.x - 5) < 1e-9);
  lerp.sample('a', 1200, OUT);
  assert.equal(OUT.x, 10);
});

test('a new packet starts from the currently drawn point, not the old target', () => {
  const lerp = new NodeInterpolator();
  lerp.capture('a', 0, 0, 0, 0, 100);
  lerp.capture('a', 10, 0, 0, 0, 100);
  // Halfway through the first segment: drawn at x = 5.
  lerp.sample('a', 50, OUT);
  assert.ok(Math.abs(OUT.x - 5) < 1e-9);
  // A second packet arrives: the new segment must begin at 5, so there is no
  // snap back to 0 or 10.
  lerp.capture('a', 20, 0, 0, 50, 100);
  lerp.sample('a', 50, OUT);
  assert.ok(Math.abs(OUT.x - 5) < 1e-9);
  lerp.sample('a', 150, OUT);
  assert.ok(Math.abs(OUT.x - 20) < 1e-9);
});

test('sample reports an unknown id instead of inventing a position', () => {
  const lerp = new NodeInterpolator();
  assert.equal(lerp.sample('missing', 0, OUT), false);
});

test('non-finite positions are rejected', () => {
  const lerp = new NodeInterpolator();
  lerp.capture('a', Number.NaN, 0, 0, 0, 100);
  assert.equal(lerp.size, 0);
});

test('prune keeps only the requested ids', () => {
  const lerp = new NodeInterpolator();
  lerp.capture('a', 0, 0, 0, 0, 100);
  lerp.capture('b', 0, 0, 0, 0, 100);
  lerp.prune(new Set(['b']));
  assert.equal(lerp.size, 1);
  assert.equal(lerp.sample('a', 0, OUT), false);
});

test('the segment lasts one server tick, clamped', () => {
  assert.equal(interpolationDurationMs(20), 50);
  assert.equal(interpolationDurationMs(5), 200);
  assert.equal(interpolationDurationMs(1), 250);
  assert.equal(interpolationDurationMs(0), 50);
});
