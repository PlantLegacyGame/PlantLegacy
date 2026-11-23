/**
 * Surface nets: one vertex per sign-changing cell, one quad per sign-changing
 * grid edge.
 *
 * This is the mesher T56 uses to turn a signed-distance field into terrain. It
 * is pure and imports nothing, so the server can mesh a chunk and the client can
 * mesh the same chunk from the same field and get the same triangles.
 *
 * The property that matters is **welding by construction**: a cell owns exactly
 * one vertex, and every quad around it names that vertex, so neighbouring
 * triangles cannot drift apart into cracks. A marching-cubes table emits one
 * triangle per cube and leaves the welding to a merge pass that has to guess a
 * tolerance; here there is nothing to merge.
 *
 * Normals are the field's gradient, not the triangles' face normals. A meshed
 * hillside then lights as the field says it bends, instead of as a staircase of
 * flat cells - which is the whole reason to spend six extra field samples per
 * vertex.
 */

/** A uniform sample grid over a signed-distance field. */
export interface SurfaceNetGrid {
  /** World position of sample (0, 0, 0). */
  min: readonly [number, number, number];
  /** Distance between neighbouring samples, metres. */
  step: number;
  /** Samples per axis. Each must be at least 2. */
  counts: readonly [number, number, number];
  /** Negative inside the solid, positive outside, in metres. */
  sdf: (x: number, y: number, z: number) => number;
}

export interface SurfaceNetMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Cells that produced a vertex, i.e. the mesh's vertex count. */
  vertices: number;
  /** Quads emitted before triangulation. */
  quads: number;
}

/** The eight cube corners, as offsets from a cell's low corner. */
const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

/** The twelve cube edges, as pairs of corner indices. */
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

