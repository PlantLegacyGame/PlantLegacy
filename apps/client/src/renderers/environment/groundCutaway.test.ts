/**
 * Guard for the one line that decides whether Root Sight works from inside.
 *
 * The soil is a double-sided skin, so an aperture cut that only applies to
 * front faces leaves the earth a closed ceiling from underneath: the cavity
 * was visible from outside and from above, and from inside the ground it was
 * solid dirt. The shader lives in a template string, so this reads the source
 * instead of the compiled GLSL - it is the only place the mistake can regress.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'ground.ts'), 'utf8');
// The soil's GLSL lives in its own module so the material file is not 700 lines
// of template string; the guards below inspect the shader, so they read both.
const shaderSource = readFileSync(join(here, 'ground', 'shaderOverrides.ts'), 'utf8');
const shader = source + shaderSource;

test('the soil is rendered as a double-sided skin', () => {
  // If this ever becomes a single-sided shell, "from inside" stops meaning
  // anything and the aperture test below would be moot rather than wrong.
  assert.match(source, /side:\s*THREE\.DoubleSide/);
});

test('the cavity aperture is cut on both faces', () => {
  const cutBlocks = shader.match(/if \(vSurfaceCut > 0\.5 && uRootSightProgress > 0\.01\)/g) ?? [];
  assert.equal(cutBlocks.length, 2, 'the cut and the earthen lip both run on both faces');
  assert.ok(
    !/if \(vSurfaceCut > 0\.5 && uRootSightProgress > 0\.01 && gl_FrontFacing\)/.test(shader),
    'a front-face-only cut leaves the earth closed from underneath',
  );
  // The discard itself must not be rebuilt from a cut mask that only the front
  // face ever computed - that was the actual mechanism of the closed ceiling.
  assert.match(shader, /if \(cavityMask > rimNoise\) discard;/);
});

test('the aperture is cut as a volume, not a plan-view disc', () => {
  // A disc with no vertical bound cut a horizontal core through any hillside it
  // opened on, and the same X/Z on the far side of the planet.
  assert.match(
    shader,
    /bool insideColumn =\s*vSoilWorldPos\.y <= uRootSightApertureTopY &&\s*vSoilWorldPos\.y >= uRootSightApertureBottomY;/,
  );
  assert.match(shader, /uniform float uRootSightApertureBottomY;/);
});

test('the configured rim dither is the edge, not a hard smoothstep', () => {
  // `cut_rim_dither_m` was parsed and never used, so the opening ended on an
  // aliased circle no matter what the file said.
  assert.match(shader, /uniform float uRootSightRimDitherM;/);
  assert.match(
    shader,
    /float dither = min\(max\(uRootSightRimDitherM, 0\.0\), apertureRadius \* 0\.5\);/,
  );
  assert.match(shader, /float rimNoise = fract\(/);
});

test('every soil patch is cut, so the pit does not vanish past the detail edge', () => {
  // The outer LOD ring used to be `aSurfaceCut = false`; after a reroot past the
  // 180 m detail patch it covered the opening with a solid sheet.
  assert.doesNotMatch(shader, /setSurfaceCut\([^)]*,\s*false\)/);
  assert.match(shader, /setSurfaceCut\(patches\.outer, true\)/);
});

test('the underground rim shading stays a surface effect', () => {
  // The lip is what used to draw a bright ring around the opening when seen
  // from below, so it is deliberately faded out with the eye under the soil.
  assert.match(shader, /lip \* \(eyeIsUnder \? 0\.0 : 0\.55\)/);
});
