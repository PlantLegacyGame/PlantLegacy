/**
 * Every soil mesh that can contain the Root Sight aperture reports a cut.
 *
 * The cut is a per-vertex flag (`aSurfaceCut`) the soil shader reads, so a mesh
 * built without it stays solid however close the hole is: the outer LOD ring
 * stood four millimetres above the body and covered the pit the moment a reroot
 * took the opening past the detail patch's ±88 m edge (R3). The flag set is what
 * this test holds - the body, the one play disk, the slab, and the flat fallback
 * plane.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { PaletteConfig, RenderConfig } from '../../config/clientConfig.js';
import { applyWorldPalette } from '../worldPalette.ts';
import { createGround } from './ground.ts';
import { createRootSightUniforms } from './rootSightUniforms.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const paletteJson = read('../../../../../config/palette.json') as {
  values: {
    ramps: { value: PaletteConfig['ramps'] };
    roles: { value: PaletteConfig['roles'] };
  };
};
const PALETTE: PaletteConfig = {
  ramps: paletteJson.values.ramps.value,
  roles: paletteJson.values.roles.value,
};

/** Only the fields `createGround` reads; the rest of the config is not its business here. */
const configFor = (planetRadiusM: number): RenderConfig =>
  ({
    planetRadiusM,
    terrainRadius: 120,
    terrainMeshSubdivisions: 12,
    terrainAmplitudeM: 2,
    soilDepthM: 1.6,
    soilGrainStrength: 0.02,
    soilMineralStrength: 0.05,
  }) as unknown as RenderConfig;

const soilMeshes = (root: THREE.Object3D): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
};

describe('the ground reports a surface cut', () => {
  it('cuts every mesh of a planet ground, not only the detail patch', () => {
    applyWorldPalette(PALETTE);
    const ground = createGround(new THREE.Scene(), configFor(300), createRootSightUniforms());
    assert.ok(ground.mesh, 'the ground was not built');
    // Body, play disk and slab. One detailed terrain, no LOD rings to leave
    // uncut.
    const meshes = soilMeshes(ground.mesh as THREE.Mesh);
    assert.equal(meshes.length, 3, `the ground has ${meshes.length} meshes`);
    for (const mesh of meshes) {
      const name = mesh.name || 'a ground mesh';
      const cut = mesh.geometry.getAttribute('aSurfaceCut');
      assert.ok(cut, `${name} carries no cut`);
      assert.equal(
        cut.count,
        mesh.geometry.getAttribute('position')?.count,
        `${name} is partly cut`,
      );
      for (let i = 0; i < cut.count; i += 1) {
        assert.equal(cut.getX(i), 1, `${name} vertex ${i} is not cut`);
      }
    }
  });

  it('cuts the flat fallback ground too', () => {
    applyWorldPalette(PALETTE);
    const ground = createGround(new THREE.Scene(), configFor(0), createRootSightUniforms());
    assert.ok(ground.mesh, 'the ground was not built');
    const [mesh] = soilMeshes(ground.mesh as THREE.Mesh);
    assert.ok(mesh, 'the plane ground is missing');
    const cut = mesh.geometry.getAttribute('aSurfaceCut');
    assert.ok(cut, 'the plane ground carries no cut');
    assert.equal(cut.count, mesh.geometry.getAttribute('position')?.count);
  });
});
