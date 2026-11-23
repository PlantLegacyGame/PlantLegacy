import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { panBasis, panMove } from './cameraPan.ts';

const UP = { x: 0, y: 1, z: 0 };
const eye = { x: 0, y: 5, z: 10 };
const target = { x: 0, y: 0, z: 0 };

const keys = (overrides: Partial<Parameters<typeof panMove>[0]> = {}) =>
  panMove({
    eye,
    target,
    up: UP,
    forwardAxis: 0,
    strafe: 0,
    free: false,
    speed: 8,
    deltaTime: 0.5,
    ...overrides,
  });

describe('camera pan', () => {
  it('heads into the screen, from the target, not from a stale rotation', () => {
    const basis = panBasis(eye, target, UP, false);
    assert.ok(basis);
    // The eye is at +Z looking towards the origin: forward is -Z.
    assert.ok(basis.forward.z < -0.99);
    assert.ok(Math.abs(basis.forward.y) < 1e-9, 'the ground heading is level');
  });

  it('moves forward on W and back on S, with no vertical travel', () => {
    const forward = keys({ forwardAxis: 1 });
    const back = keys({ forwardAxis: -1 });
    assert.ok(forward && back);
    assert.ok(forward.z < 0, `W should travel -Z, got ${forward.z}`);
    assert.ok(back.z > 0);
    assert.equal(forward.y, 0);
    assert.ok(Math.abs(forward.z + back.z) < 1e-9);
    assert.ok(Math.abs(forward.z - -8 * 0.5) < 1e-9, 'speed x dt is not the step');
  });

  it('strafe right on D and left on A, perpendicular to the heading', () => {
    const right = keys({ strafe: 1 });
    const left = keys({ strafe: -1 });
    assert.ok(right && left);
    assert.ok(right.x > 0, `D should travel +X, got ${right.x}`);
    assert.ok(left.x < 0);
    assert.equal(right.y, 0);
  });

  it('keeps the eye height while panning across a slope', () => {
    // The eye stands on a hill and looks slightly down at the plant; the ground
    // rig's heading is level, so the move never gains height whatever the pitch.
    const slopeEye = { x: 0, y: 12, z: 14 };
    const slopeTarget = { x: 2, y: 0, z: 0 };
    for (const forwardAxis of [1, -1]) {
      for (const strafe of [-1, 0, 1]) {
        const move = keys({ eye: slopeEye, target: slopeTarget, forwardAxis, strafe });
        assert.ok(move);
        assert.ok(Math.abs(move.y) < 1e-12, 'a ground pan must not follow the terrain');
      }
    }
  });

  it('flies along the whole view vector in free mode', () => {
    const free = keys({
      eye: { x: 0, y: 10, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      forwardAxis: 1,
      free: true,
    });
    assert.ok(free);
    assert.ok(free.y < 0, 'looking down and pressing W should descend');
    assert.ok(free.z < 0);
    assert.ok(Math.abs(free.y / free.z - 1) < 1e-6, 'the free heading is the view vector');
  });

  it('does nothing without keys or with a degenerate orbit', () => {
    assert.equal(keys(), null);
    assert.equal(keys({ eye: target, forwardAxis: 1 }), null);
    assert.equal(keys({ speed: 0, forwardAxis: 1 }), null);
  });
});
