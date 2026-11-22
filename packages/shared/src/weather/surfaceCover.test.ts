import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  coverStrength,
  DRIFT_FLOOR,
  MAX_COVER_STEP_S,
  PUDDLE_FLOOR,
  SURFACE_COVER_RULES,
  stepSurfaceCover,
} from './surfaceCover.ts';

const dry = { water: 0, snow: 0 };
const seconds = (cover = dry, climate = { rain: 0, snow: 0 }, dt = 1) =>
  stepSurfaceCover(cover, climate, dt);

describe('surface cover rules', () => {
  it('fills water from rain in proportion to its intensity', () => {
    const steady = seconds(dry, { rain: 0.8, snow: 0 }, 1).water;
    const downpour = seconds(dry, { rain: 1, snow: 0 }, 1).water;
    assert.ok(steady > 0, 'a steady rain added no water');
    assert.ok(
      downpour > steady,
      `a downpour (${downpour}) was not wetter than a steady rain (${steady})`,
    );
    // The rate is the shared one, so the numbers stay where the 3D ground had them.
    assert.ok(Math.abs(downpour - SURFACE_COVER_RULES.waterFill) < 1e-9);
  });

  it('has a drizzle wet the soil without making a pool', () => {
    // Break-even is `waterDry / (waterFill + waterDry)`, about 0.40: below it the
    // loss wins, which is why a drizzle darkens the dirt and leaves no lakes. Rain
    // above it fills a pool and rain below it drains one.
    assert.equal(seconds(dry, { rain: 0.25, snow: 0 }, 1).water, 0);
    const pool = { water: 0.5, snow: 0 };
    assert.ok(seconds(pool, { rain: 0.25, snow: 0 }, 1).water < pool.water);
    assert.ok(seconds(pool, { rain: 0.9, snow: 0 }, 1).water > pool.water);
  });

  it('drains after the rain, and a light rain loses more than it gains', () => {
    const wet = { water: 0.6, snow: 0 };
    const after = seconds(wet, { rain: 0, snow: 0 }, 1);
    assert.ok(after.water < wet.water, 'standing water did not dry');
    assert.ok(Math.abs(wet.water - after.water - SURFACE_COVER_RULES.waterDry) < 1e-9);
    // A drizzle against a full dry rate: the loss term is (1 - rain) of the dry rate.
    const drizzle = seconds(wet, { rain: 0.05, snow: 0 }, 1).water;
    assert.ok(drizzle < wet.water, 'a drizzle topped the pool up instead of keeping it down');
  });

  it('settles snow slowly, melts it slower, and lets rain wash it away', () => {
    const settled = seconds(dry, { rain: 0, snow: 1 }, 1).snow;
    assert.ok(Math.abs(settled - SURFACE_COVER_RULES.snowFill) < 1e-9);
    const drift = { water: 0, snow: 0.5 };
    const melted = seconds(drift, { rain: 0, snow: 0 }, 1).snow;
    const washed = seconds(drift, { rain: 1, snow: 0 }, 1).snow;
    assert.ok(melted < 0.5, 'a drift did not melt in dry air');
    assert.ok(washed < melted, 'rain did not take more snow than the air did');
  });

  it('stops at full and never goes below dry', () => {
    let cover = { water: 0, snow: 0 };
    for (let i = 0; i < 600; i += 1) cover = stepSurfaceCover(cover, { rain: 1, snow: 1 }, 1);
    assert.equal(cover.water, 1);
    assert.equal(cover.snow, 1);
    for (let i = 0; i < 600; i += 1) cover = stepSurfaceCover(cover, { rain: 0, snow: 0 }, 1);
    assert.equal(cover.water, 0);
    assert.equal(cover.snow, 0);
  });

  it('does not flood a column when a tab comes back after a long gap', () => {
    const after = stepSurfaceCover(dry, { rain: 1, snow: 0 }, 600);
    assert.ok(Math.abs(after.water - SURFACE_COVER_RULES.waterFill * MAX_COVER_STEP_S) < 1e-9);
  });

  it('draws nothing below the floors and everything at full cover', () => {
    assert.equal(coverStrength(PUDDLE_FLOOR - 0.01, PUDDLE_FLOOR), 0);
    assert.equal(coverStrength(0.55, PUDDLE_FLOOR), 1);
    assert.ok(coverStrength(0.3, PUDDLE_FLOOR) > 0.2 && coverStrength(0.3, PUDDLE_FLOOR) < 0.8);
    assert.equal(coverStrength(0, DRIFT_FLOOR), 0);
    assert.ok(coverStrength(0.4, DRIFT_FLOOR) > 0);
  });
});
