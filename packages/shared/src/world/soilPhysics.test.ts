import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  angleOfReposeRad,
  bulkDensityKgM3,
  cavityCollapseRatePerS,
  cavityVoidAfter,
  cohesionKPa,
  compactionAfter,
  maxUnsupportedSpanM,
  porosity,
  DEFAULT_SOIL_PHYSICS as soil,
  voidRatio,
} from './soilPhysics.ts';

test('bulk density rises with water and with compaction', () => {
  const dry = bulkDensityKgM3(soil, 0);
  const damp = bulkDensityKgM3(soil, 0.5);
  const saturated = bulkDensityKgM3(soil, 1);
  assert.ok(dry < damp && damp < saturated);
  assert.ok(bulkDensityKgM3(soil, 0.5, 0.9) > bulkDensityKgM3(soil, 0.5, 0.1));
});

test('porosity and void ratio stay physical', () => {
  const density = bulkDensityKgM3(soil, 0.3);
  const n = porosity(soil, density);
  assert.ok(n > soil.porosityMin && n < soil.porosityMax);
  const e = voidRatio(soil, density);
  assert.ok(e > 0 && e < 1.5);
});

test('cohesion peaks when damp and collapses when saturated', () => {
  const dry = cohesionKPa(soil, 0.05);
  const damp = cohesionKPa(soil, 0.45);
  const saturated = cohesionKPa(soil, 1);
  assert.ok(damp > dry, 'damp soil holds better than bone dry');
  assert.ok(damp > saturated, 'saturated soil loses suction');
  assert.ok(saturated >= soil.cohesionSaturatedKPa - 1e-9);
});

test('angle of repose shallows as soil wets', () => {
  const dry = angleOfReposeRad(soil, 0);
  const wet = angleOfReposeRad(soil, 1);
  assert.ok(dry > wet);
  assert.ok(Math.abs(wet - (soil.reposeSaturatedDeg * Math.PI) / 180) < 1e-9);
});

test('stable span shrinks as soil saturates', () => {
  const dry = maxUnsupportedSpanM(soil, 0);
  const wet = maxUnsupportedSpanM(soil, 1);
  assert.ok(dry > wet);
  assert.ok(wet >= 0);
});

test('small cavities stand, large wet ones collapse', () => {
  const stable = cavityCollapseRatePerS(soil, 0.1, 0.6, 0.05);
  const unstable = cavityCollapseRatePerS(soil, 0.9, 0.2, 2);
  assert.equal(stable, 0);
  assert.ok(unstable > 0);
});

test('cavity void decays towards zero and never goes negative', () => {
  let voidage = 1;
  for (let i = 0; i < 40; i += 1) {
    voidage = cavityVoidAfter(soil, voidage, 0.5, 0.95, 0.15, 3);
  }
  assert.ok(voidage < 0.05);
  assert.ok(voidage >= 0);
});

test('a stable cavity is not filled in', () => {
  assert.equal(cavityVoidAfter(soil, 1, 10, 0.05, 0.9, 0.02), 1);
});

test('loose soil settles toward the equilibrium density', () => {
  const settled = compactionAfter(soil, 0.2, 5, 0.4);
  assert.ok(settled > 0.2);
  assert.ok(settled <= 0.55 + 1e-9);
  const overPacked = compactionAfter(soil, 0.95, 5, 0.4);
  assert.ok(overPacked < 0.95);
});
