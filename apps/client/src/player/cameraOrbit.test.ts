import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { solveGroundCeiling, stepLookUpPitch } from './cameraOrbit.ts';

const close = (a: number, b: number, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

const clearsBelow = (horizon: number) => (angle: number) => angle <= horizon;

describe('looking up off the ground', () => {
  const base = {
    targetRad: 0,
    appliedRad: 0,
    upDragRad: 0,
    maxRad: 1.31,
    gain: 0.55,
    decayPerSecond: 4,
    dampingFactor: 0.14,
    deltaTimeS: 0.016,
    atCeiling: true,
    travelM: 0,
    releaseAfterM: 1,
  };

  it('eases into the pitch instead of snapping to the drag', () => {
    // One frame of drag: the target takes the drag, the drawn pitch is still on
    // its way there. That is what keeps the handover from the orbit smooth - the
    // controls damp their own rotation by the same factor.
    const step = stepLookUpPitch({ ...base, upDragRad: 0.1 });
    assert.ok(close(step.targetRad, 0.055), `target ${step.targetRad}`);
    assert.ok(close(step.appliedRad, 0.055 * 0.14), `applied ${step.appliedRad}`);
    assert.ok(step.appliedRad < step.targetRad, 'the drawn pitch must lag the target');
  });

  it('settles on the target over a third of a second, like the orbit', () => {
    let state = { targetRad: 0, appliedRad: 0 };
    for (let frame = 0; frame < 22; frame += 1) {
      state = stepLookUpPitch({ ...base, ...state, upDragRad: frame === 0 ? 0.3 : 0 });
    }
    // 0.86^22 leaves under a tenth of the gap; the point is that it converges
    // rather than jumping, so the tolerance is a tenth of a degree.
    assert.ok(
      close(state.appliedRad, 0.3 * 0.55, 0.01),
      `after 22 frames the pitch is ${state.appliedRad}`,
    );
  });

  it('takes only part of the drag, so looking up is slower than orbiting', () => {
    // A full drag handed over at gain 1 raced: this is the sensitivity.
    const full = stepLookUpPitch({ ...base, gain: 1, upDragRad: 0.2 });
    const gentle = stepLookUpPitch({ ...base, gain: 0.5, upDragRad: 0.2 });
    assert.ok(close(full.targetRad, 0.2));
    assert.ok(close(gentle.targetRad, 0.1));
  });

  it('stops at its own ceiling', () => {
    const capped = stepLookUpPitch({ ...base, targetRad: 1.3, upDragRad: 5 });
    assert.equal(capped.targetRad, base.maxRad);
    assert.ok(capped.appliedRad <= base.maxRad);
  });

  it('holds while the framing has not moved, and ignores a downward drag at the ceiling', () => {
    // Letting go is not a release: the pose must survive with no input at all, or
    // the camera appears to correct itself after the player stops dragging.
    const held = stepLookUpPitch({
      ...base,
      targetRad: 0.4,
      appliedRad: 0.4,
      travelM: 0.9,
    });
    assert.ok(close(held.targetRad, 0.4), 'standing still must not unwind the view');
    const down = stepLookUpPitch({
      ...base,
      targetRad: 0.4,
      appliedRad: 0.4,
      upDragRad: -0.3,
    });
    assert.ok(close(down.targetRad, 0.4), "a downward drag at the ceiling is the orbit's");
  });

  it('keeps the pitch through a yaw that moved the ceiling', () => {
    // The ceiling is solved per azimuth, so turning on a slope drops it under the
    // eye and unlatches "at ceiling", with no drag of the player's. That used to
    // unwind the whole pitch and re-aim the camera at the plant: looking up, then
    // turning, ended up looking down at the player.
    for (const free of [false, true]) {
      const yawed = stepLookUpPitch({
        ...base,
        targetRad: 1.2,
        appliedRad: 1.2,
        atCeiling: !free,
        deltaTimeS: 0.016,
      });
      assert.ok(close(yawed.targetRad, 1.2), `target ${yawed.targetRad}`);
      assert.ok(close(yawed.appliedRad, 1.2), `applied ${yawed.appliedRad}`);
    }
  });

  it('holds indefinitely with no input, however long the player waits', () => {
    // The reported bug: look up near the plant, let go, and the view re-aimed
    // itself a second later for no reason. Ten seconds of still frames must not
    // move the pitch by a measurable amount.
    let state = { targetRad: 0.7, appliedRad: 0.7 };
    for (let frame = 0; frame < 600; frame += 1) {
      state = stepLookUpPitch({ ...base, ...state, travelM: 0 });
    }
    assert.ok(close(state.targetRad, 0.7), `target drifted to ${state.targetRad}`);
    assert.ok(close(state.appliedRad, 0.7, 1e-3), `applied drifted to ${state.appliedRad}`);
  });

  it('eases back once the framing point has moved', () => {
    // Walking or panning away is the release. Without it the pitch waited for a
    // downward drag forever, so leaving left the camera tilted at the sky.
    const released = stepLookUpPitch({
      ...base,
      targetRad: 1.0,
      appliedRad: 1.0,
      atCeiling: false,
      travelM: base.releaseAfterM + 0.2,
      deltaTimeS: 0.1,
    });
    assert.ok(close(released.targetRad, 0.6), `target ${released.targetRad}`);
    assert.ok(released.appliedRad < 1.0, 'the drawn pitch eases down after the target');
  });

  it('eases back at the ceiling too, so the sky view cannot stay stuck', () => {
    // The eye stays near the soil while the player walks off, so the orbit can
    // remain against its ceiling for the whole walk: gating the release on being
    // free would keep exactly the stuck view this fixes.
    const released = stepLookUpPitch({
      ...base,
      targetRad: 1.2,
      appliedRad: 1.2,
      atCeiling: true,
      travelM: 2,
      deltaTimeS: 0.1,
    });
    assert.ok(close(released.targetRad, 0.8), `target ${released.targetRad}`);
  });

  it('gives the pitch back on a downward drag', () => {
    const free = stepLookUpPitch({
      ...base,
      targetRad: 0.5,
      appliedRad: 0.5,
      atCeiling: false,
      upDragRad: -0.05,
      travelM: 0,
      deltaTimeS: 0.1,
    });
    assert.ok(close(free.targetRad, 0.1), `target ${free.targetRad}`);
    assert.ok(free.appliedRad > free.targetRad, 'the drawn pitch eases down behind the target');
    assert.equal(free.appliedRad <= 0.5, true);
  });

  it('never returns a negative, over-ceiling or NaN pitch', () => {
    const long = stepLookUpPitch({
      ...base,
      targetRad: 0.5,
      appliedRad: 0.5,
      atCeiling: false,
      upDragRad: -0.05,
      deltaTimeS: 10,
    });
    assert.equal(long.targetRad, 0);
    const high = stepLookUpPitch({
      ...base,
      targetRad: 99,
      appliedRad: 99,
      atCeiling: false,
      upDragRad: -0.05,
    });
    // Off the ceiling the overshoot decays from the cap rather than sitting on it.
    assert.ok(high.targetRad <= base.maxRad, `target ${high.targetRad}`);
    assert.ok(high.appliedRad <= base.maxRad, `applied ${high.appliedRad}`);
    assert.ok(
      high.appliedRad > base.maxRad - 0.02,
      `applied ${high.appliedRad} should ease off the cap`,
    );
    const nan = stepLookUpPitch({
      targetRad: Number.NaN,
      appliedRad: Number.NaN,
      upDragRad: Number.NaN,
      atCeiling: true,
      maxRad: 1,
      gain: Number.NaN,
      decayPerSecond: Number.NaN,
      dampingFactor: Number.NaN,
      deltaTimeS: Number.NaN,
      travelM: Number.NaN,
      releaseAfterM: Number.NaN,
    });
    assert.ok(Number.isFinite(nan.targetRad) && Number.isFinite(nan.appliedRad));
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
