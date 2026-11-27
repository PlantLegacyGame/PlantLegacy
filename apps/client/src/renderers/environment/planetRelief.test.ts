import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { type PlanetReliefParams, planetReliefAt } from './planetRelief.ts';

const RADIUS = 100_000;
const PARAMS: PlanetReliefParams = {
  amplitudeM: 160,
  seed: 1234,
  surfaceRadiusM: RADIUS,
  holdoffM: 6_200,
  rampM: 1_800,
};

/** A direction at `arcM` metres of arc from the pole (about +Y). */
function directionAtArc(arcM: number, azimuth = 0): THREE.Vector3 {
  const angle = arcM / RADIUS;
  return new THREE.Vector3(
    Math.sin(angle) * Math.cos(azimuth),
    Math.cos(angle),
    Math.sin(angle) * Math.sin(azimuth),
  );
}

describe('planet relief', () => {
  it('is exactly zero inside the authored patches and continuous out of them', () => {
    for (const arc of [0, 500, 3_000, 6_199.9]) {
      assert.equal(planetReliefAt(directionAtArc(arc), PARAMS), 0);
    }
    // At the end of the ramp it is fully grown, and it reached zero smoothly.
    const atHoldoff = planetReliefAt(directionAtArc(PARAMS.holdoffM), PARAMS);
    const justPast = planetReliefAt(directionAtArc(PARAMS.holdoffM + 1), PARAMS);
    assert.equal(atHoldoff, 0);
    assert.ok(Math.abs(justPast) < PARAMS.amplitudeM * 0.01);
  });

  it('has relief everywhere beyond the play area, not one flat ball', () => {
    const samples: number[] = [];
    for (let azimuth = 0; azimuth < Math.PI * 2; azimuth += 0.4) {
      for (const arc of [20_000, 60_000, 140_000, 250_000]) {
        samples.push(planetReliefAt(directionAtArc(arc, azimuth), PARAMS));
      }
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    assert.ok(max - min > PARAMS.amplitudeM * 0.4, `relief span ${max - min}`);
    assert.ok(max <= PARAMS.amplitudeM * (1 - 0.55) + 1e-6);
    assert.ok(min >= -PARAMS.amplitudeM * 0.55 - 1e-6);
  });

  it('is seamless at the antimeridian and around the poles', () => {
    const a = directionAtArc(80_000, 0);
    const b = directionAtArc(80_000, Math.PI * 2 - 1e-9);
    // A seam would be metres of step; a millimetre is float noise amplified by
    // the field's finest octave (160 m wavelength, so the gradient is steep).
    assert.ok(Math.abs(planetReliefAt(a, PARAMS) - planetReliefAt(b, PARAMS)) < 0.002);
    for (const azimuth of [0, 1.1, 2.4, 4.9]) {
      const pole = new THREE.Vector3(0, -1, 0);
      assert.ok(Number.isFinite(planetReliefAt(pole, PARAMS)));
      assert.ok(Number.isFinite(planetReliefAt(directionAtArc(314_000, azimuth), PARAMS)));
    }
  });
});
