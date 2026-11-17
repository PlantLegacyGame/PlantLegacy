import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groundWorldY, isBelowSoil } from './underground.ts';

// A field shaped like the shipped one: hills up to 26 m over a 620 m patch.
const HILLY = {
  seed: 1337,
  amplitudeM: 26,
  baseFrequency: 0.045,
  octaves: 4,
  lacunarity: 2,
  gain: 0.5,
  ridgeStrength: 0.35,
  patchRadiusM: 620,
  rimFadeFraction: 0.28,
  maxDepthM: 12,
  soilDepthM: 0.8,
};

const FLAT = { ...HILLY, amplitudeM: 0 };

const PLANET_RADIUS_M = 100_000;

/** First point on a coarse grid that stands at least `atLeast` metres up. */
function findRise(surface: { planetRadiusM: number; terrain: typeof HILLY }, atLeast: number) {
  for (let x = 0; x <= 500; x += 5) {
    for (let z = 0; z <= 500; z += 5) {
      const ground = groundWorldY(surface, x, z);
      if (ground >= atLeast) return { x, z, ground };
    }
  }
  throw new Error(`no point rises ${atLeast} m above the base surface`);
}

describe('underground tests', () => {
  it('treats the flat world as ground at zero', () => {
    const surface = { planetRadiusM: 0, terrain: FLAT };
    assert.equal(groundWorldY(surface, 0, 0), 0);
    assert.equal(isBelowSoil({ x: 0, y: -1, z: 0 }, surface), true);
    assert.equal(isBelowSoil({ x: 0, y: 1, z: 0 }, surface), false);
    assert.equal(isBelowSoil({ x: 0, y: 0, z: 0 }, surface), false);
  });

  it('classifies a camera under a hill as underground even with a positive Y', () => {
    const surface = { planetRadiusM: PLANET_RADIUS_M, terrain: HILLY };
    const rise = findRise(surface, 12);
    assert.ok(rise.ground >= 12, `expected a rise of at least 12 m, got ${rise.ground}`);

    // The old rule was `y < 0`, which called this point above ground although it
    // is 12+ metres inside the hill.
    assert.equal(isBelowSoil({ x: rise.x, y: 0, z: rise.z }, surface), true);

    // One metre above the drawn ground at the same place is still above it.
    assert.equal(isBelowSoil({ x: rise.x, y: rise.ground + 1, z: rise.z }, surface), false);
  });

  it('keeps a camera resting on the drawn ground on the surface', () => {
    const surface = { planetRadiusM: PLANET_RADIUS_M, terrain: HILLY };
    const rise = findRise(surface, 12);
    // Exactly on the skin is not "under" it; this is the case that would have
    // flipped the root-layer floor on for an eye standing on the ground.
    assert.equal(isBelowSoil({ x: rise.x, y: rise.ground, z: rise.z }, surface), false);
    // Resting on the spawn ground, whatever height the relief puts it at. (At
    // the spawn the relief lifts the ground above y = 0, so y = 0 is genuinely
    // underground there - the reason the old `y < 0` test was wrong.)
    const spawnGround = groundWorldY(surface, 0, 0);
    assert.equal(isBelowSoil({ x: 0, y: spawnGround, z: 0 }, surface), false);
  });

  it('honours a caller tolerance for "clearly underground"', () => {
    const surface = { planetRadiusM: 0, terrain: FLAT };
    const justUnder = { x: 0, y: -0.03, z: 0 };
    assert.equal(isBelowSoil(justUnder, surface), true);
    assert.equal(isBelowSoil(justUnder, surface, 0.05), false);
    assert.equal(isBelowSoil({ x: 0, y: -0.2, z: 0 }, surface, 0.05), true);
  });

  it('never reports a non-finite height as underground', () => {
    const surface = { planetRadiusM: 0, terrain: FLAT };
    assert.equal(isBelowSoil({ x: 0, y: Number.NaN, z: 0 }, surface), false);
  });
});
