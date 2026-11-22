import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recenterOffset } from './recenterView.ts';

const close = (a: number, b: number, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

describe('recenter view', () => {
  it('resets the elevation after the camera has been panned up', () => {
    // A right-drag pan left the eye high above the target; the old recenter kept
    // that pitch and framed the plant from above.
    const pannedUp = { x: 0.5, y: 6, z: -2 };
    const direction = recenterOffset({ offset: pannedUp, rise: 0.27 });
    assert.ok(close(direction.y, 0.27), `elevation ${direction.y}`);
    assert.ok(close(Math.hypot(direction.x, direction.y, direction.z), 1), 'unit length');
  });

  it('keeps the azimuth the player was looking along', () => {
    const before = { x: 3, y: 1.2, z: -3 };
    const after = recenterOffset({ offset: before, rise: 0.12 });
    const beforeAzimuth = Math.atan2(before.x, before.z);
    const afterAzimuth = Math.atan2(after.x, after.z);
    assert.ok(close(beforeAzimuth, afterAzimuth, 1e-9), `${beforeAzimuth} vs ${afterAzimuth}`);
  });

  it('returns a horizontal view at rise 0 and nearly vertical at 0.999', () => {
    const flat = recenterOffset({ offset: { x: 1, y: 9, z: 1 }, rise: 0 });
    assert.ok(close(flat.y, 0), 'flat');
    const steep = recenterOffset({ offset: { x: 1, y: 9, z: 1 }, rise: 0.999 });
    assert.ok(steep.y > 0.99, 'steep');
    assert.ok(close(Math.hypot(steep.x, steep.y, steep.z), 1), 'unit length');
  });

  it('uses the fallback azimuth when the offset has no horizontal part', () => {
    const direction = recenterOffset({ offset: { x: 0, y: 5, z: 0 }, rise: 0.3 });
    assert.ok(Number.isFinite(direction.x) && Number.isFinite(direction.z), 'finite');
    assert.ok(close(Math.hypot(direction.x, direction.y, direction.z), 1), 'unit length');
    // Fallback is forward/right, so it must not point at the origin horizontally.
    assert.ok(Math.hypot(direction.x, direction.z) > 0.5, 'has azimuth');
  });

  it('never returns a NaN direction for a degenerate offset and fallback', () => {
    const direction = recenterOffset({
      offset: { x: 0, y: 5, z: 0 },
      rise: 0.4,
      fallback: { x: 0, z: 0 },
    });
    assert.deepEqual(direction, { x: 0, y: 1, z: 0 });
  });
});
