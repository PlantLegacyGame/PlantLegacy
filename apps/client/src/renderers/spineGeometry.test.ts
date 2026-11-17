import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSpineGeometry } from './plant/spineGeometry.ts';

test('a spiny epidermal look builds thorn geometry', () => {
  const geometry = buildSpineGeometry(0.06, 0.04, 0.8, 0.85);
  assert.ok(geometry, 'expected thorn geometry');
  const positions = geometry?.getAttribute('position');
  const index = geometry?.getIndex();
  assert.ok(positions && positions.count > 0);
  assert.ok(index && index.count > 0);
  // The array is what the segment transform expects: a unit-ish thorn length
  // scaled by the segment radius, never kilometres.
  for (let i = 0; i < positions.count; i += 1) {
    assert.ok(Number.isFinite(positions.getX(i)));
    assert.ok(Math.abs(positions.getY(i)) < 1.5, 'thorns stay near the tube');
  }
  for (let i = 0; i < index.count; i += 1) {
    assert.ok(index.getX(i) < positions.count);
  }
});

test('no density means no geometry, and a vanishing segment is skipped', () => {
  assert.equal(buildSpineGeometry(0.06, 0.04, 0.8, 0), null);
  assert.equal(buildSpineGeometry(0.06, 0.04, 0.001, 1), null);
});
