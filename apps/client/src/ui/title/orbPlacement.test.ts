import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ArcBox,
  arcHeight,
  arcInset,
  orbScreenPx,
  quantArcHeight,
  quantArcInset,
  smoothOrbOffset,
} from './orbPlacement.ts';

const box: ArcBox = { w: 1000, h: 600, clamp: 40 };

const close = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance;

describe('title orb placement', () => {
  it('lays a body out between five and ninety-five per cent of the arc', () => {
    assert.equal(arcInset(0), 5);
    assert.equal(arcInset(1), 95);
    assert.equal(arcInset(0.5), 50);
    // Out-of-range input from a body that is down is clamped, not extrapolated.
    assert.equal(arcInset(-2), 5);
    assert.equal(arcInset(7), 95);
    assert.equal(arcHeight(-1), 0);
    assert.equal(arcHeight(4), 1);
  });

  it('quantises the layout to about two pixels of a thousand-pixel arc', () => {
    assert.equal(quantArcInset(0.5), 50);
    assert.ok(Math.abs(quantArcInset(0.501) - 50) <= 0.25 + 1e-9);
    assert.ok(Math.abs(quantArcHeight(0.3333) - 0.3325) <= 0.0025 + 1e-9);
  });

  it('puts the layout step and the smooth translate on the same body position', () => {
    // A body a little past the step it was last laid out at.
    const body = { x: 0.4321, y: 0.6543 };
    const laidOutInset = quantArcInset(body.x);
    const laidOutHeight = quantArcHeight(body.y);
    const offset = smoothOrbOffset(laidOutInset, laidOutHeight, body, box);
    const drawn = orbScreenPx(laidOutInset, laidOutHeight, box);

    assert.ok(
      close(
        drawn.x + offset.dx,
        orbScreenPx(arcInset(0), arcHeight(body.y), box).x +
          ((arcInset(body.x) - arcInset(0)) / 100) * box.w,
        1e-6,
      ),
    );
    // The composition is exactly the raw position, not a step off it.
    const rawX = Math.min(box.w - box.clamp, Math.max(box.clamp, (arcInset(body.x) / 100) * box.w));
    assert.ok(close(drawn.x + offset.dx, rawX, 1e-9));
    assert.ok(close(drawn.y + offset.dy, (1 - arcHeight(body.y)) * box.h, 1e-9));
  });

  it('would double the last layout step if the translate were written before the layout', () => {
    // The regression this module exists for. Frame N: the disc is laid out at
    // step A and its translate is written against A. Then the layout moves to
    // step B without the translate being recomputed - which is what running the
    // layout after the smooth pass does. The disc is now a whole step past the
    // body, and the next frame pulls it back: the jerk.
    const first = { x: 0.4, y: 0.5 };
    // 0.4035 crosses a quarter-per-cent layout step from 0.4 on a 90% arc: a
    // whole step of travel, which is the jump the old order produced.
    const second = { x: 0.4035, y: 0.5 };
    const laidOutFirst = quantArcInset(first.x);
    const laidOutSecond = quantArcInset(second.x);
    const heightFirst = quantArcHeight(first.y);
    const heightSecond = quantArcHeight(second.y);

    const staleOffset = smoothOrbOffset(laidOutFirst, heightFirst, second, box);
    const wrongOrderX = orbScreenPx(laidOutSecond, heightSecond, box).x + staleOffset.dx;
    const correctX =
      orbScreenPx(laidOutSecond, heightSecond, box).x +
      smoothOrbOffset(laidOutSecond, heightSecond, second, box).dx;

    assert.ok(Math.abs(wrongOrderX - correctX) > 0.5, 'the stale order should differ visibly');
    assert.ok(close(correctX, orbScreenPx(arcInset(second.x), arcHeight(second.y), box).x, 1e-6));
  });

  it('does not put a body under the CSS clamp off its own position', () => {
    // A body near the edge is clamped by CSS; the offset must be measured in that
    // same clamped space, or a rising sun drifts as it clears the clamp. A narrow
    // arc is where the 5% inset lands inside the disc's own clamp.
    const narrow: ArcBox = { w: 600, h: 400, clamp: 40 };
    const body = { x: 0, y: 0.05 };
    const offset = smoothOrbOffset(quantArcInset(0), quantArcHeight(0), body, narrow);
    const drawn = orbScreenPx(quantArcInset(0), quantArcHeight(0), narrow);
    assert.ok(close(drawn.x + offset.dx, narrow.clamp, 1e-9));
  });
});
