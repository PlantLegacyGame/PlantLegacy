import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TERRAIN_FIELD,
  riverChannelAt,
  riverPath,
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

describe('river surveyed from the terrain', () => {
  const river = {
    ...DEFAULT_TERRAIN_FIELD,
    amplitudeM: 26,
    baseFrequency: 0.02,
    ridgeStrength: 0.6,
    riverEnabled: true,
    riverCenterZM: 24,
    riverWidthM: 12,
    riverDepthM: 2.8,
    riverWaterDepthM: 0.9,
    riverLengthM: 320,
    riverPathCellM: 2,
  };

  it('crosses the play area', () => {
    const path = riverPath(river);
    assert.ok(path, 'no river surveyed');
    assert.ok(path.stations.length > 20, `only ${path.stations.length} stations`);
    const nearest = Math.min(
      ...path.stations.map((station) => Math.hypot(station.x, station.z - river.riverCenterZM)),
    );
    assert.ok(nearest < 40, `the route stays ${nearest.toFixed(1)} m from the play area`);
  });

  it('never raises the water level downstream', () => {
    const path = riverPath(river);
    assert.ok(path);
    for (let i = 1; i < path.stations.length; i += 1) {
      assert.ok(
        path.stations[i].surfaceY <= path.stations[i - 1].surfaceY + 1e-9,
        `surface rose from ${path.stations[i - 1].surfaceY} to ${path.stations[i].surfaceY}`,
      );
    }
  });

  it('keeps the whole channel bed under the water, bank to bank', () => {
    const path = riverPath(river);
    assert.ok(path);
    let shallowest = Infinity;
    for (let i = 0; i < path.stations.length; i += 1) {
      const station = path.stations[i];
      const previous = path.stations[Math.max(0, i - 1)];
      const next = path.stations[Math.min(path.stations.length - 1, i + 1)];
      const length = Math.hypot(next.x - previous.x, next.z - previous.z) || 1;
      const acrossX = -(next.z - previous.z) / length;
      const acrossZ = (next.x - previous.x) / length;
      for (let t = -0.8; t <= 0.8; t += 0.2) {
        const x = station.x + acrossX * t * path.halfWidthM;
        const z = station.z + acrossZ * t * path.halfWidthM;
        // Ask the field itself where the water is here: between two bends the
        // nearest stretch is not necessarily the one this station belongs to.
        const hit = riverChannelAt(river, x, z);
        assert.ok(hit, `no channel at ${x.toFixed(1)},${z.toFixed(1)}`);
        const bed = terrainHeightAt(river, x, z);
        const depth = hit.surfaceY - bed;
        shallowest = Math.min(shallowest, depth);
        assert.ok(
          depth > 0,
          `bed rises out of the water at ${x.toFixed(1)},${z.toFixed(1)} (depth ${depth.toFixed(3)})`,
        );
      }
    }
    assert.ok(shallowest > 0.3, `channel pinches to ${shallowest.toFixed(3)} m deep`);
  });

  it('runs downhill: the route drops from head to outlet', () => {
    const path = riverPath(river);
    assert.ok(path);
    const first = path.stations[0];
    const last = path.stations[path.stations.length - 1];
    assert.ok(first.surfaceY > last.surfaceY, 'the river does not descend');
  });
});
