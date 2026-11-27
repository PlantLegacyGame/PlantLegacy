import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nodePickRadius, type PickRadii } from './nodePickRadius.ts';

const RADII: PickRadii = { scale: 1.15, ownFloorM: 0.1, rivalFloorM: 0.35 };

describe('node pick radius', () => {
  it('keeps your own part on the small floor, so it cannot be swallowed', () => {
    // A 2 cm child root on a thick radicle: at the hugging floor, not the reach,
    // which is what stops the parent's sphere covering it.
    assert.equal(nodePickRadius(0.02, true, RADII), RADII.ownFloorM);
  });

  it('gives a rival part the configured reach', () => {
    // The seedling that could not be clicked at 5.5 m: 3 cm across.
    assert.equal(nodePickRadius(0.03, false, RADII), RADII.rivalFloorM);
  });

  it('follows the part above either floor, with the caller scale', () => {
    assert.equal(nodePickRadius(0.5, true, RADII), 0.5 * RADII.scale);
    assert.equal(nodePickRadius(1, false, { ...RADII, scale: 2 }), 2);
  });

  it('treats a missing or negative radius as no part at all', () => {
    assert.equal(nodePickRadius(Number.NaN, true, RADII), RADII.ownFloorM);
    assert.equal(nodePickRadius(-1, false, RADII), RADII.rivalFloorM);
  });
});
