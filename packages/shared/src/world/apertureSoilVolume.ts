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
 * - **The void is the aperture**, a hair wider than the bowl's mouth, so the
 *   tuned bowl still lines the hole it was tuned for and the block never pokes
 *   through it.
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
): number {
  const surface = ground(x, z);
  const top = surface - params.topInsetM;
  const floor = surface - Math.max(0.2, params.depthM);
  const radius = Math.hypot(x - params.centreXM, z - params.centreZM);
  // Negative inside: below the top, above the floor, inside the extent, outside
  // the void. Each term is the signed distance to one face of that intersection.
  return Math.max(
    y - top,
    floor - y,
    radius - Math.max(0.2, params.extentM),
    Math.max(0.05, params.voidRadiusM) - radius,
  );
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

  const mesh = surfaceNets({
    min: bounds.min,
    step,
    counts,
    sdf: (x, y, z) => apertureSoilSdf(ground, params, x, y, z),
  });
  if (mesh.vertices === 0) return null;

  const depth = Math.max(0.2, params.depthM);
  const strata = new Float32Array(mesh.vertices);
  for (let v = 0; v < mesh.vertices; v += 1) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const z = mesh.positions[v * 3 + 2];
    const top = ground(x, z) - params.topInsetM;
    strata[v] = Math.min(0.999, Math.max(0, (top - y) / depth));
  }
  return { ...mesh, strata };
}
