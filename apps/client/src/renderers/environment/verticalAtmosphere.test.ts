import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AIR_SCALE_HEIGHT_M,
  AIR_TOP_M,
  airDensityAt,
  CLOUD_DECK_ALTITUDE_M,
  CLOUD_TOP_ALTITUDE_M,
  cloudCoverAbove,
  fogReachAt,
} from './verticalAtmosphere.ts';

describe('the air over the planet', () => {
  it('is full at the soil and thinner with every metre up', () => {
    assert.equal(airDensityAt(0), 1);
    assert.equal(airDensityAt(-4), 1, 'below the surface is still thick air');
    let previous = airDensityAt(0);
    for (let m = 250; m <= 30_000; m += 250) {
      const density = airDensityAt(m);
      assert.ok(density < previous, `the air got thicker between ${m - 250} m and ${m} m`);
      previous = density;
    }
  });

  it('drops by one e-fold per scale height', () => {
    assert.ok(Math.abs(airDensityAt(AIR_SCALE_HEIGHT_M) - Math.exp(-1)) < 1e-9);
    assert.ok(Math.abs(airDensityAt(AIR_SCALE_HEIGHT_M * 2) - Math.exp(-2)) < 1e-9);
  });

  it('is gone above the top of the shell, so orbit is space', () => {
    assert.equal(airDensityAt(AIR_TOP_M), 0);
    assert.equal(airDensityAt(AIR_TOP_M * 3), 0);
    assert.equal(airDensityAt(Number.NaN), 0);
    assert.ok(airDensityAt(CLOUD_TOP_ALTITUDE_M) > 0.5, 'the deck is inside the air');
  });

  it('puts the cloud deck between the soil and the top of the shell', () => {
    assert.ok(CLOUD_DECK_ALTITUDE_M > 0);
    assert.ok(CLOUD_TOP_ALTITUDE_M > CLOUD_DECK_ALTITUDE_M);
    assert.ok(CLOUD_TOP_ALTITUDE_M < AIR_TOP_M);
    assert.equal(cloudCoverAbove(0), 0);
    assert.equal(cloudCoverAbove(CLOUD_DECK_ALTITUDE_M - 200), 0, 'clouds are overhead');
    assert.equal(cloudCoverAbove(CLOUD_TOP_ALTITUDE_M), 1, 'the eye is through the deck');
    assert.equal(cloudCoverAbove(AIR_TOP_M), 1);
    assert.equal(cloudCoverAbove(Number.NaN), 0);
    let previous = 0;
    for (let m = 0; m <= CLOUD_TOP_ALTITUDE_M; m += 50) {
      const cover = cloudCoverAbove(m);
      assert.ok(cover >= previous, 'the deck never comes back as the eye climbs');
      previous = cover;
    }
  });

  it('sees further through thin air than through the haze at the soil', () => {
    assert.equal(fogReachAt(320, 0), 320);
    assert.equal(fogReachAt(320, -10), 320);
    assert.ok(fogReachAt(320, 1_400) > 3_000, 'a kilometre up is not a 300 m view');
    assert.ok(fogReachAt(320, 60_000) > 100_000, 'from orbit the planet itself is visible');
    assert.equal(fogReachAt(320, Number.NaN), 320);
  });
});
