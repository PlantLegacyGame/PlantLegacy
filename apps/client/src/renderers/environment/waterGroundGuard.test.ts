import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type * as THREE from 'three';
import type { PaletteConfig } from '../../config/clientConfig.ts';
import { applyWorldPalette } from '../worldPalette.ts';
import {
  createWaterGroundGuard,
  WATER_GROUND_RING_CELL_M,
  WATER_GROUND_SUBMERGE_M,
  waterGroundExtents,
} from './waterGroundGuard.ts';
import { createWaterMaterial } from './waterMaterial.ts';

const paletteJson = JSON.parse(
  readFileSync(new URL('../../../../../config/palette.json', import.meta.url), 'utf8'),
) as {
  values: {
    ramps: { value: PaletteConfig['ramps'] };
    roles: { value: PaletteConfig['roles'] };
  };
};

const CURRENT_TUNING = {
  groundTestFineRadiusM: 620,
  groundTestFineCellM: 2,
  groundTestRadiusM: 20_000,
  groundTestCellM: WATER_GROUND_RING_CELL_M,
};

describe('water ground guard extents', () => {
  test('covers the current 620 m play disc and 20 km transition ring', () => {
    const extents = waterGroundExtents(620, CURRENT_TUNING);

    assert.equal(extents.fineRadiusM, 620);
    assert.equal(extents.fineCellM, 2);
    assert.equal(extents.coarseRadiusM, 20_000);
    assert.equal(extents.coarseCellM, WATER_GROUND_RING_CELL_M);
    assert.equal(extents.fineCells, 621);
    assert.equal(extents.coarseCells, 626);
    assert.ok(extents.coarseInnerRadiusM > 600);
    assert.ok(extents.coarseInnerRadiusM < extents.fineRadiusM);

    // The old detail-patch/ring extents must not creep back in.
    assert.notEqual(extents.fineRadiusM, 180);
    assert.notEqual(extents.coarseRadiusM, 560);
  });

  test('builds textures whose bounds are the disc and the ring outer edge', () => {
    let samples = 0;
    const guard = createWaterGroundGuard({
      playRadiusM: 620,
      tuning: CURRENT_TUNING,
      sampleY: (x, z) => x * 0.01 + z * 0.02,
    });

    assert.equal(guard.fine.originX, -620);
    assert.equal(guard.fine.originZ, -620);
    assert.equal(guard.fine.sizeM, 1_240);
    assert.equal(guard.fine.texture.image.width, 621);
    assert.equal(guard.fine.texture.image.height, 621);

    assert.equal(guard.coarse.originX, -20_000);
    assert.equal(guard.coarse.originZ, -20_000);
    assert.equal(guard.coarse.sizeM, 40_000);
    assert.equal(guard.coarse.texture.image.width, 626);
    assert.equal(guard.coarse.texture.image.height, 626);

    samples = guard.fine.cells ** 2 + guard.coarse.cells ** 2;
    assert.equal(samples, 621 ** 2 + 626 ** 2);

    guard.dispose();
  });

  test('binds both textures, ranges and curvature to the water material', () => {
    applyWorldPalette({
      ramps: paletteJson.values.ramps.value,
      roles: paletteJson.values.roles.value,
    });
    const planetRadiusM = 100_000;
    const guard = createWaterGroundGuard({
      playRadiusM: 620,
      planetRadiusM,
      tuning: CURRENT_TUNING,
      sampleY: (x, z) => 10 + x * 0.002 + z * 0.001,
    });
    const water = createWaterMaterial();

    try {
      guard.applyTo(water.material);
      const uniforms = water.material.uniforms;

      assert.equal(uniforms.uGroundHeight.value, guard.fine.texture);
      assert.equal(uniforms.uGroundHeightAvailable.value, 1);
      assert.deepEqual((uniforms.uGroundHeightOrigin.value as THREE.Vector2).toArray(), [
        guard.fine.originX,
        guard.fine.originZ,
      ]);
      assert.equal(uniforms.uGroundHeightSize.value, guard.fine.sizeM);
      assert.deepEqual((uniforms.uGroundHeightRange.value as THREE.Vector2).toArray(), [
        guard.fine.minY,
        guard.fine.spanY,
      ]);

      assert.equal(uniforms.uGroundCoarse.value, guard.coarse.texture);
      assert.equal(uniforms.uGroundCoarseAvailable.value, 1);
      assert.deepEqual((uniforms.uGroundCoarseOrigin.value as THREE.Vector2).toArray(), [
        guard.coarse.originX,
        guard.coarse.originZ,
      ]);
      assert.equal(uniforms.uGroundCoarseSize.value, guard.coarse.sizeM);
      assert.deepEqual((uniforms.uGroundCoarseRange.value as THREE.Vector2).toArray(), [
        guard.coarse.minY,
        guard.coarse.spanY,
      ]);
      assert.equal(uniforms.uGroundCoarseInnerRadiusM.value, guard.extents.coarseInnerRadiusM);
      assert.equal(uniforms.uGroundPlanetRadius.value, planetRadiusM);
      assert.equal(uniforms.uWaterSubmergeM.value, WATER_GROUND_SUBMERGE_M);
    } finally {
      water.material.dispose();
      guard.dispose();
    }
  });
});
