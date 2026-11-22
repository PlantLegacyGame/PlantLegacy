import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CELESTIAL_SIZE_VMIN, CLOUD_TRAVEL_VW, CLOUDS, cloudShadows } from './skyLayout.ts';

describe('title sky layout', () => {
  it('moves every cloud across the sky', () => {
    // The complaint was that the clouds did not move. Motion is this table's job
    // now: nothing may sit still, and a crossing has to be wide enough to be a
    // crossing rather than the two-minute drift it replaced.
    assert.ok(CLOUDS.length >= 12, 'the sky is more than a handful of shapes');
    assert.ok(CLOUD_TRAVEL_VW > 100, 'a crossing is wider than the frame');
    for (const cloud of CLOUDS) {
      assert.ok(
        cloud.crossS > 30 && cloud.crossS < 400,
        `${cloud.id} should cross in a plausible time, got ${cloud.crossS}s`,
      );
      assert.ok(Number.isFinite(cloud.delayS) && cloud.delayS <= 0, `${cloud.id} starts mid-sky`);
    }
    // No two clouds share a crossing time: a sky where everything moves at one
    // speed reads as a scrolling wallpaper rather than as wind at two altitudes.
    assert.equal(new Set(CLOUDS.map((cloud) => cloud.crossS)).size, CLOUDS.length);
  });

  it('does not hang a low streak in a corner', () => {
    // The shape that read as a sausage strung across the sky: wide, thin, low and
    // on the right. Whatever the families do, the layout may not place one there.
    for (const cloud of CLOUDS) {
      const low = cloud.top > 54;
      const wide = cloud.width > 24;
      const right = cloud.left > 55;
      assert.ok(!(low && wide && right), `${cloud.id} is the sausage`);
    }
  });

  it('uses every family, high and low', () => {
    const families = new Set(CLOUDS.map((cloud) => cloud.family));
    for (const family of ['bank', 'cumulus', 'wisp', 'tower', 'veil', 'puff']) {
      assert.ok(families.has(family as never), `the sky has a ${family}`);
    }
    assert.ok(
      CLOUDS.some((cloud) => cloud.top < 20),
      'something is high in the sky',
    );
    assert.ok(
      CLOUDS.some((cloud) => cloud.top > 44),
      'something is low in the sky',
    );
  });

  it('shades the soil with the clouds that cast it', () => {
    const shadows = cloudShadows();
    assert.ok(shadows.length > 0, 'the soil has weather on it');
    const byId = new Map(CLOUDS.map((cloud) => [`${cloud.id}-shadow`, cloud]));
    for (const shadow of shadows) {
      const cloud = byId.get(shadow.id);
      assert.ok(cloud, `${shadow.id} belongs to a cloud in the table`);
      // Same speed, same offset: a shadow that crossed at its own pace while the
      // cloud above it crossed at another is what makes weather look painted on.
      assert.equal(shadow.crossS, cloud.crossS, `${shadow.id} crosses with its cloud`);
      assert.equal(shadow.delayS, cloud.delayS);
      assert.ok(shadow.opacity > 0 && shadow.opacity <= 1);
    }
    assert.equal(new Set(shadows.map((shadow) => shadow.id)).size, shadows.length);
    assert.deepEqual(cloudShadows(CLOUDS, 0), []);
  });

  it('gives the sun and the moon one size', () => {
    // They were two numbers in a stylesheet, and one drifted: a moon visibly
    // smaller than the sun at the same moment reads as a bug, not as a phase.
    assert.ok(CELESTIAL_SIZE_VMIN > 6 && CELESTIAL_SIZE_VMIN < 20);
  });
});
