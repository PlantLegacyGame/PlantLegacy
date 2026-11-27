import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ATMOSPHERE_UNIFORMS,
  type AtmosphereParams,
  airMass,
  applyAtmosphere,
  applyAtmosphereRay,
  atmosphereFromConfig,
  atmosphereUniformValues,
  DEFAULT_ATMOSPHERE,
  GLSL_ATMOSPHERE,
  heightDensity,
  inScatterColor,
  phaseHG,
  RAY_SAMPLES,
  transmittance,
  transmittanceRay,
} from './atmosphere.ts';

const SUN: [number, number, number] = [0, 1, 0];
const HORIZON: [number, number, number] = [1, 0, -0.2];
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

test('density is 1 at ground level and falls by 1/e at the scale height', () => {
  assert.equal(heightDensity(0, DEFAULT_ATMOSPHERE), 1);
  assert.ok(near(heightDensity(700, DEFAULT_ATMOSPHERE), Math.exp(-1)));
  // Below the reference level the air does not get denser than sea level.
  assert.equal(heightDensity(-50, DEFAULT_ATMOSPHERE), 1);
});

test('air mass is 1 overhead and far larger along the horizon', () => {
  assert.ok(near(airMass(1), 1, 0.01));
  assert.ok(airMass(0) > 15, 'the horizon should cross far more air than the zenith');
  assert.ok(airMass(0.5) > airMass(1));
  // Clamped for a sun below the horizon rather than going complex.
  assert.ok(Number.isFinite(airMass(-3)));
});

test('transmittance is 1 with no distance and cools with distance', () => {
  const zero = transmittance(0, 0, DEFAULT_ATMOSPHERE);
  assert.deepEqual(zero, [1, 1, 1]);

  const far = transmittance(1000, 0, DEFAULT_ATMOSPHERE);
  assert.ok(far[0] < 1 && far[1] < 1 && far[2] < 1);
  // Blue is extinguished fastest, so distance reads cooler than the surface.
  assert.ok(far[2] < far[0]);

  const closer = transmittance(500, 0, DEFAULT_ATMOSPHERE);
  assert.ok(closer[0] > far[0] && closer[2] > far[2]);
});

test('high ground sees less air than low ground at the same distance', () => {
  const low = transmittance(1000, 0, DEFAULT_ATMOSPHERE);
  const high = transmittance(1000, 5000, DEFAULT_ATMOSPHERE);
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(high[channel] > low[channel]);
  }
});

test('phase is isotropic at g = 0 and forward-peaked above it', () => {
  assert.ok(near(phaseHG(0.3, 0), 1));
  assert.ok(phaseHG(1, DEFAULT_ATMOSPHERE.sunPhaseG) > phaseHG(-1, DEFAULT_ATMOSPHERE.sunPhaseG));
  assert.ok(phaseHG(1, DEFAULT_ATMOSPHERE.sunPhaseG) > 1);
});

test('in-scatter is brighter looking into the sun than away from it', () => {
  const towardSun = inScatterColor(SUN, SUN, DEFAULT_ATMOSPHERE);
  const away = inScatterColor([0, 0, -1] as [number, number, number], SUN, DEFAULT_ATMOSPHERE);
  assert.ok(towardSun[0] > away[0]);
  assert.ok(towardSun[0] > 0);
  // Warm light through air: red survives further than blue.
  assert.ok(towardSun[0] > towardSun[2]);
});

test('a surface at zero distance is unchanged by the air', () => {
  const surface: [number, number, number] = [0.2, 0.5, 0.1];
  const out = applyAtmosphere(surface, HORIZON, SUN, 0, 0, DEFAULT_ATMOSPHERE);
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(near(out[channel], surface[channel], 1e-9));
  }
});

test('a distant surface converges on the in-scatter colour', () => {
  const scatter = inScatterColor(HORIZON, SUN, DEFAULT_ATMOSPHERE);
  const out = applyAtmosphere([0, 0, 0], HORIZON, SUN, 100000, 0, DEFAULT_ATMOSPHERE);
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(out[channel] - scatter[channel]) < 1e-3);
  }
});

test('config values are read and clamped', () => {
  const params = atmosphereFromConfig({
    atmosphereExtinction: [-1, 0.001, Number.NaN],
    atmosphereScaleHeightM: 0,
    atmosphereSunPhaseG: 3,
    atmosphereInScatter: -2,
    atmosphereHorizonBoost: -1,
  } as unknown as Parameters<typeof atmosphereFromConfig>[0]);

  assert.equal(params.extinction[0], 0);
  assert.equal(params.extinction[1], 0.001);
  assert.equal(params.extinction[2], DEFAULT_ATMOSPHERE.extinction[2]);
  assert.equal(params.scaleHeightM, 1);
  assert.equal(params.sunPhaseG, 0.95);
  assert.equal(params.inScatter, 0);
  assert.equal(params.horizonBoost, 0);
});

