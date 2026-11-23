/**
 * T56 slice 2: the soil the Root Sight aperture is cut through, as a volume.
 *
 * The world's ground is still a height field: one sheet, no thickness. Root
 * Sight opens a hole in it, the tuned bowl lines the hole, and the sheet's cut
 * edge is a paper edge. From above that reads as a pit; from *under* the sheet it
 * reads as the back of a sheet, because that is exactly what it is - the only
 * soil a buried eye can see is the underside of the same single surface.
 *
 * This region gives the ground under the aperture a body: a block of soil whose
 * top follows the drawn surface, whose floor sits below the cavity, and whose
 * centre is the aperture's own void. Meshed by the same surface nets as the arch
 * (T56 slice 1) from the same kind of signed-distance field.
 *
 * Three numbers make it fit the world without touching it:
 *
 * - **The top is 3 cm under the sheet.** From above, the opaque sheet is in
 *   front of this body and nothing changes; from below, this body is in front of
 *   the sheet's back and the eye sees earth with a floor and a shaft wall
 *   instead. No shader edit, no second surface at the same depth to z-fight.
 * - **The void is the aperture**, a hair wider than the bowl's mouth at the top,
 *   so the tuned bowl still lines the hole it was tuned for and the block never
 *   pokes through it. Below the top the shaft is wider by the sag the mesh
 *   actually has - measured from the first pass, because a face between two
 *   vertices on the void can still stand inside it - and by nothing more: the
 *   shaft is a polygon, so widening it further only shows as a barrel around
 *   the bowl.
 * - **The floor is deeper than the pit**, so the body contains the cavity rather
 *   than ending on its floor.
 *
 * The body is *solid* around the shaft. A buried eye inside it is inside soil,
 * and what it sees is the body's inner walls: the underside of the ground, the
 * shaft through it, and the floor beneath. That is the difference between being
 * in the earth and looking at the back of a plane.
 */
import type { SurfaceNetMesh } from './surfaceNets.ts';
import { surfaceNets } from './surfaceNets.ts';
import type { GroundHeight } from './terrainVolume.ts';

export interface ApertureSoilParams {
  /** Centre of the aperture, pole-local metres, in the ground's own frame. */
  centreXM: number;
  centreZM: number;
  /** Plan radius of the air the aperture removes: the bowl's mouth. */
  voidRadiusM: number;
  /** Plan radius of the soil body around the shaft. */
  extentM: number;
  /** How far below the drawn surface the body's floor sits. */
  depthM: number;
  /** How far below the drawn surface the body's top sits. */
  topInsetM: number;
  /** Field sample spacing, metres. */
  voxelM: number;
  /** Air sampled round the body so the mesh closes. */
  marginM: number;
}

/**
 * A body wide enough that a buried eye near the aperture is inside it, deep
 * enough to hold the deepest cavity a config-sized aperture can open, and fine
 * enough that the shaft reads as a cut rather than a polygon.
 */
export const DEFAULT_APERTURE_SOIL: ApertureSoilParams = {
  centreXM: 0,
  centreZM: 0,
  voidRadiusM: 1,
  extentM: 3.6,
  depthM: 3.4,
  topInsetM: 0.03,
  voxelM: 0.26,
  marginM: 0.9,
};

/** A meshed aperture body: the surface-nets mesh plus each vertex's depth. */
export interface ApertureSoilMesh extends SurfaceNetMesh {
  /** 0 at the body's top, 1 at its floor. The renderer bands its strata with it. */
  strata: Float32Array;
}

/**
 * The body's sample bounds.
 *
 * The ground is sampled across the body's plan because the top follows the
 * terrain: a block cut to the centre's height would float over a dip and bury
 * itself in a rise. The same samples set the floor, which is a constant
 * thickness below the ground rather than a flat plane.
 */
export function apertureSoilBounds(
  ground: GroundHeight,
  params: ApertureSoilParams,
): { min: [number, number, number]; max: [number, number, number] } {
  const extent = Math.max(0.2, params.extentM);
  const margin = Math.max(0.2, params.marginM);
  const steps = 8;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const x = params.centreXM - extent + (2 * extent * i) / steps;
      const z = params.centreZM - extent + (2 * extent * j) / steps;
      const height = ground(x, z);
      if (!Number.isFinite(height)) continue;
      if (height < lowest) lowest = height;
      if (height > highest) highest = height;
    }
  }
  if (!Number.isFinite(lowest) || !Number.isFinite(highest)) {
    const centre = ground(params.centreXM, params.centreZM);
    lowest = centre;
    highest = centre;
  }
  return {
    min: [
      params.centreXM - extent - margin,
      lowest - Math.max(0.2, params.depthM) - margin,
      params.centreZM - extent - margin,
    ],
    max: [
      params.centreXM + extent + margin,
      highest - params.topInsetM + margin,
      params.centreZM + extent + margin,
    ],
  };
}

/**
 * Signed distance to the soil body: negative inside it.
 *
 * Four cuts intersected with `max`, because a point is inside the body only if
 * it is inside all of them: under the drawn surface, above the floor, inside the
 * plan extent, and outside the aperture's void.
 */
