/**
 * Guard for the two rules that keep water out of the Root Sight cavity.
 *
 * The water shader is a template string, so this reads its source the same way
 * `groundCutaway.test.ts` reads the soil shader: a plan-view disc alone left the
 * pit full of water, because the water a looker sees through the opening sits
 * metres further out in XZ than the opening itself.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'waterMaterial.ts'),
  'utf8',
);

test('water under the opening is dropped, and its edge dissolves rather than cutting', () => {
  // The clip is still the plan column, but it ends in alpha: a hard discard left
  // the water's own edge as a one-pixel blue line against the pit's rim.
  assert.match(
    source,
    /cavityAlpha = smoothstep\(uCavityRadius \* 0\.9, uCavityRadius, cavityDist\);/,
  );
  assert.match(source, /if \(cavityAlpha <= 0\.002\) discard;/);
  assert.match(source, /alpha \*= cavityAlpha;/);
});

test('the clip has no height bound, upper or lower', () => {
  // A mouth-plane ceiling kept the lake surface that laps above a shore pit,
  // and the cut's floor budget left the water table standing at the bottom of
  // it. Both looked like water/ground seen through the opening. Inside the plan
  // column the water is gone at every height, and that is the whole rule.
  assert.doesNotMatch(source, /uCavityTopY/);
  assert.doesNotMatch(source, /uCavityBottomY/);
});

test('the stream surface sits on its bed instead of a depth above it', () => {
  // The surveyed depth belongs to the water column (`aWater`), not to the
  // geometry: adding it to the vertex height made the stream a slab proud of its
  // banks, and the slab ran across the Root Sight opening instead of being cut.
  const field = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'waterField.ts'),
    'utf8',
  );
  assert.match(field, /const y = bed \+ RIVER_FILM_LIFT_M;/);
  assert.doesNotMatch(
    field,
    /const y = bed \+ Math\.max\(0\.02, Math\.min\(0\.6, river\.waterDepthM\)\);/,
  );
});

test('the river reports the surface it renders, not its surveyed depth', () => {
  // Standing-in-water and the cavity clip's top both read this. Reporting
  // bed + 0.6 m while the ribbon is a 2 cm film made the camera submerged early
  // and lifted the clip's top above the rim.
  const field = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'waterField.ts'),
    'utf8',
  );
  assert.match(field, /height: surfaceYAt\(x, z\) \+ RIVER_FILM_LIFT_M,/);
});

test('water outside the opening volume is kept, wherever the eye is', () => {
  // The three ray tests that used to live here reached across the map: the
  // closest-point test is a strip through the cavity centre, so a lower river
  // seen past an open pit lost a seam of water, and water standing above the
  // ground was clipped whenever a sightline crossed the mouth plane. One volume,
  // the same one the soil cuts, is the whole rule now.
  assert.doesNotMatch(source, /uCavityEye/);
  assert.doesNotMatch(source, /sightT/);
  assert.doesNotMatch(source, /closestY/);
});

test('the clip is the aperture plan column, edged with alpha', () => {
  assert.match(source, /uniform float uCavityRadius;/);
  assert.match(
    source,
    /cavityAlpha = smoothstep\(uCavityRadius \* 0\.9, uCavityRadius, cavityDist\);/,
  );
  assert.match(source, /float cavityDist = length\(cavity\);/);
  assert.doesNotMatch(source, /cavity\) < uCavityRadius \* uCavityRadius\) discard;/);
});
