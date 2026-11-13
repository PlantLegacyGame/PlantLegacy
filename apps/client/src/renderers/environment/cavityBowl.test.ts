import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAVITY_BOWL_RIM_FRACTION,
  CAVITY_MOUTH_FRACTION,
  cavityBowlPlacement,
} from './cavityBowl.ts';

/** Horizontal radius of the built bowl's rim circle at unit scale. */
function rimCircleRadius(): number {
  return Math.sqrt(1 - CAVITY_BOWL_RIM_FRACTION * CAVITY_BOWL_RIM_FRACTION);
}

describe('cavityBowlPlacement', () => {
  it('fills the mouth the soil shader cuts, so no void ring shows', () => {
    const radius = 2.06;
    const { horizontalScale } = cavityBowlPlacement(radius, 1);
    const rimRadius = horizontalScale * rimCircleRadius();
    const mouthRadius = radius * CAVITY_MOUTH_FRACTION;
    assert.ok(
      rimRadius >= mouthRadius - 1e-9,
      `rim ${rimRadius.toFixed(3)} m is narrower than the ${mouthRadius.toFixed(3)} m mouth`,
    );
  });

  it('keeps the rim under the surface at every opening stage', () => {
    for (const progress of [0.05, 0.5, 1]) {
      const { rimOffsetY } = cavityBowlPlacement(2.06, progress);
      assert.ok(rimOffsetY < 0, `rim ${rimOffsetY.toFixed(3)} m is not below the centre`);
    }
  });

  it('opens from nothing: the bowl is hidden at zero progress', () => {
    const { visible, horizontalScale } = cavityBowlPlacement(2.06, 0);
    assert.equal(visible, false);
    assert.equal(horizontalScale, 0);
  });
});
