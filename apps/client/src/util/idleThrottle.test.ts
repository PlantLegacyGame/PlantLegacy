import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldIdleRender } from './idleThrottle.ts';

describe('idle drop', () => {
  it('waits for the full timeout', () => {
    assert.equal(shouldIdleRender(29_999, 0, 30_000), false);
    assert.equal(shouldIdleRender(30_000, 0, 30_000), true);
  });

  it('is off when the timeout is zero or unusable', () => {
    assert.equal(shouldIdleRender(1_000_000, 0, 0), false);
    assert.equal(shouldIdleRender(1_000_000, 0, Number.NaN), false);
  });

  it('does not idle on a clock that went backwards', () => {
    // A non-finite or negative gap must not read as "idle forever": a wrong
    // clock is not a reason to drop the frame rate.
    assert.equal(shouldIdleRender(Number.NaN, 0, 30_000), false);
    assert.equal(shouldIdleRender(1_000, Number.NaN, 30_000), false);
    assert.equal(shouldIdleRender(1_000, 2_000, 30_000), false);
  });
});
