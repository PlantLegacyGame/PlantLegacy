import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { solveGroundCeiling, stepLookUpPitch } from './cameraOrbit.ts';

const close = (a: number, b: number, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

const clearsBelow = (horizon: number) => (angle: number) => angle <= horizon;

describe('looking up off the ground', () => {
  const base = { upDragRad: 0, maxRad: 1.31, decayPerSecond: 4, deltaTimeS: 0.016 };

  it('spends an upward drag the ceiling swallowed as pitch on the camera', () => {
    const once = stepLookUpPitch({ ...base, currentRad: 0, upDragRad: 0.08, atCeiling: true });
    assert.ok(close(once, 0.08));
    // The drag keeps pushing and the pitch keeps growing, instead of the view
    // stopping the moment the ground is touched.
    const twice = stepLookUpPitch({ ...base, currentRad: once, upDragRad: 0.08, atCeiling: true });
    assert.ok(close(twice, 0.16));
  });

  it('stops at its own ceiling', () => {
    const capped = stepLookUpPitch({
      ...base,
      currentRad: 1.3,
      upDragRad: 0.5,
      atCeiling: true,
    });
    assert.equal(capped, base.maxRad);
  });

  it('holds the pitch when idle or dragging down against the ceiling', () => {
    const held = stepLookUpPitch({ ...base, currentRad: 0.4, atCeiling: true });
    assert.ok(close(held, 0.4), 'an idle view against the ceiling must not drift back');
    const down = stepLookUpPitch({ ...base, currentRad: 0.4, upDragRad: -0.3, atCeiling: true });
    assert.ok(close(down, 0.4), "a downward drag at the ceiling is the orbit's, not the pitch's");
  });

  it('never returns a negative or over-ceiling pitch', () => {
    assert.equal(
      stepLookUpPitch({ ...base, currentRad: 0.5, atCeiling: false, deltaTimeS: 10 }),
      0,
      'a long free frame unwinds to the target, never past it',
    );
    assert.ok(
      stepLookUpPitch({ ...base, currentRad: 99, atCeiling: false }) <= base.maxRad,
      'a pitch above the ceiling starts from the ceiling, not from 99',
    );
  });

  it('unwinds once the orbit is free again', () => {
    const free = stepLookUpPitch({
      ...base,
      currentRad: 0.5,
      atCeiling: false,
      deltaTimeS: 0.1,
    });
    assert.ok(close(free, 0.1), 'a zoom out must not leave the camera staring at the sky');
  });
});

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
