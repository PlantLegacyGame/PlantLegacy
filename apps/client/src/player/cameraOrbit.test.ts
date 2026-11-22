import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { solveGroundCeiling } from './cameraOrbit.ts';

const close = (a: number, b: number, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

const clearsBelow = (horizon: number) => (angle: number) => angle <= horizon;

describe('ground ceiling solve', () => {
  it('finds the horizon a slope puts in the way', () => {
    const angle = solveGroundCeiling({
      floorRad: 0.06,
      limitRad: 3.1,
      clears: clearsBelow(2.15),
    });
    assert.ok(Math.abs(angle - 2.15) < 0.01, `angle ${angle}`);
  });

  it('keeps the configured limit on ground that never blocks it', () => {
    assert.ok(
      close(solveGroundCeiling({ floorRad: 0.06, limitRad: 3.1, clears: () => true }), 3.1),
    );
  });

  it('stops at the first blocked angle instead of climbing over the ridge', () => {
    // Clear to 2.15 rad, blocked across the hillside, clear again past the ridge
    // at 2.9 rad: the two-answer slope that made the old fixed-point pass hop.
    const angle = solveGroundCeiling({
      floorRad: 0.06,
      limitRad: 3.1,
      clears: (a) => a <= 2.15 || a >= 2.9,
    });
    assert.ok(angle > 2.14 && angle < 2.2, `angle ${angle}`);
  });

  it('returns the floor when even the floor is buried', () => {
    assert.ok(
      close(solveGroundCeiling({ floorRad: 0.9, limitRad: 3.0, clears: () => false }), 0.9),
    );
  });

  it('never returns a NaN angle for degenerate bounds', () => {
    const angle = solveGroundCeiling({
      floorRad: Number.NaN,
      limitRad: Number.NaN,
      clears: () => true,
    });
    assert.ok(Number.isFinite(angle), `angle ${angle}`);
    assert.ok(close(solveGroundCeiling({ floorRad: 2, limitRad: 1, clears: () => false }), 2));
  });
});