export function apertureSoilSdf(
  ground: GroundHeight,
  params: ApertureSoilParams,
  x: number,
  y: number,
  z: number,
  /** Radius of the shaft's wall below the top; defaults to the void's own. */
  shaftRadiusM = Math.max(0.05, params.voidRadiusM),
): number {
  const surface = ground(x, z);
  const top = surface - params.topInsetM;
  const floor = surface - Math.max(0.2, params.depthM);
  const radius = Math.hypot(x - params.centreXM, z - params.centreZM);
  const voidRadius = Math.max(0.05, params.voidRadiusM);
  // The top keeps the void's own radius so its edge still meets the sheet's
  // cut; below it the wall may stand further out (see `shaftFaceSag`).
  const cutRadius = y < top - 0.005 ? Math.max(voidRadius, shaftRadiusM) : voidRadius;
  // Negative inside: below the top, above the floor, inside the extent, outside
  // the void. Each term is the signed distance to one face of that intersection.
  return Math.max(y - top, floor - y, radius - Math.max(0.2, params.extentM), cutRadius - radius);
}

/**
 * How far the meshed shaft's faces fall inside the void, metres.
 *
 * The wall's vertices sit on the void, but the triangle between two of them is
 * a chord and dips inside it - by centimetres where the shaft is only a few
 * voxels across. Measuring the mesh is the only honest way to know how much:
 * the sag depends on the polygon surface nets happens to produce, not on a
 * formula, and an earlier guess of three times a nominal chord over-widened the
 * shaft into a barrel around a seedling's bowl.
 */
function shaftFaceSag(
  mesh: SurfaceNetMesh,
  params: ApertureSoilParams,
  voidRadius: number,
  heightAt: GroundHeight,
  step: number,
): number {
  const shaftReach = voidRadius + 2 * step;
  let minRadius = Number.POSITIVE_INFINITY;
  const { positions, indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    // The top annulus is a face at the sheet's cut, not the shaft's wall.
    if (
      positions[a * 3 + 1] >
        heightAt(positions[a * 3], positions[a * 3 + 2]) - params.topInsetM - 0.01 ||
      positions[b * 3 + 1] >
        heightAt(positions[b * 3], positions[b * 3 + 2]) - params.topInsetM - 0.01 ||
      positions[c * 3 + 1] >
        heightAt(positions[c * 3], positions[c * 3 + 2]) - params.topInsetM - 0.01
    ) {
      continue;
    }
    const corners = [a, b, c];
    const radii = corners.map((v) =>
      Math.hypot(positions[v * 3] - params.centreXM, positions[v * 3 + 2] - params.centreZM),
    );
    if (Math.max(...radii) > shaftReach) continue;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      for (const f of [0.25, 0.5, 0.75]) {
        const x = positions[u * 3] + (positions[v * 3] - positions[u * 3]) * f;
        const z = positions[u * 3 + 2] + (positions[v * 3 + 2] - positions[u * 3 + 2]) * f;
        const radius = Math.hypot(x - params.centreXM, z - params.centreZM);
        if (radius < minRadius) minRadius = radius;
      }
    }
  }
  return Number.isFinite(minRadius) ? Math.max(0, voidRadius - minRadius) : 0;
}

/**
 * Mesh the body, or `null` when there is nothing to draw.
 *
 * Built lazily by the client, once per aperture, because it is only ever seen by
 * an eye that is already underground: the surface view is still the sheet.
 */
