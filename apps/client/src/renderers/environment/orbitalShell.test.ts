import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  createOrbitalShell,
  ORBITAL_SHELL_FADE_END_M,
  ORBITAL_SHELL_FADE_START_M,
  ORBITAL_SHELL_OFFSET_M,
  orbitalShellFadeForAltitude,
} from './orbitalShell.ts';

test('the orbital face is hidden while the ground is still readable', () => {
  assert.equal(orbitalShellFadeForAltitude(0), 0);
  assert.equal(orbitalShellFadeForAltitude(1_400), 0);
  assert.equal(orbitalShellFadeForAltitude(ORBITAL_SHELL_FADE_START_M), 0);
});

test('the orbital face owns the planet once the patch is subpixel', () => {
  assert.equal(orbitalShellFadeForAltitude(ORBITAL_SHELL_FADE_END_M), 1);
  assert.equal(orbitalShellFadeForAltitude(ORBITAL_SHELL_FADE_END_M + 50_000), 1);
  assert.equal(orbitalShellFadeForAltitude(Number.POSITIVE_INFINITY), 0);
});

test('the fade rises smoothly and the halfway altitude is half way', () => {
  const mid = (ORBITAL_SHELL_FADE_START_M + ORBITAL_SHELL_FADE_END_M) / 2;
  assert.ok(Math.abs(orbitalShellFadeForAltitude(mid) - 0.5) < 1e-9);
  let previous = 0;
  for (let alt = ORBITAL_SHELL_FADE_START_M; alt <= ORBITAL_SHELL_FADE_END_M; alt += 500) {
    const fade = orbitalShellFadeForAltitude(alt);
    assert.ok(fade >= previous, 'the fade never goes backwards while climbing');
    previous = fade;
  }
});

test('the shell sits just above the body and hides at zero fade', () => {
  const radius = 100_000;
  const palette = {
    soilLow: new THREE.Color('#3a2a1d'),
    soilHigh: new THREE.Color('#a08a6a'),
    vegetation: new THREE.Color('#3f5a34'),
    haze: new THREE.Color('#9fc4d8'),
    seaDeep: new THREE.Color('#20404a'),
    seaShallow: new THREE.Color('#6fa3a8'),
  };
  const shell = createOrbitalShell(radius, palette);
  assert.equal(shell.mesh.name, 'planet-orbital-shell');
  assert.equal(shell.mesh.visible, false);
  assert.equal(shell.mesh.position.y, -radius);
  const geometry = shell.mesh.geometry as THREE.SphereGeometry;
  assert.equal(geometry.parameters.radius, radius + ORBITAL_SHELL_OFFSET_M);
  shell.setFade(1);
  assert.equal(shell.mesh.visible, true);
  const material = shell.mesh.material as THREE.ShaderMaterial;
  assert.equal(material.uniforms.uFade.value, 1);
  shell.setFade(-3);
  assert.equal(shell.mesh.visible, false);
  assert.equal(material.uniforms.uFade.value, 0);
});

test('a far relief mask paints the sea over the whole face', () => {
  const shell = createOrbitalShell(100_000, {
    soilLow: new THREE.Color('#3a2a1d'),
    soilHigh: new THREE.Color('#a08a6a'),
    vegetation: new THREE.Color('#3f5a34'),
    haze: new THREE.Color('#9fc4d8'),
    seaDeep: new THREE.Color('#20404a'),
    seaShallow: new THREE.Color('#6fa3a8'),
  });
  const material = shell.mesh.material as THREE.ShaderMaterial;
  assert.equal(material.uniforms.uFarSeaFlag.value, 0);
  const mask = new THREE.Texture();
  shell.setFarLandMask(mask, { extentM: 100_000, minM: -15, spanM: 40, seaLevelM: 6 });
  assert.equal(material.uniforms.uFarLandMask.value, mask);
  assert.equal(material.uniforms.uFarSeaFlag.value, 1);
  const params = material.uniforms.uFarSeaParams.value as THREE.Vector4;
  // The lookup is equirectangular now, so the first channel is unused: the map
  // covers the whole planet, not one planar cap of it.
  assert.deepEqual([params.x, params.y, params.z, params.w], [0, -15, 40, 6]);
  // A mask with no height range cannot place a coast; it must not switch the
  // far sea on and paint the whole planet from an unset texture.
  shell.setFarLandMask(mask, { extentM: 0, minM: 0, spanM: 0, seaLevelM: 6 });
  // A refused mask changes nothing: the earlier one is still in place.
  assert.equal(material.uniforms.uFarSeaFlag.value, 1);
  assert.equal(material.uniforms.uFarSeaParams.value.z, 40);
});

test('the shell shader leaves the texture built-in alone', () => {
  const shell = createOrbitalShell(100_000, {
    soilLow: new THREE.Color('#3a2a1d'),
    soilHigh: new THREE.Color('#a08a6a'),
    vegetation: new THREE.Color('#3f5a34'),
    haze: new THREE.Color('#9fc4d8'),
    seaDeep: new THREE.Color('#20404a'),
    seaShallow: new THREE.Color('#6fa3a8'),
  });
  const material = shell.mesh.material as THREE.ShaderMaterial;
  // three's WebGL2 path rewrites texture2D() calls to texture(), so a local
  // named `texture` shadows the built-in and the fragment fails to link. The
  // whole shell stayed invisible ("useProgram: program not valid") - the planet
  // from orbit was the bare body, brown, with no sea at all.
  assert.doesNotMatch(material.fragmentShader, /\bfloat\s+texture\b/);
  assert.match(material.fragmentShader, /\bfloat\s+grain\b/);
  assert.match(material.fragmentShader, /uFarLandMask/);
});

test('clear weather draws no cloud veil, and the cover is clamped', () => {
  const shell = createOrbitalShell(100_000, {
    soilLow: new THREE.Color('#3a2a1d'),
    soilHigh: new THREE.Color('#a08a6a'),
    vegetation: new THREE.Color('#3f5a34'),
    haze: new THREE.Color('#9fc4d8'),
    seaDeep: new THREE.Color('#20404a'),
    seaShallow: new THREE.Color('#6fa3a8'),
  });
  const material = shell.mesh.material as THREE.ShaderMaterial;
  // A fresh shell is a clear day: the veil must not paint a white mottle over a
  // world nobody has seen it rain on.
  assert.equal(material.uniforms.uCloudCover.value, 0);
  shell.setCloudCover(0.4);
  assert.equal(material.uniforms.uCloudCover.value, 0.4);
  shell.setCloudCover(-2);
  assert.equal(material.uniforms.uCloudCover.value, 0);
  shell.setCloudCover(7);
  assert.equal(material.uniforms.uCloudCover.value, 1);
  shell.setCloudCover(Number.NaN);
  assert.equal(material.uniforms.uCloudCover.value, 0);
});
