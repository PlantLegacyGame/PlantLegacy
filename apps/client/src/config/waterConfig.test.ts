import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_WATER_COLORS,
  DEFAULT_WATER_FIELD_TUNING,
  parseWaterTuning,
  sheetFadeRange,
} from '../renderers/environment/waterFieldTuning.ts';

describe('water tuning from config', () => {
  it('reads the three water colours as palette roles', () => {
    const tuning = parseWaterTuning({
      water_deep_color: 'water_deep',
      water_shallow_color: 'water_shallow',
      water_sky_color: 'sky_horizon',
    });
    assert.deepEqual(tuning.colors, {
      deep: 'water_deep',
      shallow: 'water_shallow',
      sky: 'sky_horizon',
    });
  });

  it('falls back per colour instead of painting nothing', () => {
    const tuning = parseWaterTuning({
      water_deep_color: '#163a45',
      water_shallow_color: 'Water Deep',
      // sky omitted
    });
    assert.deepEqual(tuning.colors, DEFAULT_WATER_COLORS);
  });

  it('keeps the documented defaults for missing or broken numbers', () => {
    const tuning = parseWaterTuning({ surface_cells: 'many', water_absorption_per_m: 2.2 });
    assert.equal(tuning.surfaceCells, DEFAULT_WATER_FIELD_TUNING.surfaceCells);
    assert.equal(tuning.absorptionPerM, 2.2);
  });

  it('never returns undefined for a field the renderer reads', () => {
    const tuning = parseWaterTuning({});
    for (const [key, value] of Object.entries(tuning)) {
      assert.notEqual(value, undefined, key);
    }
    // Every field the renderer requires is present, so spreading it over the
    // defaults cannot leave a hole.
    for (const key of Object.keys(DEFAULT_WATER_FIELD_TUNING)) {
      assert.ok(key in tuning, `${key} missing from parsed tuning`);
    }
  });

  it('reads where the sheet edge fade starts', () => {
    assert.equal(parseWaterTuning({ sheet_edge_fade: 0.6 }).sheetEdgeFade, 0.6);
  });
});

describe('water sheet edge fade', () => {
  it('fades out inside the grid, never at a straight boundary', () => {
    const range = sheetFadeRange(64, 0.82);
    assert.ok(range.startM > 0 && range.startM < 64, 'fade must start inside the sheet');
    assert.equal(range.endM, 64);
    assert.ok(range.startM / 64 === 0.82);
  });

  it('keeps a visible core even when the fraction is out of range', () => {
    assert.deepEqual(sheetFadeRange(50, 0), { startM: 10, endM: 50 });
    assert.deepEqual(sheetFadeRange(50, 4), { startM: 49, endM: 50 });
  });

  it('degenerates to nothing for an empty sheet', () => {
    assert.deepEqual(sheetFadeRange(0, 0.8), { startM: 0, endM: 0 });
  });
});