export function buildApertureSoilMesh(
  ground: GroundHeight,
  params: ApertureSoilParams,
): ApertureSoilMesh | null {
  const bounds = apertureSoilBounds(ground, params);
  const step = Math.max(0.05, params.voxelM);
  const counts: [number, number, number] = [
    Math.ceil((bounds.max[0] - bounds.min[0]) / step) + 1,
    Math.ceil((bounds.max[1] - bounds.min[1]) / step) + 1,
    Math.ceil((bounds.max[2] - bounds.min[2]) / step) + 1,
  ];
  if (counts[0] < 2 || counts[1] < 2 || counts[2] < 2) return null;

  // One drawn-surface sample per column (x, z), interpolated between columns.
  // The mesher asks the field for every sample on the grid, and the gradient
  // normals add six more per vertex, so the same column's height was being
  // fetched dozens of times: about 50 000 terrain calls for ~1 200 columns at a
  // seedling's aperture, and that was the whole build. The surface varies over
  // metres, not voxels, so a bilinear read of the column heights is enough - and
  // it is exact at every grid point, where the field is sampled.
  const columns = counts[0] * counts[2];
  const heights = new Float64Array(columns).fill(Number.NaN);
  const columnHeight = (ix: number, iz: number): number => {
    const at = ix * counts[2] + iz;
    const known = heights[at];
    // NaN marks a column that has not been sampled yet.
    if (!Number.isNaN(known)) return known;
    const height = ground(bounds.min[0] + ix * step, bounds.min[2] + iz * step);
    heights[at] = height;
    return height;
  };
  const heightAt = (x: number, z: number): number => {
    const fx = Math.min(counts[0] - 1, Math.max(0, (x - bounds.min[0]) / step));
    const fz = Math.min(counts[2] - 1, Math.max(0, (z - bounds.min[2]) / step));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const ix1 = Math.min(counts[0] - 1, ix + 1);
    const iz1 = Math.min(counts[2] - 1, iz + 1);
    const near = columnHeight(ix, iz) * (1 - tx) + columnHeight(ix1, iz) * tx;
    const far = columnHeight(ix, iz1) * (1 - tx) + columnHeight(ix1, iz1) * tx;
    return near * (1 - tz) + far * tz;
  };

  const voidRadius = Math.max(0.05, params.voidRadiusM);

  // How far the wall's faces will sag inside the void depends only on the shaft's
  // own polygon, so measure it on a tiny slab around the aperture rather than
  // meshing the whole body twice. The slab's grid is snapped to the body's, so
  // surface nets produces the same cells it will in the real mesh.
  const sag = ((): number => {
    const reach = voidRadius + 2 * step;
    const topHere = heightAt(params.centreXM, params.centreZM) - params.topInsetM;
    const slabM = Math.min(Math.max(0.6, 2 * voidRadius), Math.max(0.6, params.depthM * 0.5));
    const i0 = Math.floor((params.centreXM - reach - bounds.min[0]) / step);
    const k0 = Math.floor((params.centreZM - reach - bounds.min[2]) / step);
    const j0 = Math.floor((topHere - 0.02 - slabM - bounds.min[1]) / step);
    const slabCounts: [number, number, number] = [
      Math.ceil((2 * reach) / step) + 2,
      Math.ceil(slabM / step) + 2,
      Math.ceil((2 * reach) / step) + 2,
    ];
    const slab = surfaceNets({
      min: [bounds.min[0] + i0 * step, bounds.min[1] + j0 * step, bounds.min[2] + k0 * step],
      step,
      counts: slabCounts,
      sdf: (x, y, z) => apertureSoilSdf(heightAt, params, x, y, z, voidRadius),
    });
    return shaftFaceSag(slab, params, voidRadius, heightAt, step);
  })();
  // Only widen when a face would otherwise come within the 2 cm the void keeps
  // from the bowl's mouth, and then by exactly that sag.
  const wallRadius = sag > 0.015 ? voidRadius + sag + 0.004 : voidRadius;
  const mesh = surfaceNets({
    min: bounds.min,
    step,
    counts,
    sdf: (x, y, z) => apertureSoilSdf(heightAt, params, x, y, z, wallRadius),
  });
  if (mesh.vertices === 0) return null;

  // The top's hole is cut at the void's radius, but surface nets places the
  // annulus's inner vertices at cell centres, which can be most of a cell away:
  // at a seedling's 0.23 m mouth the earth's opening measured 0.38 m across, so
  // a buried eye saw a barrel of sky around the pit. Snap those vertices onto
  // the void's circle at the top plane; the wall below keeps the sag's margin.
  const snapReach = voidRadius + 0.9 * step;
  for (let v = 0; v < mesh.vertices; v += 1) {
    let x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    let z = mesh.positions[v * 3 + 2];
    const top = heightAt(x, z) - params.topInsetM;
    if (y < top - step || y > top + 0.02) continue;
    const radial = Math.hypot(x - params.centreXM, z - params.centreZM);
    if (radial <= 1e-6 || radial > snapReach) continue;
    const scale = voidRadius / radial;
    x = params.centreXM + (x - params.centreXM) * scale;
    z = params.centreZM + (z - params.centreZM) * scale;
    mesh.positions[v * 3] = x;
    // The surface can fall across the move, so read its height here, not at the
    // vertex's old column.
    mesh.positions[v * 3 + 1] = heightAt(x, z) - params.topInsetM;
    mesh.positions[v * 3 + 2] = z;
  }

  const depth = Math.max(0.2, params.depthM);
  const strata = new Float32Array(mesh.vertices);
  for (let v = 0; v < mesh.vertices; v += 1) {
    let x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    let z = mesh.positions[v * 3 + 2];
    // Surface nets can put a shaft vertex up to a voxel inside the field's zero
    // crossing, and at a seedling's 30 cm mouth that is centimetres into the
    // hole the bowl lines. Push those vertices back out to the void's own radius
    // so the drawn wall honours the field at every size: no part of the body is
    // ever inside the void, and so never inside the bowl's mouth.
    const radial = Math.hypot(x - params.centreXM, z - params.centreZM);
    if (radial > 1e-6 && radial < voidRadius) {
      const push = voidRadius / radial;
      x = params.centreXM + (x - params.centreXM) * push;
      z = params.centreZM + (z - params.centreZM) * push;
      mesh.positions[v * 3] = x;
      mesh.positions[v * 3 + 2] = z;
    }
    const top = heightAt(x, z) - params.topInsetM;
    strata[v] = Math.min(0.999, Math.max(0, (top - y) / depth));
  }
  return { ...mesh, strata };
}
