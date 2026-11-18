import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localSkyBrightness } from './localBrightness.ts';

const grade = (overrides: Partial<Parameters<typeof localSkyBrightness>[0]> = {}) =>
  localSkyBrightness({ localTileLight: 80, tileLightBase: 80, dayFactor: 1, ...overrides });

describe('localSkyBrightness', () => {
  it('reads a full-day tile as daylight', () => {
    assert.equal(grade(), 1);
  });

  it('reads a shaded tile as shade, never as black', () => {
    assert.equal(grade({ localTileLight: 0 }), 0.55);
    assert.equal(grade({ localTileLight: 40 }), 0.775);
  });

  it('follows the clock until the first tile packet arrives', () => {
    // A seed that has not rooted has no covered tiles: the default used to be
    // full daylight, so its first packet moved the sky in one step.
    assert.equal(grade({ localTileLight: null, dayFactor: 1 }), 1);
    assert.equal(grade({ localTileLight: null, dayFactor: 0.5 }), 0.775 * 0.56);
  });

  it('keeps the sky dark at night even when the tiles still read as lit', () => {
    // The sky's colours come from the weather state, not the hour: without the
    // sun's own ceiling a clear 4 am was drawn in daylight blue because the
    // tiles under the plant still reported light.
    const midnight = grade({ localTileLight: 80, dayFactor: 0 });
    const noon = grade({ localTileLight: 80, dayFactor: 1 });
    assert.ok(midnight < noon * 0.15, `midnight ${midnight} should be far below noon ${noon}`);
    assert.ok(midnight > 0, 'night must not go black');
  });

  it('lets light above full day brighten a little further', () => {
    assert.ok(grade({ localTileLight: 120 }) > 1);
    assert.equal(grade({ localTileLight: 120 }), 1.125);
  });

  it('survives a missing or zero tile base', () => {
    assert.equal(grade({ tileLightBase: 0 }), 1);
    assert.equal(grade({ tileLightBase: Number.NaN }), 1);
  });

  it('treats a non-finite reading as no reading', () => {
    assert.equal(grade({ localTileLight: Number.NaN, dayFactor: 0 }), 0.55 * 0.12);
  });
});
