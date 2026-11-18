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
    assert.equal(grade({ localTileLight: null, dayFactor: 0.5 }), 0.775);
  });

  it('says how lit the ground is, not what hour it is', () => {
    // Night is the sky's own decision (`gradeSkyTarget`): a tile-light ceiling
    // here was the second of two treatments for one hour, so this grade reads
    // the same under the moon as under the sun.
    assert.equal(grade({ dayFactor: 0 }), grade({ dayFactor: 1 }));
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
    assert.equal(grade({ localTileLight: Number.NaN, dayFactor: 0 }), 0.55);
  });
});
