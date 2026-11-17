import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APERTURE_FLOOR_MARGIN_M,
  APERTURE_RIM_MARGIN_M,
  apertureVolumeFor,
  insideApertureVolume,
  interleavedGradientNoise,
  rimDitherWidthM,
  rimKeepsFragment,
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

describe('rim dither', () => {
  it('caps the configured width at half the hole', () => {
    assert.equal(rimDitherWidthM(4, 0.35), 0.35);
    assert.equal(rimDitherWidthM(0.4, 0.35), 0.2);
    assert.equal(rimDitherWidthM(0, 0.35), 0);
  });

  it('cuts the core and keeps everything outside the rim', () => {
    assert.equal(rimKeepsFragment(0.2, 2, 0.35, 0.9), false);
    assert.equal(rimKeepsFragment(2.2, 2, 0.35, 0.1), true);
  });

  it('leaves a speckled band instead of a hard circle', () => {
    const dither = 0.35;
    const mid = 2 - dither * 0.5;
    const kept = [0.05, 0.3, 0.55, 0.8, 0.95].filter((noise) =>
      rimKeepsFragment(mid, 2, dither, noise),
    );
    assert.ok(kept.length > 0 && kept.length < 5, 'the rim band is all-or-nothing');
  });

  it('produces noise in [0, 1)', () => {
    for (const [x, y] of [
      [0, 0],
      [13.7, 41.2],
      [1023.5, 767.25],
    ]) {
      const noise = interleavedGradientNoise(x, y);
      assert.ok(noise >= 0 && noise < 1, `noise ${noise} outside [0, 1)`);
    }
  });
});
