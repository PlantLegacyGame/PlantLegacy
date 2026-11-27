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
  // The opening itself must not be rebuilt from a cut mask that only the front
  // face ever computed - that was the actual mechanism of the closed ceiling.
  assert.match(shader, /gl_FragColor\.a = min\(gl_FragColor\.a, 1\.0 - cavityMask\);/);
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

test('the rim is a coverage edge a pixel wide, with no fixed-width band', () => {
  assert.match(shader, /float edge = max\(fwidth\(apertureDist\), 1e-5\);/);
  assert.match(shader, /gl_FragColor\.a = min\(gl_FragColor\.a, 1\.0 - cavityMask\);/);
  assert.doesNotMatch(shader, /rimNoise/);
});

test('every soil mesh is cut, so the pit never vanishes into solid ground', () => {
  // There is no outer LOD ring any more: one play disk and one static globe.
  assert.doesNotMatch(shader, /setSurfaceCut\([^)]*,\s*false\)/);
  assert.match(shader, /setSurfaceCut\(disk, true\)/);
});

test('a buried eye in the pit does not see the underside of the ground beyond the rim', () => {
  // At lip height that underside is a wall of soil across the frame, with the
  // pit's sky behind it: the eye is under the sheet, so every fragment of the
  // ground past the rim it faces is a back face (R23). Only back faces above
  // the eye go; the uphill ground's front faces and everything below the eye
  // are still dirt a buried eye really can see.
  assert.match(shader, /uniform float uRootSightEyeInPit;/);
  assert.match(
    shader,
    /if \(uRootSightEyeInPit > 0\.5 && !gl_FrontFacing && vSoilWorldPos\.y > uRootSightCamera\.y\) \{\s*discard;/,
  );
});

test('the underground rim shading stays a surface effect', () => {
  // The lip is what used to draw a bright ring around the opening when seen
  // from below, so it is deliberately faded out with the eye under the soil.
  assert.match(shader, /lip \* \(eyeIsUnder \? 0\.0 : 0\.55\)/);
});
