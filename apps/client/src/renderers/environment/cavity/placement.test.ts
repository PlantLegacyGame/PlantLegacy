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
import { bowlVerticalScale, cavityBowlPlacement, fitRimToGround } from './placement.ts';
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
  it('leaves a level mouth level', () => {
    const fit = fitRimToGround([0, 0, 0, 0]);
    assert.equal(fit.highestGround, 0);
    assert.equal(fit.lowestGround, 0);
  });

  it('measures the bank, and hands the drop to the depth rule', () => {
    // The wall used to be stretched until the lowest lip could reach its ground,
    // then squashed back by a floor factor. The two cancelled into a shallow
    // dish: the profile kept its radii and lost its heights, so the vertical cut
    // and the strata it carries were flattened away. The slope moves the mouth
    // plane instead, and its drop comes out of the wall (`bowlVerticalScale`).
    const fit = fitRimToGround([2, 0, 1, -0.5]);
    assert.equal(fit.highestGround, 2);
    assert.equal(fit.lowestGround, -0.5);
    const wall =
      bowlVerticalScale(3.8, fit.highestGround - fit.lowestGround) * CAVITY_PROFILE_DEPTH;
    assert.ok(Math.abs(wall - 1.3) < 1e-9, `wall ${wall.toFixed(3)} m`);
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

  it('judges a level eye by its own ground, not by the mouth plane', () => {
    // The mouth sits on the lowest ground under the rim, so an eye in the open on
    // a slope is below that plane while still metres above the earth it stands
    // on. Measured against the plane, this eye took the buried clip: the shell's
    // near half and its edges were dropped and water and sky showed through the
    // pit's rim from level angles.
    const mouthY = 20.64;
    const eyeY = 20.35;
    const eyeOwnGroundY = 17.31;
    assert.ok(eyeY < mouthY, 'the case under test is an eye below the mouth plane');
    assert.equal(cavityClipPolicy(eyeY, eyeOwnGroundY, false).mode, 'column');
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
