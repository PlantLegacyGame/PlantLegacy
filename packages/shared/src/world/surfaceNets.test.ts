import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type SurfaceNetGrid, surfaceNets } from './surfaceNets.ts';

const planeGrid = (level = 0.6): SurfaceNetGrid => ({
  min: [0, 0, 0],
  step: 0.5,
  counts: [4, 3, 4],
  // Negative below the plane: the solid is the lower half, so the surface faces
  // up. (Writing `level - y` puts the solid above and the normals down.)
  sdf: (_x, y) => y - level,
});

const sphereGrid = (): SurfaceNetGrid => ({
  min: [0, 0, 0],
  step: 0.5,
  counts: [16, 16, 16],
  sdf: (x, y, z) => Math.hypot(x - 3.75, y - 3.75, z - 3.75) - 3,
});

function edgesOf(indices: Uint32Array): Map<string, number> {
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = indices[i + e];
      const b = indices[i + ((e + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return edges;
}

describe('surfaceNets', () => {
  it('meshes a plane with one vertex per cell and one quad per edge', () => {
    const mesh = surfaceNets(planeGrid());
    // 3 x 1 x 3 cells have sign changes; the plane crosses the 3 x 3 column of
    // cells, so the quads are the 2 x 2 edges in the middle of the grid.
    assert.equal(mesh.quads, 4);
    assert.equal(mesh.vertices, 9);
    assert.equal(mesh.indices.length, 4 * 6);
    for (let v = 0; v < mesh.vertices; v += 1) {
      assert.ok(Math.abs(mesh.positions[v * 3 + 1] - 0.6) < 1e-5);
      assert.ok(mesh.normals[v * 3 + 1] > 0.999);
    }
  });

  it('winds every triangle to face out of the solid', () => {
    const mesh = surfaceNets(sphereGrid());
    const centre = [3.75, 3.75, 3.75];
    for (let v = 0; v < mesh.vertices; v += 1) {
      const dx = mesh.positions[v * 3] - centre[0];
      const dy = mesh.positions[v * 3 + 1] - centre[1];
      const dz = mesh.positions[v * 3 + 2] - centre[2];
      const outward =
        mesh.normals[v * 3] * dx + mesh.normals[v * 3 + 1] * dy + mesh.normals[v * 3 + 2] * dz;
      assert.ok(outward > 0.9 * 3, `vertex ${v} normal points into the sphere`);
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
      const ax = mesh.positions[a * 3];
      const ay = mesh.positions[a * 3 + 1];
      const az = mesh.positions[a * 3 + 2];
      const ux = mesh.positions[b * 3] - ax;
      const uy = mesh.positions[b * 3 + 1] - ay;
      const uz = mesh.positions[b * 3 + 2] - az;
      const wx = mesh.positions[c * 3] - ax;
      const wy = mesh.positions[c * 3 + 1] - ay;
      const wz = mesh.positions[c * 3 + 2] - az;
      const nx = uy * wz - uz * wy;
      const ny = uz * wx - ux * wz;
      const nz = ux * wy - uy * wx;
      const face =
        nx * (mesh.normals[a * 3] + mesh.normals[b * 3] + mesh.normals[c * 3]) +
        ny * (mesh.normals[a * 3 + 1] + mesh.normals[b * 3 + 1] + mesh.normals[c * 3 + 1]) +
        nz * (mesh.normals[a * 3 + 2] + mesh.normals[b * 3 + 2] + mesh.normals[c * 3 + 2]);
      assert.ok(face > 0, `triangle ${i / 3} is wound inside out`);
    }
  });

  it('welds without a merge pass and closes a surface that does not touch the grid', () => {
    const mesh = surfaceNets(sphereGrid());
    const seen = new Set<string>();
    for (let v = 0; v < mesh.vertices; v += 1) {
      const key = [0, 1, 2].map((axis) => mesh.positions[v * 3 + axis].toFixed(5)).join(',');
      assert.ok(!seen.has(key), `duplicate vertex at ${key}`);
      seen.add(key);
    }
    const open = [...edgesOf(mesh.indices).values()].filter((count) => count !== 2);
    assert.equal(open.length, 0, `${open.length} edges are not shared by two triangles`);
  });

  it('keeps the mesh inside the grid', () => {
    const grid = sphereGrid();
    const mesh = surfaceNets(grid);
    for (let v = 0; v < mesh.vertices; v += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const low = grid.min[axis];
        const high = low + (grid.counts[axis] - 1) * grid.step;
        const value = mesh.positions[v * 3 + axis];
        assert.ok(value >= low - 1e-4 && value <= high + 1e-4);
      }
    }
  });

  it('is deterministic', () => {
    assert.deepEqual(surfaceNets(sphereGrid()), surfaceNets(sphereGrid()));
  });

  it('returns nothing for a grid too small to hold a cell', () => {
    const mesh = surfaceNets({ min: [0, 0, 0], step: 1, counts: [1, 1, 1], sdf: () => -1 });
    assert.equal(mesh.vertices, 0);
    assert.equal(mesh.indices.length, 0);
  });
});
