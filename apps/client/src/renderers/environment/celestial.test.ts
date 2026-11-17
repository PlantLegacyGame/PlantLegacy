import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.ts';
import {
  type AmbientLightingConfig,
  applyCelestialLighting,
  type CelestialElevation,
  type CelestialLightingTargets,
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

  it('blends into daylight instead of switching at a threshold', () => {
    // First light: the sun is barely up, so the day target is far below the night
    // value. The old code switched to it and clamped, a 33% drop at sunrise.
    const firstLight = stepAmbientLighting({
      currentBaseline: CONFIG.ambientIntensityNight,
      config: CONFIG,
      elevation: { sunElev: 0.05, dayFactor: 0.1, duskFactor: 0.5 },
      sunIntensity: 0.03,
      lightningIntensity: 0,
      alpha: 1,
    });
    assert.ok(
      firstLight.baseline > 0.13 && firstLight.baseline < CONFIG.ambientIntensityNight,
      `first light ${firstLight.baseline} must sit between the floor and the night value`,
    );

    const higher = stepAmbientLighting({
      currentBaseline: firstLight.baseline,
      config: CONFIG,
      elevation: { sunElev: 0.2, dayFactor: 0.4, duskFactor: 0.2 },
      sunIntensity: 0.2,
      lightningIntensity: 0,
      alpha: 1,
    });
    assert.ok(higher.baseline > firstLight.baseline, 'dawn only gets brighter');
  });
});

describe('applyCelestialLighting', () => {
  const renderConfig = {
    sunIntensityDay: 1.4,
    sunIntensityNight: 0.15,
    sunColorDay: '#FFFFFF',
    sunColorDusk: '#FFA066',
    sunColorNight: '#7088A8',
  } as unknown as RenderConfig;

  const targets = (
    lightMultiplier: number,
    elevation: CelestialElevation,
  ): CelestialLightingTargets => {
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3() },
        uSunIntensity: { value: 0 },
      },
    });
    return {
      config: renderConfig,
      sunLight: new THREE.DirectionalLight(),
      ambientLight: new THREE.AmbientLight(),
      skyMaterial,
      bodies: {
        sunDir: new THREE.Vector3(0, 1, 0),
        moonDir: new THREE.Vector3(0, -1, 0),
      },
      elevation,
      ambientIntensity: 0.42,
      lightMultiplier,
      sunOrbitalDistance: 120,
    };
  };

  it('grades the direct beam and its sky disk by the weather multiplier', () => {
    const clear = targets(1, DAY);
    applyCelestialLighting(clear);
    assert.ok(near(clear.sunLight.intensity, renderConfig.sunIntensityDay));
    assert.ok(near(clear.skyMaterial.uniforms.uSunIntensity.value as number, 1.4));

    const storm = targets(0.35, DAY);
    applyCelestialLighting(storm);
    assert.ok(near(storm.sunLight.intensity, renderConfig.sunIntensityDay * 0.35));
    assert.ok(near(storm.skyMaterial.uniforms.uSunIntensity.value as number, 1.4 * 0.35));
  });

  it('keeps the moonlit night dimmer than the storm-dimmed day', () => {
    const stormDay = targets(0.35, DAY);
    applyCelestialLighting(stormDay);
    const clearNight = targets(1, NIGHT);
    applyCelestialLighting(clearNight);
    assert.ok(clearNight.sunLight.intensity < stormDay.sunLight.intensity);
  });

  it('writes the composed ambient through, and never dims it below the floor', () => {
    const lit = targets(0.35, DAY);
    applyCelestialLighting(lit);
    assert.equal(lit.ambientLight.intensity, 0.42);
  });

  it('grades the moonlight in a storm too', () => {
    const night = targets(0.35, NIGHT);
    applyCelestialLighting(night);
    assert.ok(near(night.sunLight.intensity, renderConfig.sunIntensityNight * 0.35));
  });
});
