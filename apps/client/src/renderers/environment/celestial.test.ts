import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type AmbientLightingConfig,
  type CelestialElevation,
  stepAmbientLighting,
} from './celestial.ts';

const CONFIG: AmbientLightingConfig = {
  ambientIntensityDay: 0.6,
  ambientIntensityNight: 0.15,
  lightningIntensityBoost: 4,
  ambientFadeTauS: 0.35,
};

const DAY: CelestialElevation = { sunElev: 1, dayFactor: 1, duskFactor: 0 };
const NIGHT: CelestialElevation = { sunElev: -1, dayFactor: 0, duskFactor: 0 };

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

describe('stepAmbientLighting', () => {
  it('composes baseline + flash and never lets the flash enter the baseline', () => {
    let withFlash = CONFIG.ambientIntensityDay;
    let withoutFlash = CONFIG.ambientIntensityDay;

    for (let frame = 0; frame < 200; frame += 1) {
      const lit = stepAmbientLighting({
        currentBaseline: withFlash,
        config: CONFIG,
        elevation: DAY,
        sunIntensity: 1,
        lightningIntensity: 1,
        alpha: 0.3,
      });
      const control = stepAmbientLighting({
        currentBaseline: withoutFlash,
        config: CONFIG,
        elevation: DAY,
        sunIntensity: 1,
        lightningIntensity: 0,
        alpha: 0.3,
      });
      withFlash = lit.baseline;
      withoutFlash = control.baseline;

      assert.equal(lit.baseline, control.baseline, 'the flash must not change the baseline');
      assert.equal(lit.intensity, lit.baseline + lit.flash);
      // A 120 ms strike faded to nothing must never be drawn brighter than the
      // configured peak multiplier, however many frames it spans.
      assert.ok(lit.intensity <= lit.baseline * CONFIG.lightningIntensityBoost + 1e-9);
    }
  });

  it('returns to the baseline on the first frame after a strike ends', () => {
    const lit = stepAmbientLighting({
      currentBaseline: CONFIG.ambientIntensityDay,
      config: CONFIG,
      elevation: DAY,
      sunIntensity: 1,
      lightningIntensity: 1,
      alpha: 0.3,
    });
    assert.ok(lit.flash > 0);

    const after = stepAmbientLighting({
      currentBaseline: lit.baseline,
      config: CONFIG,
      elevation: DAY,
      sunIntensity: 1,
      lightningIntensity: 0,
      alpha: 0.3,
    });
    assert.equal(after.flash, 0);
    assert.equal(after.intensity, after.baseline);
    assert.ok(near(after.intensity, lit.baseline), 'no leftover brightness from the strike');
  });

  it('uses the configured boost: the value in render.json is not dead', () => {
    const params = {
      currentBaseline: CONFIG.ambientIntensityDay,
      config: { ...CONFIG, lightningIntensityBoost: 2 },
      elevation: DAY,
      sunIntensity: 1,
      lightningIntensity: 1,
      alpha: 0.3,
    };
    const two = stepAmbientLighting(params);
    const four = stepAmbientLighting({
      ...params,
      config: { ...CONFIG, lightningIntensityBoost: 4 },
    });
    assert.ok(near(two.flash, CONFIG.ambientIntensityDay));
    assert.ok(near(four.flash, CONFIG.ambientIntensityDay * 3));
    assert.ok(four.intensity > two.intensity);
  });

  it('follows the day/night target and never dims below the floor', () => {
    const night = stepAmbientLighting({
      currentBaseline: CONFIG.ambientIntensityDay,
      config: { ...CONFIG, ambientIntensityNight: 0.01 },
      elevation: NIGHT,
      sunIntensity: 1,
      lightningIntensity: 0,
      alpha: 1,
    });
    assert.equal(night.baseline, 0.1, 'the ambient floor still applies at night');

    const day = stepAmbientLighting({
      currentBaseline: 0.1,
      config: CONFIG,
      elevation: DAY,
      sunIntensity: 0.5,
      lightningIntensity: 0,
      alpha: 1,
    });
    assert.ok(near(day.baseline, CONFIG.ambientIntensityDay * 0.5));
  });
});
