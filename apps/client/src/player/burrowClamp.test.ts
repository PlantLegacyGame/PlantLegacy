import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampToCavity, isInsideCavityColumn } from './burrowClamp.ts';

const CAVITY = { x: 3, z: -2, radius: 2 };

describe('burrow clamp', () => {
  it('leaves an eye inside the cavity exactly where it is', () => {
    assert.equal(clampToCavity({ x: 3.5, z: -2.5 }, CAVITY, 0.2), null);
  });

  it('keeps the configured clearance from the wall', () => {
    const clamped = clampToCavity({ x: 3 + 5, z: -2 }, CAVITY, 0.2);
    assert.ok(clamped);
    assert.ok(Math.abs(clamped.x - (3 + 1.8)) < 1e-9, `x was ${clamped.x}`);
    assert.ok(Math.abs(clamped.z + 2) < 1e-9);
  });

  it('pulls towards the centre along the eye’s own direction', () => {
    // Not the nearest point on the circle: the eye keeps the azimuth it had, so
    // the picture swings inwards instead of jumping sideways.
    const clamped = clampToCavity({ x: 3 + 3, z: -2 + 4 }, CAVITY, 0);
    assert.ok(clamped);
    const away = Math.hypot(clamped.x - 3, clamped.z + 2);
    assert.ok(Math.abs(away - 2) < 1e-9, `distance was ${away}`);
    assert.ok(Math.abs(clamped.z - (-2 + 4 * 0.4)) < 1e-9);
  });

  it('never inverts when the clearance is wider than the hole', () => {
    const clamped = clampToCavity({ x: 9, z: -2 }, { ...CAVITY, radius: 0.05 }, 1);
    assert.ok(clamped);
    assert.ok(clamped.x < 9, 'an eye outside a tiny cavity was pushed further out');
    assert.ok(Math.abs(clamped.x - (3 + 0.1)) < 1e-9);
  });

  it('does nothing without an aperture', () => {
    assert.equal(clampToCavity({ x: 99, z: 99 }, { ...CAVITY, radius: 0 }, 0.2), null);
  });

  it('does nothing for a position that is not a number', () => {
    assert.equal(clampToCavity({ x: Number.NaN, z: 0 }, CAVITY, 0.2), null);
  });
});

describe('the opening is the only underground space', () => {
  it('counts an eye inside the column, with the clearance taken off', () => {
    assert.equal(isInsideCavityColumn({ x: 3.5, z: -2.5 }, CAVITY, 0.2), true);
    assert.equal(isInsideCavityColumn({ x: 3 + 1.5, z: -2 }, CAVITY, 0.2), true);
  });

  it('does not count an eye beside the pit', () => {
    // This is the case the camera has to lift back to the surface: beside the
    // opening the dirt is real, and clamping the eye into the pit instead is
    // what left a buried view stuck below the plant.
    assert.equal(isInsideCavityColumn({ x: 3 + 3, z: -2 }, CAVITY, 0.2), false);
    // 0.8 m aperture less the 0.2 m clearance leaves 0.6 m of column.
    assert.equal(
      isInsideCavityColumn({ x: 3, z: -2 + 0.5 }, { ...CAVITY, radius: 0.8 }, 0.2),
      true,
    );
    assert.equal(
      isInsideCavityColumn({ x: 3, z: -2 + 0.5 }, { ...CAVITY, radius: 0.3 }, 0.2),
      false,
    );
  });

  it('has no column without an aperture', () => {
    assert.equal(isInsideCavityColumn({ x: 3, z: -2 }, { ...CAVITY, radius: 0 }, 0.2), false);
  });
});