export function surfaceNets(grid: SurfaceNetGrid): SurfaceNetMesh {
  const [nx, ny, nz] = grid.counts;
  if (nx < 2 || ny < 2 || nz < 2) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
      vertices: 0,
      quads: 0,
    };
  }
  const [minX, minY, minZ] = grid.min;
  const step = grid.step;
  const sampleAt = (i: number, j: number, k: number): number => (i * ny + j) * nz + k;

  // One field evaluation per sample. The quads read the same numbers the
  // vertices were placed from, so a sign can never be read two ways.
  const samples = new Float32Array(nx * ny * nz);
  for (let i = 0; i < nx; i += 1) {
    const x = minX + i * step;
    for (let j = 0; j < ny; j += 1) {
      const y = minY + j * step;
      for (let k = 0; k < nz; k += 1) {
        samples[sampleAt(i, j, k)] = grid.sdf(x, y, minZ + k * step);
      }
    }
  }

  const cellsX = nx - 1;
  const cellsY = ny - 1;
  const cellsZ = nz - 1;
  const cellAt = (i: number, j: number, k: number): number => (i * cellsY + j) * cellsZ + k;
  const cellVertex = new Int32Array(cellsX * cellsY * cellsZ).fill(-1);
  const positions: number[] = [];
  const corner = new Float32Array(8);

  for (let i = 0; i < cellsX; i += 1) {
    for (let j = 0; j < cellsY; j += 1) {
      for (let k = 0; k < cellsZ; k += 1) {
        let inside = false;
        let outside = false;
        for (let c = 0; c < 8; c += 1) {
          const offset = CORNERS[c];
          const value = samples[sampleAt(i + offset[0], j + offset[1], k + offset[2])];
          corner[c] = value;
          if (value < 0) inside = true;
          else outside = true;
        }
        if (!inside || !outside) continue;

        // The vertex is the average of the crossings on the cell's own edges -
        // the surface nets rule. It keeps the vertex inside the cell, which is
        // what makes one vertex per cell enough and the welding exact.
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const ca = CORNERS[a];
          const cb = CORNERS[b];
          sx += ca[0] + (cb[0] - ca[0]) * t;
          sy += ca[1] + (cb[1] - ca[1]) * t;
          sz += ca[2] + (cb[2] - ca[2]) * t;
          crossings += 1;
        }
        if (crossings === 0) continue;
        const vertex = positions.length / 3;
        positions.push(
          minX + (i + sx / crossings) * step,
          minY + (j + sy / crossings) * step,
          minZ + (k + sz / crossings) * step,
        );
        cellVertex[cellAt(i, j, k)] = vertex;
      }
    }
  }

  const indices: number[] = [];
  let quads = 0;

  /**
   * Emit a quad from four cells, triangulated along one diagonal.
   *
   * `flip` reverses the winding. The four cell centres go round the edge in the
   * cycle that faces one way; the solid side of the edge decides which way the
   * surface must face.
   */
  const emitQuad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) {
      indices.push(a, c, b, a, d, c);
    } else {
      indices.push(a, b, c, a, c, d);
    }
    quads += 1;
  };

  // An edge along x is surrounded by four cells in the y-z plane. The cycle
  // (y-1,z-1) -> (y,z-1) -> (y,z) -> (y-1,z) winds towards +x.
  for (let i = 0; i < cellsX; i += 1) {
    for (let j = 1; j < cellsY; j += 1) {
      for (let k = 1; k < cellsZ; k += 1) {
        const low = samples[sampleAt(i, j, k)];
        const high = samples[sampleAt(i + 1, j, k)];
        if (low < 0 === high < 0) continue;
        emitQuad(
          cellVertex[cellAt(i, j - 1, k - 1)],
          cellVertex[cellAt(i, j, k - 1)],
          cellVertex[cellAt(i, j, k)],
          cellVertex[cellAt(i, j - 1, k)],
          !(low < 0),
        );
      }
    }
  }

  // An edge along y sits in the x-z plane. The cycle used below winds towards
  // -y, so a solid sample under the edge (normal +y) needs it reversed.
  for (let i = 1; i < cellsX; i += 1) {
    for (let j = 0; j < cellsY; j += 1) {
      for (let k = 1; k < cellsZ; k += 1) {
        const low = samples[sampleAt(i, j, k)];
        const high = samples[sampleAt(i, j + 1, k)];
        if (low < 0 === high < 0) continue;
        emitQuad(
          cellVertex[cellAt(i - 1, j, k - 1)],
          cellVertex[cellAt(i, j, k - 1)],
          cellVertex[cellAt(i, j, k)],
          cellVertex[cellAt(i - 1, j, k)],
          low < 0,
        );
      }
    }
  }

  // An edge along z sits in the x-y plane; this cycle winds towards +z.
  for (let i = 1; i < cellsX; i += 1) {
    for (let j = 1; j < cellsY; j += 1) {
      for (let k = 0; k < cellsZ; k += 1) {
        const low = samples[sampleAt(i, j, k)];
        const high = samples[sampleAt(i, j, k + 1)];
        if (low < 0 === high < 0) continue;
        emitQuad(
          cellVertex[cellAt(i - 1, j - 1, k)],
          cellVertex[cellAt(i, j - 1, k)],
          cellVertex[cellAt(i, j, k)],
          cellVertex[cellAt(i - 1, j, k)],
          !(low < 0),
        );
      }
    }
  }

  const count = positions.length / 3;
  const normals = new Float32Array(positions.length);
  // Gradient normals, central-differenced on the field itself rather than on the
  // sampled lattice: a cell's own corners are a metre apart, and differencing
  // them lights the surface as the grid bends instead of as the field does.
  const h = step * 0.5;
  for (let v = 0; v < count; v += 1) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    let gx = grid.sdf(x + h, y, z) - grid.sdf(x - h, y, z);
    let gy = grid.sdf(x, y + h, z) - grid.sdf(x, y - h, z);
    let gz = grid.sdf(x, y, z + h) - grid.sdf(x, y, z - h);
    const length = Math.hypot(gx, gy, gz);
    if (length > 1e-9) {
      gx /= length;
      gy /= length;
      gz /= length;
    } else {
      gx = 0;
      gy = 1;
      gz = 0;
    }
    normals[v * 3] = gx;
    normals[v * 3 + 1] = gy;
    normals[v * 3 + 2] = gz;
  }

  return {
    positions: Float32Array.from(positions),
    normals,
    indices: Uint32Array.from(indices),
    vertices: count,
    quads,
  };
}
