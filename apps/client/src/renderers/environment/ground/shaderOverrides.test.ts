import assert from 'node:assert/strict';
import test from 'node:test';
import { applySoilFragmentShader, applySoilVertexShader } from './shaderOverrides.ts';

const STOCK_FRAGMENT = [
  '#include <common>',
  '#include <fog_pars_fragment>',
  'void main() {',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

const stockVertex = [
  '#include <common>',
  'void main() {',
  '  #include <begin_vertex>',
  '  #include <beginnormal_vertex>',
  '}',
].join('\n');

const fragment = applySoilFragmentShader(STOCK_FRAGMENT, {
  prelude: '// atmosphere prelude',
  apply: '// atmosphere apply',
});
const vertex = applySoilVertexShader(stockVertex);

test('the injected soil GLSL has no trailing comma in a call', () => {
  // `f(a, b,)` is a syntax error in GLSL, and it survives the TypeScript
  // compiler and the linter because the shader is a string. The whole soil
  // program then fails to link and the ground silently stops drawing - the
  // terrain was invisible for exactly this reason once. Guard the string.
  assert.doesNotMatch(fragment, /,\s*\)/);
  assert.doesNotMatch(vertex, /,\s*\)/);
});

test('the soil shader declares the aperture volume it cuts', () => {
  for (const uniform of [
    'uRootSightApertureCenter',
    'uRootSightApertureRadius',
    'uRootSightApertureTopY',
    'uRootSightApertureBottomY',
  ]) {
    assert.match(fragment, new RegExp(`uniform[^;]*${uniform}`), `${uniform} is declared`);
    assert.ok(fragment.includes(uniform), `${uniform} is read`);
  }
});

test('the opening is a coverage edge one pixel wide, not a band in metres', () => {
  // A band sized in metres ate a seedling's pit and still left a big one
  // stair-stepped. The ramp is measured in derivatives, so it is exactly as
  // soft as the sampling grid needs, and alpha-to-coverage resolves it.
  assert.match(fragment, /float edge = max\(fwidth\(apertureDist\), 1e-5\);/);
  assert.match(fragment, /gl_FragColor\.a = min\(gl_FragColor\.a, 1\.0 - cavityMask\);/);
});

test('the cut is bounded by the aperture volume, not an unbounded XZ disc', () => {
  // The rim and the cut both have to consult the vertical bounds; an XZ-only
  // test bored a core through hillsides and cut the far side of the planet.
  assert.match(fragment, /vSoilWorldPos\.y <= uRootSightApertureTopY/);
  assert.match(fragment, /vSoilWorldPos\.y >= uRootSightApertureBottomY/);
});

test('the cut reaches just past the bowl lip, which is a polygon', () => {
  // The lip's chords dip inside the exact circle, and a sloped surface between
  // two rim vertices stands above the chord: a cut at the lip lets it poke
  // through intact soil as a dotted ring, and a cut short of it opens a hairline
  // of sky. Cutting a hair wider puts the whole ring inside the opening, behind
  // the seam collar that lines the soil's edge.
  assert.match(fragment, /ROOT_SIGHT_CUT_OVERREACH = 1\.02/);
  assert.match(fragment, /uRootSightApertureRadius\) \* ROOT_SIGHT_CUT_OVERREACH/);
});

test('the vertex stage hands the fragment stage the surface-cut flag', () => {
  assert.match(vertex, /attribute float aSurfaceCut;/);
  assert.match(vertex, /vSurfaceCut = aSurfaceCut;/);
  assert.match(fragment, /varying float vSurfaceCut;/);
});

test('the soil drops a bubble of itself around a buried eye', () => {
  // An eye inside the earth is surrounded by dirt: the sheet's back faces, the
  // slab's walls and underside. Without a cut around the eye the pit is a brown
  // wall a stride away. The bubble is the camera's own air, and it must be
  // conditional on the eye being under the ground.
  assert.match(
    fragment,
    /eyeIsUnder &&\s*uRootSightEyeInPit < 0\.5 &&\s*distance\(vSoilWorldPos, uRootSightCamera\) < 0\.450\s*\)\s*\{\s*discard;/,
    'the soil no longer cuts a bubble around a buried eye outside the pit',
  );
  // The pit's own wall is a stride from any eye standing in the opening: a
  // bubble there would punch a hole in ground the player is beside.
  assert.ok(
    fragment.includes('uRootSightEyeInPit < 0.5'),
    'the near cut is no longer exempt in the opening column',
  );
  // And it must be a bubble, not the old half-space: a plane through the eye
  // deleted whole hillsides from the surface view.
  assert.doesNotMatch(fragment, /distance\(vSoilWorldPos, uRootSightCamera\) < [0-9.]+ \|\|/);
});
