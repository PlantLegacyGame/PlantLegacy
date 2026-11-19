import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampParallax,
  layerOffset,
  parallaxAtRest,
  parallaxTarget,
  stepParallax,
} from './parallax.ts';

const config = { enabled: true, dragPx: 90, hover: 0.35 };

describe('title parallax', () => {
  it('clamps a drag to the configured travel', () => {
    assert.deepEqual(clampParallax({ x: 500, y: -500 }, 90), { x: 90, y: -90 });
    assert.deepEqual(clampParallax({ x: 12, y: 8 }, 90), { x: 12, y: 8 });
  });

  it('lets a drag override the pointer while it is held', () => {
    const target = parallaxTarget({ x: 40, y: 0 }, { x: -90, y: 20 }, config);
    assert.deepEqual(target, { x: 40, y: 0 });
  });

  it('follows a fraction of the pointer when idle', () => {
    assert.deepEqual(parallaxTarget(null, { x: 200, y: 100 }, config), { x: 70, y: 35 });
  });

  it('rests at the origin with no pointer and no drag', () => {
    assert.deepEqual(parallaxTarget(null, null, config), { x: 0, y: 0 });
    assert.equal(parallaxAtRest(parallaxTarget(null, null, config)), true);
  });

  it('does nothing at all when disabled', () => {
    assert.deepEqual(
      parallaxTarget({ x: 40, y: 40 }, { x: 90, y: 90 }, { ...config, enabled: false }),
      {
        x: 0,
        y: 0,
      },
    );
  });

  it('eases toward the target without overshooting', () => {
    let state = { x: 0, y: 0 };
    for (let i = 0; i < 40; i += 1) {
      state = stepParallax(state, { x: 90, y: 0 }, 16, 420);
      assert.ok(state.x >= 0 && state.x <= 90, `x out of range: ${state.x}`);
    }
    assert.ok(state.x > 85, `should be nearly there, got ${state.x}`);
  });

  it('snaps when the settle time is zero', () => {
    assert.deepEqual(stepParallax({ x: 0, y: 0 }, { x: 90, y: 45 }, 16, 0), { x: 90, y: 45 });
  });

  it('scales each layer by its depth, far layers moving least', () => {
    const state = { x: 100, y: 100 };
    const sky = layerOffset(state, 0.15);
    const near = layerOffset(state, 1);
    assert.ok(Math.abs(sky.x) < Math.abs(near.x));
    assert.deepEqual(near, { x: -100, y: -50 });
  });
});
