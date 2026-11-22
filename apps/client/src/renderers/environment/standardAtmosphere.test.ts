import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { DEFAULT_ATMOSPHERE } from './atmosphere.ts';
import {
  applyAtmosphereToStandardMaterial,
  cloneStandaloneMaterial,
} from './standardAtmosphere.ts';

/**
 * A shader object shaped like the one Three hands `onBeforeCompile`, carrying
 * the includes the patcher rewrites and an empty uniform table.
 */
function compiledShader() {
  return {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: 'void main() {\n#include <common>\n#include <begin_vertex>\n}',
    fragmentShader: 'void main() {\n#include <common>\n#include <colorspace_fragment>\n}',
  };
}

const sunDir = new THREE.Vector3(0, 1, 0);

describe('the shared atmosphere on a standard material', () => {
  it('patches the shader once and keeps live uniform holders', () => {
    const material = new THREE.MeshStandardMaterial();
    applyAtmosphereToStandardMaterial(material, DEFAULT_ATMOSPHERE, sunDir);

    const shader = compiledShader();
    material.onBeforeCompile(shader as never, null as never);

    const extinction = shader.uniforms.uAtmoExtinction?.value;
    assert.ok(extinction instanceof THREE.Vector3, 'the extinction uniform has to be a vector');
    assert.match(
      shader.fragmentShader,
      /vAtmoWorld/,
      'the fragment stage needs the world position',
    );
    assert.equal(material.fog, false, 'the atmosphere replaces the scene fog');
  });

  it('makes a variant that carries none of the patch state it was copied from', () => {
    // `Material.copy` serialises userData through JSON, so a plain copy of a
    // patched material claims to be attached while its uniform holders are plain
    // `{ x, y, z }` literals. This is the renderer's per-organ tint variant, and
    // writing to those literals is the TypeError a joining rival's plant threw on
    // every rebuild. The variant is made detached, then patched for real.
    const base = new THREE.MeshStandardMaterial();
    applyAtmosphereToStandardMaterial(base, DEFAULT_ATMOSPHERE, sunDir);
    const shader = compiledShader();
    base.onBeforeCompile(shader as never, null as never);

    const variant = cloneStandaloneMaterial(base);
    assert.equal(
      variant.userData.atmosphereAttached,
      undefined,
      'the JSON-flattened patch state must not travel with the variant',
    );
    assert.equal(variant.userData.atmosphereUniforms, undefined);

    assert.doesNotThrow(() =>
      applyAtmosphereToStandardMaterial(variant, DEFAULT_ATMOSPHERE, sunDir),
    );
    assert.equal(variant.fog, false, 'the variant replaces the scene fog too');

    const compiled = compiledShader();
    variant.onBeforeCompile(compiled as never, null as never);
    assert.ok(compiled.uniforms.uAtmoExtinction?.value instanceof THREE.Vector3);
    assert.match(compiled.fragmentShader, /vAtmoWorld/, 'the variant installs its own patch');
  });
});
