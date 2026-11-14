import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TERRAIN_FIELD,
  sampleTerrain,
  terrainHeightAt,
  terrainMaterialAt,
  terrainNormalAt,
  terrainRimScale,
  terrainSlopeAt,
  terrainUnitAt,
} from './terrainField.ts';

const params = { ...DEFAULT_TERRAIN_FIELD, amplitudeM: 6, patchRadiusM: 620 };

describe('terrain field', () => {
  it('is deterministic for the same seed and point', () => {
    for (const [x, z] of [
      [0, 0],
      [12.5, -3.25],
      [100, 400],
      [-619.9, 0],
    ]) {
      assert.equal(
        terrainHeightAt(params, x as number, z as number),
        terrainHeightAt(params, x as number, z as number),
      );
    }
  });

  it('changes when the seed changes', () => {
    const a = terrainHeightAt(params, 40, 40);
    const b = terrainHeightAt({ ...params, seed: 99 }, 40, 40);
    assert.notEqual(a, b);
  });

  it('stays inside the configured amplitude and never goes below the base', () => {
    for (let i = 0; i < 500; i += 1) {
      const x = ((i * 37) % 1200) - 600;
      const z = ((i * 91) % 1200) - 600;
      const h = terrainHeightAt(params, x, z);
      assert.ok(h >= 0, `height ${h} below the base at ${x},${z}`);
      assert.ok(h <= params.amplitudeM + 1e-9, `height ${h} above amplitude at ${x},${z}`);
    }
  });

  it('fades relief to zero at the patch rim', () => {
    assert.equal(terrainRimScale(params, 700, 0), 0);
    assert.ok(terrainRimScale(params, 0, 0) > 0.99);
    assert.equal(terrainHeightAt(params, 700, 0), 0);
  });

  it('returns 0 amplitude when relief is disabled', () => {
    assert.equal(terrainHeightAt({ ...params, amplitudeM: 0 }, 10, 10), 0);
  });

  it('is continuous across a one-centimetre step', () => {
    let worst = 0;
    for (let x = 0; x < 40; x += 0.37) {
      const a = terrainHeightAt(params, x, 7.5);
      const b = terrainHeightAt(params, x + 0.01, 7.5);
      worst = Math.max(worst, Math.abs(a - b));
    }
    assert.ok(worst < 0.05, `height jumped ${worst} m over 1 cm`);
  });

  it('clamps the terrain unit to [0, 1]', () => {
    for (let i = 0; i < 200; i += 1) {
      const unit = terrainUnitAt(params, i * 3.1, -i * 1.7);
      assert.ok(unit >= 0 && unit <= 1);
    }
  });

  it('reports a unit-length normal and a finite slope', () => {
    const normal = terrainNormalAt(params, 15, -20);
    const length = Math.hypot(normal.x, normal.y, normal.z);
    assert.ok(Math.abs(length - 1) < 1e-9);
    assert.ok(normal.y > 0);
    const slope = terrainSlopeAt(params, 15, -20);
    assert.ok(slope >= 0 && slope < Math.PI / 2);
  });

  it('layers topsoil, subsoil and bedrock by depth', () => {
    assert.equal(terrainMaterialAt(params, 0), 'topsoil');
    assert.equal(terrainMaterialAt(params, params.soilDepthM * 0.5), 'topsoil');
    assert.equal(terrainMaterialAt(params, params.soilDepthM + 0.5), 'subsoil');
    assert.equal(terrainMaterialAt(params, params.maxDepthM + 1), 'bedrock');
  });

  it('samples height, normal, slope and material together', () => {
    const sample = sampleTerrain(params, 30, 30);
    assert.equal(sample.heightM, terrainHeightAt(params, 30, 30));
    assert.equal(sample.surface, 'topsoil');
    assert.ok(sample.slopeRad >= 0);
  });
});
