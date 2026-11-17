import assert from 'node:assert/strict';
import test from 'node:test';
import { applySoilFragmentShader, applySoilVertexShader } from './shaderOverrides.ts';

const STOCK_FRAGMENT = [
  '#include <common>',
  '#include <fog_pars_fragment>',
  'void main() {',
  '  #include <colorspace_fragment>',
  '  #include <dithering_fragment>',
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
    'uRootSightRimDitherM',
  ]) {
    assert.match(fragment, new RegExp(`uniform[^;]*${uniform}`), `${uniform} is declared`);
    assert.ok(fragment.includes(uniform), `${uniform} is read`);
  }
});

test('the cut is bounded by the aperture volume, not an unbounded XZ disc', () => {
  // The rim and the cut both have to consult the vertical bounds; an XZ-only
  // test bored a core through hillsides and cut the far side of the planet.
  assert.match(fragment, /vSoilWorldPos\.y <= uRootSightApertureTopY/);
  assert.match(fragment, /vSoilWorldPos\.y >= uRootSightApertureBottomY/);
});

test('the cut stops short of the bowl lip so no hairline of sky opens at the rim', () => {
  // The bowl's rim is a polygon built at exactly the aperture radius: its chords
  // dip inside the exact circle, and on a slope the surface between two rim
  // vertices can stand above the chord. A cut that reaches the lip therefore
  // leaves a see-through line along the rim, so the cut is inset and the lip
  // sits under intact soil instead.
  assert.match(fragment, /ROOT_SIGHT_CUT_INSET = 0\.99/);
  assert.match(fragment, /uRootSightApertureRadius\) \* ROOT_SIGHT_CUT_INSET/);
});

test('the vertex stage hands the fragment stage the surface-cut flag', () => {
  assert.match(vertex, /attribute float aSurfaceCut;/);
  assert.match(vertex, /vSurfaceCut = aSurfaceCut;/);
  assert.match(fragment, /varying float vSurfaceCut;/);
});
