import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APERTURE_FLOOR_MARGIN_M,
  APERTURE_RIM_MARGIN_M,
  apertureVolumeFor,
  insideApertureVolume,
} from './apertureVolume.ts';

describe('aperture volume', () => {
  const volume = apertureVolumeFor({
    centerX: 10,
    centerZ: -2,
    groundY: 16,
    apertureRadiusM: 2,
    depthM: 3.8,
  });

  it('reaches from the highest ground under the mouth down to the floor', () => {
    assert.equal(volume.topY, 16 + APERTURE_RIM_MARGIN_M);
    assert.equal(volume.bottomY, volume.topY - 3.8 - APERTURE_FLOOR_MARGIN_M);
  });

  it('holds the soil directly under the opening', () => {
    assert.equal(insideApertureVolume({ x: 10, y: 15, z: -2 }, volume), true);
    assert.equal(insideApertureVolume({ x: 11.5, y: 14, z: -2.5 }, volume), true);
  });

  it('keeps the ground beyond the rim', () => {
    assert.equal(insideApertureVolume({ x: 13, y: 15, z: -2 }, volume), false);
  });

  it('keeps the far side of the planet, which shares the same X and Z', () => {
    // The old plan-view disc discarded any fragment within the radius whatever
    // its height, including ground at the antipode.
    assert.equal(insideApertureVolume({ x: 10, y: -90_000, z: -2 }, volume), false);
  });

  it('keeps the hill above the mouth, so no uphill ground is cut away', () => {
    assert.equal(insideApertureVolume({ x: 10, y: 24, z: -2 }, volume), false);
  });

  it('is empty when the aperture is closed', () => {
    const closed = apertureVolumeFor({
      centerX: 0,
      centerZ: 0,
      groundY: 0,
      apertureRadiusM: 0,
      depthM: 2,
    });
    assert.equal(insideApertureVolume({ x: 0, y: 0, z: 0 }, closed), false);
  });
});
