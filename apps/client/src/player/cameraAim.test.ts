import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aimLiftY, LOOK_UP_MAX_DEG } from './cameraAim.ts';

const close = (a: number, b: number, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;
const DEG = Math.PI / 180;

describe('camera aim lift', () => {
  it('aims straight at the target when the eye is at head height', () => {
    assert.equal(aimLiftY({ eyeY: 1.6, targetY: 0, headY: 1.6, horizontalM: 3, offsetYM: 0 }), 0);
  });

  it('lifts a level orbit at the soil by the capped pitch', () => {
    // A seed framed 0.15 m over the ground with the eye brought down level with
    // it: the lift is the 12-degree cap over 2.5 m, not the 1.45 m to the head.
    const lift = aimLiftY({
      eyeY: 0.15,
      targetY: 0.15,
      headY: 1.6,
      horizontalM: 2.5,
      offsetYM: 0,
    });
    assert.ok(close(lift, 2.5 * Math.tan(LOOK_UP_MAX_DEG * DEG)), `lift ${lift}`);
    const pitchUp = Math.atan2(lift, 2.5) / DEG;
    assert.ok(close(pitchUp, LOOK_UP_MAX_DEG, 1e-6), `pitch ${pitchUp}`);
  });

  it('keeps a short arm from buying a steep pitch', () => {
    const long = aimLiftY({ eyeY: 0.15, targetY: 0.15, headY: 1.6, horizontalM: 3, offsetYM: 0 });
    const short = aimLiftY({
      eyeY: 0.15,
      targetY: 0.15,
      headY: 1.6,
      horizontalM: 0.6,
      offsetYM: 0,
    });
    assert.ok(short < long, `${short} should be under ${long}`);
    assert.ok(close(Math.atan2(short, 0.6) / DEG, LOOK_UP_MAX_DEG, 1e-6));
  });

  it('turns the welcome framing’s downward pitch level, not at the sky', () => {
    // Eye 0.7 m above the target at 3 m: 13.1 degrees down. The lean is the
    // 12-degree budget, so the view comes out a degree below level with the seed
    // still in the lower half.
    const lift = aimLiftY({ eyeY: 0.85, targetY: 0.15, headY: 1.6, horizontalM: 3, offsetYM: 0.7 });
    assert.ok(close(lift, 3 * Math.tan(LOOK_UP_MAX_DEG * DEG)), `lift ${lift}`);
    const pitch = -Math.atan2(0.7, 3) / DEG + Math.atan2(lift, 3) / DEG;
    assert.ok(Math.abs(pitch) < 2, `view ${pitch} degrees`);
  });

  it('binds on the eye’s gap to the head when the eye is nearly at head height', () => {
    const lift = aimLiftY({ eyeY: 1.3, targetY: 0.15, headY: 1.6, horizontalM: 3, offsetYM: 1.15 });
    assert.ok(close(lift, 0.3), `lift ${lift}`);
  });

  it('gives a partly upward orbit only the rest of the lean', () => {
    // 6 degrees up already: 6 degrees of the 12-degree lean remains.
    const six = Math.tan(6 * DEG) * 3;
    const lift = aimLiftY({ eyeY: 0, targetY: 0, headY: 1.6, horizontalM: 3, offsetYM: -six });
    assert.ok(close(lift, 3 * Math.tan(6 * DEG), 1e-5), `lift ${lift}`);
  });

  it('never lifts a target the player has panned above the head', () => {
    assert.equal(aimLiftY({ eyeY: 0.2, targetY: 2.4, headY: 1.6, horizontalM: 2, offsetYM: 0 }), 0);
  });

  it('leaves an eye above the head alone', () => {
    assert.equal(aimLiftY({ eyeY: 2.5, targetY: 0, headY: 1.6, horizontalM: 3, offsetYM: 2.5 }), 0);
  });

  it('does not keep raising a view that already looks up', () => {
    // The camera dived below its target on a slope: the orbit's own 40 degrees of
    // upward pitch is past the cap, so the aim must not add to it.
    const lift = aimLiftY({
      eyeY: 0.1,
      targetY: 0.6,
      headY: 1.6,
      horizontalM: 0.8,
      offsetYM: -0.67,
    });
    assert.equal(lift, 0);
  });

  it('never returns a NaN or negative aim for a degenerate pose', () => {
    assert.equal(
      aimLiftY({ eyeY: Number.NaN, targetY: 0, headY: 1.6, horizontalM: 3, offsetYM: 0 }),
      0,
    );
    assert.equal(
      aimLiftY({ eyeY: 0, targetY: 0, headY: Number.NaN, horizontalM: 3, offsetYM: 0 }),
      0,
    );
    assert.equal(aimLiftY({ eyeY: 0, targetY: 0, headY: 1.6, horizontalM: 0, offsetYM: 0 }), 0);
    assert.equal(
      aimLiftY({ eyeY: 0, targetY: 0, headY: 1.6, horizontalM: 3, offsetYM: 0, maxLookUpRad: 0 }),
      0,
    );
  });
});
