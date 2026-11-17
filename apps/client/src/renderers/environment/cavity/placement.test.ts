/**
 * The cavity's placement rules, tested without a mesh or a GPU.
 *
 * This is the point of the split: the pit's stretch and floor-clamp maths used
 * to live inside `updateCavityBowl`, where exercising a slope meant building
 * three.js geometry first.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cavityClipPolicy, isEyeInsideCavity } from './clip.ts';
import { cavityBowlPlacement, fitRimToGround } from './placement.ts';
import { CAVITY_DEPTH_TO_MOUTH, CAVITY_PROFILE_DEPTH, cavityDepthM } from './profile.ts';

describe('cavity depth budget', () => {
  it('is the dug-pit proportion when the roots are shallow', () => {
    assert.equal(cavityDepthM(2), 2 * CAVITY_DEPTH_TO_MOUTH);
  });

  it('reaches below the deepest root, with clearance', () => {
    assert.ok(cavityDepthM(2, 7.4) >= 7.4);
  });

  it('never gets shallower than the proportion, however deep the roots', () => {
    assert.equal(cavityDepthM(2, -0.1), 2 * CAVITY_DEPTH_TO_MOUTH);
  });
});

describe('fitting the rim to the ground', () => {
  it('leaves a level mouth exactly as placed', () => {
    const fit = fitRimToGround([0, 0, 0, 0], 3, 3.8);
    assert.equal(fit.verticalScale, 3);
    assert.equal(fit.highestGround, 0);
    assert.equal(fit.lowestGround, 0);
  });

  it('stretches only as far as the lip needs to reach the lowest ground', () => {
    const fit = fitRimToGround([2, 0, 1, -0.5], 3, 3.8);
    assert.equal(fit.highestGround, 2);
    // The whole drop is spent on the rim's own travel, so the lip lands on the
    // hillside instead of floating over it.
    assert.ok(fit.verticalScale * 0.27 >= 2.5 - 1e-9, 'the stretch cannot reach the drop');
  });

  it('holds the floor at the depth the roots asked for, whatever the stretch', () => {
    const fit = fitRimToGround([0, -2.9], 3, 3.8);
    const floorDepth = fit.floorScale * fit.verticalScale * CAVITY_PROFILE_DEPTH;
    assert.ok(Math.abs(floorDepth - 3.8) < 1e-6, `floor at ${floorDepth.toFixed(2)} m`);
  });

  it('never lets the floor rise to the lowest lip', () => {
    // A cliff: the stretch needed for the rim is far more than the depth budget,
    // so the clamp must keep the floor below the lip rather than invert the pit.
    const fit = fitRimToGround([0, -16], 3, 2.66);
    const floorLocal = -CAVITY_PROFILE_DEPTH * fit.floorScale;
    assert.ok(floorLocal < -0.27, `floor local ${floorLocal.toFixed(3)} is at or above the lip`);
  });
});

describe('when the bowl is drawn through the hole', () => {
  it('keeps an above-ground eye to the mouth column instead of the sightline rule', () => {
    // The sightline rule cut holes in the hillside beside the pit from any
    // off-centre camera; the column rule removes only the shell standing in the
    // open, which is the brown dome seen over the far rim.
    assert.equal(cavityClipPolicy(10, 0, false).mode, 'column');
  });

  it('never clips an eye inside the cavity at all', () => {
    assert.equal(cavityClipPolicy(10, 0, true).mode, 'none');
  });

  it('clips a buried eye outside the pit to the opening and drops the near half', () => {
    // One mode carries both: the sightline rule at the opening and the
    // near-half cut, because they always applied together anyway.
    assert.equal(cavityClipPolicy(-1, 0, false).mode, 'buried');
  });

  it('does not clip an eye that is inside the cavity', () => {
    assert.equal(cavityClipPolicy(-1, 0, true).mode, 'none');
  });
});

describe('the placement is the mouth', () => {
  it('puts the rim circle exactly at the aperture radius', () => {
    const placement = cavityBowlPlacement(4, 1, 3.8, 1.5);
    assert.equal(placement.horizontalScale, 1.5);
  });

  it('is invisible when the cavity is closed', () => {
    assert.equal(cavityBowlPlacement(4, 0, 3.8, 1.5).visible, false);
  });

  it('answers true for an eye inside the bowl and false for one above it', () => {
    const frame = { x: 0, y: 10, z: 0, horizontalScale: 2, verticalScale: 6 };
    assert.equal(isEyeInsideCavity({ x: 0, y: 9, z: 0 }, frame), true);
    assert.equal(isEyeInsideCavity({ x: 0, y: 10.5, z: 0 }, frame), false);
    assert.equal(isEyeInsideCavity({ x: 9, y: 9, z: 0 }, frame), false);
  });
});
