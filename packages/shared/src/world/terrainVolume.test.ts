import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  archFooting,
  archSdf,
  buildTerrainVolumeMesh,
  DEFAULT_TERRAIN_VOLUME,
  type TerrainVolumeParams,
  terrainVolumeBounds,
} from './terrainVolume.ts';

const flat = () => 0;

const params: TerrainVolumeParams = {
  ...DEFAULT_TERRAIN_VOLUME,
  enabled: true,
  centreXM: 0,
  centreZM: 0,
  bearingDeg: 0,
  spanM: 10,
  riseM: 3,
  thicknessM: 1.2,
  widthM: 2.6,
  legDepthM: 1.2,
  voxelM: 0.25,
  marginM: 1,
  strataBandM: 0.5,
  seed: 7,
};

function edgesAreClosed(indices: Uint32Array): boolean {
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = indices[i + e];
      const b = indices[i + ((e + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return [...edges.values()].every((count) => count === 2);
}

describe('the authored terrain volume', () => {
  it('is rock at the crown, air under it and air above it', () => {
    const footing = archFooting(flat, params);
    assert.equal(footing, 0);
    assert.ok(archSdf(flat, params, footing, 0, 3, 0) < 0, 'the crown is air');
    assert.ok(archSdf(flat, params, footing, 0, 1.4, 0) > 0, 'the opening is rock');
    assert.ok(archSdf(flat, params, footing, 0, 4.4, 0) > 0, 'the sky is rock');
  });

  it('stands on its feet and is only as wide as its width', () => {
    const footing = archFooting(flat, params);
    assert.ok(archSdf(flat, params, footing, 5, 0.2, 0) < 0, 'a foot is air');
    assert.ok(archSdf(flat, params, footing, 6.5, 0.2, 0) > 0, 'beyond the foot is rock');
    assert.ok(archSdf(flat, params, footing, 0, 3, 2.5) > 0, 'beyond the width is rock');
  });

  it('foots the arch on the lowest ground under its legs', () => {
    const slope = (x: number) => x * 0.2;
    // The -x feet are on the low side: 5 m out at 0.2 rise per metre.
    assert.ok(Math.abs(archFooting(slope, params) - -1) < 1e-9);
  });

  it('meshes a body with an underside and cuts its feet under the ground', () => {
    const mesh = buildTerrainVolumeMesh(flat, params);
    assert.ok(mesh);
    assert.ok(mesh.vertices > 200, `only ${mesh.vertices} vertices`);
    let underside = 0;
    for (let v = 0; v < mesh.vertices; v += 1) {
      if (mesh.normals[v * 3 + 1] < -0.5) underside += 1;
    }
    assert.ok(underside > 20, `only ${underside} downward-facing vertices: no underside`);
    const bounds = terrainVolumeBounds(flat, params);
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let v = 0; v < mesh.vertices; v += 1) {
      const y = mesh.positions[v * 3 + 1];
      if (y < lowest) lowest = y;
      if (y > highest) highest = y;
    }
    // The feet are cut `leg_depth_m` below the ground, and no rock stands above
    // the crown plus its thickness.
    assert.ok(lowest >= bounds.min[1] - 1e-3 && lowest <= -params.legDepthM + 2 * params.voxelM);
    assert.ok(highest <= params.riseM + params.thicknessM + 2 * params.voxelM);
    assert.ok(edgesAreClosed(mesh.indices), 'the arch mesh has holes');
  });

  it('carries a bed fraction on every vertex', () => {
    const mesh = buildTerrainVolumeMesh(flat, params);
    assert.ok(mesh);
    assert.equal(mesh.strata.length, mesh.vertices);
    for (const value of mesh.strata) {
      assert.ok(value >= 0 && value < 1, `stratum ${value} is outside its band`);
    }
  });

  it('is the same rock on every build', () => {
    assert.deepEqual(buildTerrainVolumeMesh(flat, params), buildTerrainVolumeMesh(flat, params));
  });

  it('builds nothing when the region is switched off', () => {
    assert.equal(buildTerrainVolumeMesh(flat, { ...params, enabled: false }), null);
  });
});
