import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.ts';
import {
  type AmbientLightingConfig,
  applyCelestialLighting,
  type CelestialElevation,
  type CelestialLightingTargets,
  gradeExposure,
  gradeSunColor,
  moonIntensity,
  stepAmbientLighting,
  sunWarmth,
  updateCelestialBodies,
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
        uMoonIntensity: { value: 0 },
        uSunWarmth: { value: 0 },
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

describe('sun and moon grading', () => {
  const cfg = {
    sunColorDay: '#ffffee',
    sunColorDusk: '#ffa066',
    sunIntensityNight: 0.15,
  } as const;

  it('leaves the sun white when it is high', () => {
    assert.equal(sunWarmth(0.9), 0);
    assert.equal(sunWarmth(0.45), 0);
  });

  it('warms the sun steadily as it drops, without a jump', () => {
    const samples = [0.4, 0.3, 0.2, 0.1, 0.04].map((elev) => sunWarmth(elev));
    for (let i = 1; i < samples.length; i += 1) {
      assert.ok(samples[i]! >= samples[i - 1]!, 'warmth must not go backwards');
    }
    assert.ok(samples[0]! < 0.3, 'still fairly white a little above the horizon');
    assert.ok(samples[samples.length - 1]! > 0.85, 'nearly full sunset on the horizon');
  });

  it('drops to no warmth below the horizon', () => {
    assert.equal(sunWarmth(-0.05) < 0.7, true, 'fading as it sets');
    assert.equal(sunWarmth(-0.2), 0, 'no sunset light once the sun is under');
    assert.equal(sunWarmth(-0.9), 0, 'and none at midnight');
  });

  it('grades the colour between the two configured ends', () => {
    const high = gradeSunColor(0.8, cfg, new THREE.Color()).getHexString();
    assert.equal(`#${high}`, cfg.sunColorDay.toLowerCase(), 'noon is the day colour');

    const low = gradeSunColor(0.0, cfg, new THREE.Color()).getHexString();
    const dusk = new THREE.Color(cfg.sunColorDusk).getHexString();
    // At the horizon it is almost entirely the dusk colour.
    const lowRgb = new THREE.Color(`#${low}`);
    const duskRgb = new THREE.Color(`#${dusk}`);
    assert.ok(Math.abs(lowRgb.r - duskRgb.r) < 0.12);
    assert.ok(lowRgb.b < 0.55, 'sunset is orange, not blue');
  });

  it('builds moonlight up from the horizon instead of switching it on', () => {
    const moonrise = moonIntensity(-0.02, cfg, 1);
    const higher = moonIntensity(-0.4, cfg, 1);
    const midnight = moonIntensity(-0.95, cfg, 1);
    assert.ok(moonrise < higher, 'a low moon is dimmer');
    assert.ok(higher < midnight, 'the moon keeps strengthening');
    assert.ok(moonIntensity(-1, cfg, 1) <= cfg.sunIntensityNight + 1e-9);
    assert.ok(moonIntensity(-0.02, cfg, 1) >= 0.02, 'never fully dark');
  });

  it('ramps the moon halo in the sky with the moon that casts it', () => {
    const renderCfg = { sunColorNight: '#7088a8', sunIntensityNight: 0.15 } as const;
    const night = (sunElev: number) => {
      const light = new THREE.DirectionalLight();
      const ambient = new THREE.AmbientLight();
      const skyMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: new THREE.Vector3() },
          uSunColor: { value: new THREE.Color() },
          uMoonDir: { value: new THREE.Vector3() },
          uSunIntensity: { value: 0 },
          uMoonIntensity: { value: 0 },
          uSunWarmth: { value: 0 },
        },
      });
      const bodies = { sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3() };
      updateCelestialBodies(bodies, 0.75);
      applyCelestialLighting({
        config: renderCfg as unknown as RenderConfig,
        sunLight: light,
        ambientLight: ambient,
        skyMaterial,
        bodies,
        elevation: { sunElev, dayFactor: 0, duskFactor: 0 },
        sunOrbitalDistance: 100,
        ambientIntensity: 0.2,
        lightMultiplier: 1,
      } as unknown as CelestialLightingTargets);
      return skyMaterial.uniforms.uMoonIntensity.value as number;
    };
    assert.ok(night(-0.02) < 0.3, 'a low moon barely glows');
    assert.ok(night(-0.95) > 0.9, 'an overhead moon glows fully');
  });

  it('still applies the weather multiplier to moonlight', () => {
    assert.ok(moonIntensity(-0.9, cfg, 0.4) < moonIntensity(-0.9, cfg, 1));
  });
});

describe('exposure grade', () => {
  const cfg = { exposureDay: 1, exposureHorizon: 1.1, exposureNight: 0.9 } as const;

  it('lifts golden hour and crushes the night', () => {
    assert.equal(gradeExposure(1, cfg), cfg.exposureDay);
    // The lift peaks just above the horizon, where the light is warmest.
    assert.ok(Math.abs(gradeExposure(0.02, cfg) - cfg.exposureHorizon) < 1e-6);
    assert.ok(Math.abs(gradeExposure(0, cfg) - cfg.exposureHorizon) < 0.03);
    assert.ok(Math.abs(gradeExposure(-1, cfg) - cfg.exposureNight) < 1e-6);
  });

  it('moves continuously through sunset, with no step', () => {
    const samples = [0.5, 0.3, 0.1, 0.0, -0.1, -0.5].map((elev) => gradeExposure(elev, cfg));
    for (let i = 1; i < samples.length; i += 1) {
      assert.ok(Math.abs(samples[i]! - samples[i - 1]!) < 0.12, 'no jump between hours');
    }
  });
});