test('ray transmittance agrees with the single-height one on level ground', () => {
  // Every view from inside the play area has both ends at about zero height, so
  // the two-end model must not change what the world already looked like there.
  const flat = transmittanceRay(5000, 2, 2, DEFAULT_ATMOSPHERE);
  const old = transmittance(5000, 2, DEFAULT_ATMOSPHERE);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(near(flat[i] ?? 0, old[i] ?? 0, 1e-6));
  }
});

test('the air is integrated along the ray, so height at the eye matters', () => {
  // 40 km up, looking at the ground: the chord is almost all thin air, so the
  // surface must keep far more of its own colour than the sea-level model says.
  const fromGround = transmittanceRay(40000, 2, 2, DEFAULT_ATMOSPHERE);
  const fromSky = transmittanceRay(40000, 40000, 2, DEFAULT_ATMOSPHERE);
  assert.ok((fromSky[0] ?? 0) > (fromGround[0] ?? 0) + 0.5);
  // A middle altitude sits between the two, in every channel.
  const fromHill = transmittanceRay(40000, 3000, 2, DEFAULT_ATMOSPHERE);
  for (let i = 0; i < 3; i += 1) {
    assert.ok((fromHill[i] ?? 0) > (fromGround[i] ?? 0));
    assert.ok((fromHill[i] ?? 0) < (fromSky[i] ?? 0));
  }
});

test('a ray that climbs keeps more light than one that stays low', () => {
  // Looking up a slope: the far end is higher, and the chord must be thinner.
  const level = transmittanceRay(3000, 10, 10, DEFAULT_ATMOSPHERE);
  const climbing = transmittanceRay(3000, 10, 1500, DEFAULT_ATMOSPHERE);
  assert.ok((climbing[0] ?? 0) > (level[0] ?? 0));
});

test('a surface seen through thin air keeps more of its own colour', () => {
  const surface: [number, number, number] = [0.2, 0.3, 0.1];
  const low = applyAtmosphereRay(surface, HORIZON, SUN, 40000, 2, 2, DEFAULT_ATMOSPHERE);
  const high = applyAtmosphereRay(surface, HORIZON, SUN, 40000, 40000, 2, DEFAULT_ATMOSPHERE);
  for (let i = 0; i < 3; i += 1) {
    const surfaceChannel = surface[i] ?? 0;
    assert.ok(Math.abs((high[i] ?? 0) - surfaceChannel) < Math.abs((low[i] ?? 0) - surfaceChannel));
  }
});

test('uniform values cover every uniform the GLSL declares', () => {
  const values = atmosphereUniformValues(DEFAULT_ATMOSPHERE);
  for (const name of ATMOSPHERE_UNIFORMS) {
    assert.ok(name in values, `${name} has no value`);
    assert.ok(GLSL_ATMOSPHERE.includes(name), `${name} is not declared by the snippet`);
  }
  for (const fn of [
    'atmoHeightDensity',
    'atmoAirMass',
    'atmoTransmittance',
    'atmoTransmittanceRay',
    'atmoPhaseHG',
  ]) {
    assert.ok(GLSL_ATMOSPHERE.includes(fn), `${fn} missing from the GLSL mirror`);
  }
  assert.ok(GLSL_ATMOSPHERE.includes('atmoApply'));
  assert.ok(GLSL_ATMOSPHERE.includes('atmoApplyRay'));
  assert.equal(RAY_SAMPLES, 4, 'the GLSL mirror integrates four midpoints');
});

test('the two mirrors keep the same phase normalisation', () => {
  // The GLSL mirror must not reintroduce the raw 1/4pi lobe the TS normalised
  // away: at g = 0 both must return 1 for an isotropic lobe.
  assert.ok(!GLSL_ATMOSPHERE.includes('4.0 * ATMO_PI'));
  assert.ok(!GLSL_ATMOSPHERE.includes('ATMO_PI'));
  const isotropic: AtmosphereParams = { ...DEFAULT_ATMOSPHERE, sunPhaseG: 0 };
  assert.ok(near(phaseHG(-0.4, isotropic.sunPhaseG), 1));
});
