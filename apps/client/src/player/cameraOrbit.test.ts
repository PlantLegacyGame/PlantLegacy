import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { solveGroundCeiling, stepLookUpPitch } from './cameraOrbit.ts';

const close = (a: number, b: number, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

const clearsBelow = (horizon: number) => (angle: number) => angle <= horizon;

describe('looking up off the ground', () => {
  const base = { releaseRad: 0, maxRad: 1.31, decayPerSecond: 4, deltaTimeS: 0.016 };

  it('spends rotation the polar ceiling swallowed as pitch on the camera', () => {
    const once = stepLookUpPitch({ ...base, currentRad: 0, blockedRad: 0.08, atCeiling: true });
    assert.ok(close(once, 0.08));
    // The drag keeps pushing and the pitch keeps growing, instead of the view
    // stopping the moment the ground is touched.
    const twice = stepLookUpPitch({ ...base, currentRad: once, blockedRad: 0.08, atCeiling: true });
    assert.ok(close(twice, 0.16));
  });

  it('stops at its own ceiling', () => {
    const capped = stepLookUpPitch({
      ...base,
      currentRad: 1.3,
      blockedRad: 0.5,
      atCeiling: true,
    });
    assert.equal(capped, base.maxRad);
  });

  it('holds the pitch while the player is not dragging', () => {
    const held = stepLookUpPitch({ ...base, currentRad: 0.4, blockedRad: 0, atCeiling: true });
    assert.ok(close(held, 0.4), 'an idle view against the ceiling must not drift back');
  });

  it('gives the pitch back when the drag turns downward', () => {
    const back = stepLookUpPitch({
      ...base,
      currentRad: 0.3,
      blockedRad: 0,
      releaseRad: 0.2,
      atCeiling: true,
    });
    assert.ok(close(back, 0.1));
    assert.equal(
      stepLookUpPitch({
        ...base,
        currentRad: 0.1,
        blockedRad: 0,
        releaseRad: 0.5,
        atCeiling: true,
      }),
      0,
      'a downward drag cannot push the view below the target',
    );
  });

  it('unwinds once the orbit is free again', () => {
    const free = stepLookUpPitch({
      ...base,
      currentRad: 0.5,
      blockedRad: 0,
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
