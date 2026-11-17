/**
 * The growth quote and the growth charge must be the same number.
 *
 * The nutrient cost was quoted (and shown in the growth menu) but never taken:
 * the build step drew water and structural minerals only, and `canGrow` then
 * compared the mineral store with `growth_min_nutrients` *and*
 * `growth_min_minerals` in turn. Both thresholds read one store, so checking
 * them separately only ever compared minerals with the larger of the two.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GrowthConfig, Plant } from '@plant-legacy/shared/growth';

import { canGrow, growthDrawPerSecond } from './rules.ts';

/** Just the fields these rules read; the rest of a config is irrelevant here. */
function config(overrides: Partial<GrowthConfig> = {}): GrowthConfig {
  return {
    growthMinWater: 12,
    growthMinMinerals: 6,
    growthMinNutrients: 8,
    growthMinHealth: 0,
    growthWaterConsumptionRate: 0.15,
    growthMineralConsumptionRate: 0.1,
    growthNutrientConsumptionRate: 0.1,
    ...overrides,
  } as GrowthConfig;
}

/** A plant with no tissue: `plantHealth` reads an empty plant as fully healthy. */
function plant(storedWater: number, storedMinerals: number): Plant {
  return {
    nodes: new Map(),
    storedWater,
    storedMinerals,
  } as unknown as Plant;
}

test('a part draws its nutrient share out of minerals', () => {
  const draw = growthDrawPerSecond(config(), 8);
  assert.equal(draw.water, 1.2);
  // 0.1 structural + 0.1 nutrient, per second per unit of build cost.
  assert.equal(draw.minerals, 1.6);
});

test('the mineral gate is the sum of the mineral and nutrient thresholds', () => {
  // 14 is what the two thresholds add up to; 12 is more than each one alone.
  const gate = canGrow(plant(40, 12), config());
  assert.equal(gate.ok, false);
  assert.match(gate.reason ?? '', /12\.0 < 14\.0/);

  assert.equal(canGrow(plant(40, 14), config()).ok, true);
});

test('clonal sharing discounts both mineral thresholds together', () => {
  const gate = canGrow(plant(40, 8), config(), 0.5);
  assert.equal(gate.ok, true);
  assert.equal(canGrow(plant(40, 6), config(), 0.5).ok, false);
});
