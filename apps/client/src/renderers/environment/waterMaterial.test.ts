import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const SOURCE = readFileSync(new URL('./waterMaterial.ts', import.meta.url), 'utf8');

describe('water alpha fades', () => {
  it('only fades over a range that has a width', () => {
    // "No fade" is a pair of equal numbers, and smoothstep(edge, edge, x) divides
    // by (edge - edge). ANGLE/D3D answers 1 for it, which zeroed the alpha and
    // discarded the entire surface: the planet-wide sea was invisible from every
    // camera outside the play area's dome, and the standing-water sheet set the
    // same pair and never drew its own top. Both fades are now guarded by their
    // own width, so an empty range means "no fade" on every driver instead of
    // whatever the division happens to produce.
    assert.match(
      SOURCE,
      /if \(uFadeRange\.y > uFadeRange\.x\) \{\s*\n\s*alpha \*= 1\.0 - smoothstep\(uFadeRange\.x/,
      'the distance fade must be wrapped in its own range test',
    );
    assert.match(
      SOURCE,
      /if \(uAltitudeFade\.y > uAltitudeFade\.x\) \{\s*\n\s*alpha \*= 1\.0 - smoothstep\(uAltitudeFade\.x/,
      'the altitude handover must be wrapped in its own range test',
    );
  });

  it('keeps an undefined sheet edge off the alpha', () => {
    assert.match(SOURCE, /if \(uSheetFade\.y > 0\.0\) \{/);
  });

  it('makes the sea swell noise, not a train of cosines', () => {
    // Two long trains were a corduroy of parallel stripes across the whole disc
    // at thirty kilometres, and a crossing pair was a woven checkerboard: any
    // cosine on the surface has a wavelength, and the eye finds it. The swell
    // is a value-noise field on the surface point now, sampled on all three
    // axes, so there is no direction and no period to lock on to.
    assert.match(SOURCE, /float seaNoise\(vec3 x\)/);
    assert.match(SOURCE, /float seaSwell\(vec3 p\)/);
    assert.match(SOURCE, /sum \+= \(seaNoise\(q\) - 0\.5\) \* amp \* aa;/);
    assert.match(SOURCE, /float lift = 0\.5 \+ [0-9.]+ \* seaSwell\(swellPoint\);/);
    assert.doesNotMatch(
      SOURCE,
      /kSwellA/,
      'a periodic swell train is back; it will band at altitude',
    );
  });

  it('retires each swell octave on its own screen footprint', () => {
    // An octave finer than a pixel contributes a moire, not detail. Each one is
    // faded by fwidth of its own scaled coordinate, so the field settles to its
    // mean at exactly the scale the screen can no longer draw.
    assert.match(
      SOURCE,
      /float foot = max\(max\(fwidth\(q\.x\), fwidth\(q\.y\)\), fwidth\(q\.z\)\);/,
    );
    assert.match(SOURCE, /float aa = 1\.0 - smoothstep\(0\.30, 0\.75, foot\);/);
  });
});
