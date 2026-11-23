import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cavityEscapeLiftY,
  clampToCavity,
  isInsideCavityColumn,
  raiseEyeWithAim,
} from './burrowClamp.ts';

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

describe('cavity escape', () => {
  it('lifts a buried eye while the player looks up', () => {
    assert.equal(cavityEscapeLiftY(-3, 0, 0.8, 0.5, 2), -2);
  });

  it('never rises above the surface', () => {
    assert.equal(cavityEscapeLiftY(-0.2, 0, 0.9, 1, 10), 0);
  });

  it('does nothing when the player is not looking up', () => {
    assert.equal(cavityEscapeLiftY(-3, 0, -0.2, 1, 2), -3);
  });

  it('does nothing for an eye already above the surface', () => {
    assert.equal(cavityEscapeLiftY(1.5, 0, 0.9, 1, 2), 1.5);
  });

  it('ignores a nonsensical rate', () => {
    assert.equal(cavityEscapeLiftY(-3, 0, 0.9, 1, Number.NaN), -3);
  });

  it('raises the aim with the eye, so the orbit distance is unchanged', () => {
    // Lifting the eye alone shrinks its orbit ray, and the orbit floor pushes it
    // back out along that ray - straight down, into the pit. The camera bounced
    // into the seed and out on alternate frames.
    const raised = raiseEyeWithAim(-3, -1.5, 0.4);
    assert.equal(raised.eyeY, -2.6);
    assert.equal(raised.aimY, -1.1);
    assert.equal(raised.aimY - raised.eyeY, -1.5 - -3);
  });

  it('moves nothing for a zero or nonsensical lift', () => {
    assert.deepEqual(raiseEyeWithAim(-3, -1.5, 0), { eyeY: -3, aimY: -1.5 });
    assert.deepEqual(raiseEyeWithAim(-3, -1.5, Number.NaN), { eyeY: -3, aimY: -1.5 });
  });
});

describe('the aperture soil body hold', () => {
  it('keeps a buried eye inside the body, not just the opening', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'main.ts'),
      'utf8',
    );
    // The lock: outside the body's footprint there is no earth in the world, only
    // the ground sheet's back, so an eye under the surface there sees a brown plane
    // at arm's length instead of the pit.
    assert.match(
      source,
      /if \(bodyHold\) \{\s*camera\.position\.x = bodyHold\.x;\s*camera\.position\.z = bodyHold\.z;\s*\}/,
    );
    assert.match(source, /radius: apertureSoilHoldRadiusM\(radius\)/);
    // And it has to run before the opening's own gate: the eye it catches is by
    // definition not over the opening, so a later clamp would never see it.
    const hold = source.indexOf('apertureSoilHoldRadiusM(radius)');
    const gate = source.indexOf('if (!eyeOverAperture()) return;');
    assert.ok(hold > 0 && gate > 0, 'the hold or the gate is missing');
    assert.ok(hold < gate, "the body hold runs after the opening's gate and never fires");
  });
});
