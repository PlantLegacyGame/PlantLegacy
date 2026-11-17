import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  apertureRadiusFor,
  applyRootSightConfig,
  createRootSightUniforms,
} from './rootSightUniforms.ts';

// The shipped presentation, as `config/root_sight.json` holds it.
const FROM_CONFIG = {
  cutawayRadius: 7,
  soilOpacity: 0.45,
  apertureRadiusRatio: 0.7,
  apertureMinM: 0.28,
};

describe('Root Sight uniforms', () => {
  it('starts closed, with no tuned values of its own', () => {
    const uniforms = createRootSightUniforms();
    assert.equal(uniforms.uRootSightRadius.value, 0);
    assert.equal(uniforms.uRootSightApertureRadius.value, 0);
    assert.equal(uniforms.uRootSightSoilOpacity.value, 0);
    assert.equal(uniforms.uRootSightProgress.value, 0);
  });

  it('takes the configured radius, opacity and aperture', () => {
    const uniforms = createRootSightUniforms();
    applyRootSightConfig(uniforms, FROM_CONFIG);
    assert.equal(uniforms.uRootSightRadius.value, 7);
    assert.equal(uniforms.uRootSightSoilOpacity.value, 0.45);
    // 7 * 0.7 = 4.9, above the 0.28 floor. Tolerance because 7 * 0.7 is not
    // exactly representable in binary floating point.
    assert.ok(Math.abs(uniforms.uRootSightApertureRadius.value - 4.9) < 1e-9);
  });

  it('mutates the shared set instead of replacing it', () => {
    const uniforms = createRootSightUniforms();
    const radius = uniforms.uRootSightRadius;
    applyRootSightConfig(uniforms, FROM_CONFIG);
    // The soil shader, the plant pass and the transition hold these uniforms by
    // reference; a new object would leave the old ones drawing the old numbers.
    assert.equal(uniforms.uRootSightRadius, radius);
  });

  it('keeps the aperture floor for a small cavity', () => {
    assert.equal(
      apertureRadiusFor(0.2, {
        apertureRadiusRatio: FROM_CONFIG.apertureRadiusRatio,
        apertureMinM: 0.28,
      }),
      0.28,
    );
    // A wide cavity is driven by the ratio, not the floor. Tolerance because
    // 50 * 0.7 is not exactly representable in binary floating point.
    assert.ok(
      Math.abs(apertureRadiusFor(50, { apertureRadiusRatio: 0.7, apertureMinM: 0.28 }) - 35) < 1e-9,
    );
  });

  it('clamps broken values instead of painting nothing', () => {
    const uniforms = createRootSightUniforms();
    applyRootSightConfig(uniforms, { ...FROM_CONFIG, soilOpacity: 4, cutawayRadius: -3 });
    assert.equal(uniforms.uRootSightSoilOpacity.value, 1);
    assert.equal(uniforms.uRootSightRadius.value, 0);
    // A closed cavity has no hole, so the floor does not cut one on its own.
    assert.equal(uniforms.uRootSightApertureRadius.value, 0);
  });

  it('gives a zero cavity no aperture, whatever the floor says', () => {
    assert.equal(apertureRadiusFor(0, { apertureRadiusRatio: 0.7, apertureMinM: 0.28 }), 0);
  });
});
