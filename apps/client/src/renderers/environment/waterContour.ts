/**
 * The water surface's zero-depth contour.
 *
 * The solver stores one value per cell centre. Turning that into a sheet one
 * triangle per pair of centres makes every shoreline a staircase of cells. This
 * module samples the field at the cell corners, clips each cell against the
 * zero-depth line (marching squares), and returns the wet polygon. It is pure
 * geometry so the shoreline can be tested without a WebGL context.
 */

export interface WaterContour {
  /** Local xyz metres from the field's lower-left corner. */
  positions: number[];
  /** Water column in metres, one per position. */
  depths: number[];
  indices: number[];
}

/** Bilinear sample of a corner, written into the corner buffers. */
function sampleCorner(
  data: Float32Array,
  cells: number,
  gx: number,
  gz: number,
  levels: Float32Array,
  depths: Float32Array,
  index: number,
): void {
  const fx = Math.min(cells - 1, Math.max(0, gx - 0.5));
  const fz = Math.min(cells - 1, Math.max(0, gz - 0.5));
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(cells - 1, x0 + 1);
  const z1 = Math.min(cells - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const a = (z0 * cells + x0) * 4;
  const b = (z0 * cells + x1) * 4;
  const c = (z1 * cells + x0) * 4;
  const d = (z1 * cells + x1) * 4;
  const level =
    ((data[a] ?? 0) * (1 - tx) + (data[b] ?? 0) * tx) * (1 - tz) +
    ((data[c] ?? 0) * (1 - tx) + (data[d] ?? 0) * tx) * tz;
  const depth =
    ((data[a + 2] ?? 0) * (1 - tx) + (data[b + 2] ?? 0) * tx) * (1 - tz) +
    ((data[c + 2] ?? 0) * (1 - tx) + (data[d + 2] ?? 0) * tx) * tz;
  levels[index] = level;
  depths[index] = depth;
}

/**
 * Build the water's top from the field's level and depth arrays.
 *
 * The cell corners are in world-relative metres from the field's lower-left
 * corner; the caller positions the mesh at the field origin.
 */
export function buildWaterContour(
  data: Float32Array,
  cells: number,
  cellSizeM: number,
): WaterContour {
  const cornerCount = cells + 1;
  const levels = new Float32Array(cornerCount * cornerCount);
  const depths = new Float32Array(cornerCount * cornerCount);
  for (let z = 0; z < cornerCount; z += 1) {
    for (let x = 0; x < cornerCount; x += 1) {
      const index = z * cornerCount + x;
      sampleCorner(data, cells, x, z, levels, depths, index);
    }
  }

  const positions: number[] = [];
  const outDepths: number[] = [];
  const indices: number[] = [];

  // Four corner slots, then scratch polygon slots for one clipped cell. The
  // arrays are reused for every cell: this used to allocate several objects and
  // arrays for each of the 36,000 cells on every sync.
  const cornerX = new Float64Array(4);
  const cornerZ = new Float64Array(4);
  const cornerLevel = new Float64Array(4);
  const cornerDepth = new Float64Array(4);
  const inside = [false, false, false, false];
  const polyX = new Float64Array(10);
  const polyZ = new Float64Array(10);
  const polyLevel = new Float64Array(10);
  const polyDepth = new Float64Array(10);
  const scratchX = new Float64Array(10);
  const scratchZ = new Float64Array(10);
  const scratchLevel = new Float64Array(10);
  const scratchDepth = new Float64Array(10);
  const crossX = new Float64Array(4);
  const crossZ = new Float64Array(4);
  const crossLevel = new Float64Array(4);
  const crossDepth = new Float64Array(4);
  const crossing = [-1, -1, -1, -1];

  /** Emit a convex polygon as one shared fan. */
  const emitPolygon = (
    xs: Float64Array,
    levels: Float64Array,
    zs: Float64Array,
    depths: Float64Array,
    count: number,
  ): void => {
    if (count < 3) return;
    const base = positions.length / 3;
    for (let i = 0; i < count; i += 1) {
      positions.push(xs[i] ?? 0, levels[i] ?? 0, zs[i] ?? 0);
      outDepths.push(Math.max(0, depths[i] ?? 0));
    }
    for (let i = 2; i < count; i += 1) indices.push(base, base + i - 1, base + i);
  };

  for (let z = 0; z < cells; z += 1) {
    for (let x = 0; x < cells; x += 1) {
      const c0 = z * cornerCount + x;
      const c1 = (z + 1) * cornerCount + x;
      const c2 = c1 + 1;
      const c3 = c0 + 1;
      cornerX[0] = x * cellSizeM;
      cornerX[1] = x * cellSizeM;
      cornerX[2] = (x + 1) * cellSizeM;
      cornerX[3] = (x + 1) * cellSizeM;
      cornerZ[0] = z * cellSizeM;
      cornerZ[1] = (z + 1) * cellSizeM;
      cornerZ[2] = (z + 1) * cellSizeM;
      cornerZ[3] = z * cellSizeM;
      cornerLevel[0] = levels[c0] ?? 0;
      cornerLevel[1] = levels[c1] ?? 0;
      cornerLevel[2] = levels[c2] ?? 0;
      cornerLevel[3] = levels[c3] ?? 0;
      cornerDepth[0] = depths[c0] ?? 0;
      cornerDepth[1] = depths[c1] ?? 0;
      cornerDepth[2] = depths[c2] ?? 0;
      cornerDepth[3] = depths[c3] ?? 0;
      inside[0] = cornerDepth[0] > 0;
      inside[1] = cornerDepth[1] > 0;
      inside[2] = cornerDepth[2] > 0;
      inside[3] = cornerDepth[3] > 0;
      let wet = 0;
      for (let i = 0; i < 4; i += 1) if (inside[i]) wet += 1;
      if (wet === 0) continue;

      if (wet === 4) {
        // The common case: a whole cell under water needs no clipping at all.
        emitPolygon(cornerX, cornerLevel, cornerZ, cornerDepth, 4);
        continue;
      }

      crossing[0] = -1;
      crossing[1] = -1;
      crossing[2] = -1;
      crossing[3] = -1;
      let crossings = 0;
      for (let edge = 0; edge < 4; edge += 1) {
        const next = (edge + 1) % 4;
        if (inside[edge] === inside[next]) continue;
        const a = cornerDepth[edge];
        const b = cornerDepth[next];
        const span = a - b;
        const t = Math.abs(span) > 1e-9 ? a / span : 0.5;
        crossX[crossings] = cornerX[edge] + (cornerX[next] - cornerX[edge]) * t;
        crossZ[crossings] = cornerZ[edge] + (cornerZ[next] - cornerZ[edge]) * t;
        crossLevel[crossings] = cornerLevel[edge] + (cornerLevel[next] - cornerLevel[edge]) * t;
        crossDepth[crossings] = 0;
        crossing[edge] = crossings;
        crossings += 1;
      }

      if (crossings === 4) {
        // A saddle: the corners alternate wet and dry. Join the crossings
        // through the middle when the centre is wet; otherwise fill the two wet
        // shoulders separately instead of bridging the dry pass.
        const centreDepth = (cornerDepth[0] + cornerDepth[1] + cornerDepth[2] + cornerDepth[3]) / 4;
        if (centreDepth > 0) {
          emitPolygon(crossX, crossLevel, crossZ, crossDepth, 4);
        } else {
          for (let i = 0; i < 4; i += 1) {
            if (!inside[i]) continue;
            const start = crossing[i];
            const end = crossing[(i + 3) % 4];
            if (start < 0 || end < 0) continue;
            const base = positions.length / 3;
            positions.push(
              cornerX[i],
              cornerLevel[i],
              cornerZ[i],
              crossX[start],
              crossLevel[start],
              crossZ[start],
              crossX[end],
              crossLevel[end],
              crossZ[end],
            );
            outDepths.push(cornerDepth[i], 0, 0);
            indices.push(base, base + 1, base + 2);
          }
        }
        continue;
      }

      // Clip the cell against each wet edge (Sutherland-Hodgman). The boundary
      // vertices lie on the zero-depth line, so the triangle fan ends on the
      // true shoreline rather than on the cell's square edge.
      for (let i = 0; i < 4; i += 1) {
        polyX[i] = cornerX[i];
        polyZ[i] = cornerZ[i];
        polyLevel[i] = cornerLevel[i];
        polyDepth[i] = cornerDepth[i];
      }
      let count = 4;
      for (let edge = 0; edge < 4 && count > 0; edge += 1) {
        let out = 0;
        for (let i = 0; i < count; i += 1) {
          const next = (i + 1) % count;
          const currentInside = polyDepth[i] > 0;
          const nextInside = polyDepth[next] > 0;
          if (currentInside) {
            scratchX[out] = polyX[i];
            scratchZ[out] = polyZ[i];
            scratchLevel[out] = polyLevel[i];
            scratchDepth[out] = polyDepth[i];
            out += 1;
          }
          if (currentInside === nextInside) continue;
          const a = polyDepth[i];
          const b = polyDepth[next];
          const span = a - b;
          const t = Math.abs(span) > 1e-9 ? a / span : 0.5;
          scratchX[out] = polyX[i] + (polyX[next] - polyX[i]) * t;
          scratchZ[out] = polyZ[i] + (polyZ[next] - polyZ[i]) * t;
          scratchLevel[out] = polyLevel[i] + (polyLevel[next] - polyLevel[i]) * t;
          scratchDepth[out] = 0;
          out += 1;
        }
        count = out;
        for (let i = 0; i < count; i += 1) {
          polyX[i] = scratchX[i];
          polyZ[i] = scratchZ[i];
          polyLevel[i] = scratchLevel[i];
          polyDepth[i] = scratchDepth[i];
        }
      }
      emitPolygon(polyX, polyLevel, polyZ, polyDepth, count);
    }
  }
  return { positions, depths: outDepths, indices };
}
