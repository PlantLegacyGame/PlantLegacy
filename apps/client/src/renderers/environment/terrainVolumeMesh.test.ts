import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_TERRAIN_VOLUME } from '@plant-legacy/shared/world';
import * as THREE from 'three';
import { createTerrainVolumeMesh } from './terrainVolumeMesh.ts';

describe('the terrain volume cut contract', () => {
  it('opts every vertex into the same surface cut as the ground', () => {
    const mesh = createTerrainVolumeMesh(
      DEFAULT_TERRAIN_VOLUME,
      () => 0,
      new THREE.Color(0.4, 0.3, 0.2),
    );
    assert.ok(mesh);
    const geometry = mesh.geometry as THREE.BufferGeometry;
    assert.ok(geometry.getAttribute('aSurfaceCut'));
    assert.equal(
      geometry.getAttribute('aSurfaceCut').count,
      geometry.getAttribute('position').count,
    );
    assert.ok(geometry.getAttribute('aSkirt'));
    assert.ok(geometry.getAttribute('aSkirtTop'));
    assert.equal(geometry.getAttribute('aSkirtTop').count, geometry.getAttribute('position').count);
  });

  it('wears the ground soil material when one is supplied', () => {
    const soil = new THREE.MeshStandardMaterial({ color: 0x553322 });
    const mesh = createTerrainVolumeMesh(
      DEFAULT_TERRAIN_VOLUME,
      () => 0,
      new THREE.Color(0.4, 0.3, 0.2),
      soil,
    );
    assert.ok(mesh);
    const material = mesh.material as THREE.MeshStandardMaterial;
    assert.notEqual(material, soil);
    assert.equal(material.vertexColors, true);
    assert.equal(material.onBeforeCompile, soil.onBeforeCompile);
  });
});
