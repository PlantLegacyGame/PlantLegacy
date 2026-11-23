/**
 * T56 slice 1: one authored region of real terrain volume.
 *
 * The world's ground is a height field: one value per column, so it can never
 * have an underside, an overhang or a second layer. This module is the first
 * piece of terrain that is a *volume* instead - a signed-distance field with
 * air above, rock inside, and a real lower surface where the rock ends.
 *
 * The region is authored, not generated planet-wide (ADR-043): a rock arch
 * standing on the ground near spawn. Its field is the same function on every
 * machine - `config/terrain_volume.json` seeds the wobble in its thickness - so
 * no chunk has to be stored to reproduce it. The existing T25 height field stays
 * the surface truth underneath, and the arch's feet are cut off below the drawn
 * ground so they disappear into the soil instead of ending on it.
 *
 * What this slice does *not* do, and the next one must: mesh the ground itself as
 * volume (so Root Sight looks into earth instead of into the back of a sheet),
 * chunk the region and stream it, carry per-voxel material ids, and collide the
 * result on the server.
 */
import { type SurfaceNetMesh, surfaceNets } from './surfaceNets.ts';

/** All tunables. Values come from `config/terrain_volume.json`. */
export interface TerrainVolumeParams {
  enabled: boolean;
  /** Centre of the authored region, pole-local metres. */
  centreXM: number;
  centreZM: number;
  /** Grid step of the field samples, metres. */
  voxelM: number;
  /** Air sampled round the solid, metres. */
  marginM: number;
  /** How far below the drawn ground the feet continue before being cut. */
  legDepthM: number;
  /** Deterministic seed for the rock's thickness wobble. */
  seed: number;
  /** Opening width between the feet, metres. */
  spanM: number;
  /** Crown height above the footing, metres. */
  riseM: number;
  /** Thickness of the rock band, metres. */
  thicknessM: number;
  /** Depth of the rock across the span, metres. */
  widthM: number;
  /** Direction the span runs, degrees from +x towards +z. */
  bearingDeg: number;
  /** Vertical spacing of the rock's beds, metres. */
  strataBandM: number;
}

/**
 * The shipped defaults, mirroring `config/terrain_volume.json`.
 *
 * The config file is the owner (RULE_3); this copy exists for the client's
 * fallback before the fetch answers and for tests that need a field without
 * reading the disk.
 */
export const DEFAULT_TERRAIN_VOLUME: TerrainVolumeParams = {
  enabled: true,
  centreXM: 11,
  centreZM: 8,
  voxelM: 0.3,
  marginM: 1.2,
  legDepthM: 1.4,
  seed: 20261123,
  spanM: 10,
  riseM: 3,
  thicknessM: 1.3,
  widthM: 2.6,
  bearingDeg: 38,
  strataBandM: 0.55,
};

/** Ground height at a pole-local (x, z), from the shared terrain field. */
export type GroundHeight = (x: number, z: number) => number;

/**
 * The ground the arch stands on: the lowest of its four feet.
 *
 * The field has no flat footing to offer. Anchored on the ground at the region's
 * centre, an arch across a slope stands with one foot in the air and the other
 * buried. Taking the lowest foot and cutting both legs `leg_depth_m` below the
 * *local* ground buries the uphill foot and brings the downhill foot down to the
 * ground it belongs on.
 */
export function archFooting(ground: GroundHeight, params: TerrainVolumeParams): number {
  const halfSpan = params.spanM / 2;
  const halfWidth = params.widthM / 2;
  const radians = (params.bearingDeg * Math.PI) / 180;
  const alongX = Math.cos(radians);
  const alongZ = Math.sin(radians);
  const acrossX = -alongZ;
  const acrossZ = alongX;
  let lowest = Number.POSITIVE_INFINITY;
  for (const spanSign of [-1, 1]) {
    for (const widthSign of [-1, 1]) {
      const x = params.centreXM + spanSign * halfSpan * alongX + widthSign * halfWidth * acrossX;
      const z = params.centreZM + spanSign * halfSpan * alongZ + widthSign * halfWidth * acrossZ;
      const height = ground(x, z);
      if (Number.isFinite(height) && height < lowest) lowest = height;
    }
  }
  return Number.isFinite(lowest) ? lowest : ground(params.centreXM, params.centreZM);
}

/**
 * The arch's signed distance: negative inside rock, positive in air.
 *
 * Three cuts, intersected with `max` because a point is inside the body only if
 * it is inside all of them:
 *
 * - **the ring** - distance to the ellipse the band follows. The ellipse's
 *   centre is the footing and its lower half is underground, so the visible body
 *   is an arch. The half-thickness is wobbled with the seed, which is what stops
 *   it reading as a machined pipe.
 * - **the width** - the band's depth across the span. A cut face, not a rounded
 *   tube, so the bridge has a flat top one can walk on.
 * - **the footing** - the plane `leg_depth_m` under the local ground. It closes
 *   the underside of each foot and keeps the ellipse's buried half from poking
 *   out of a hillside.
 */
export function archSdf(
  ground: GroundHeight,
  params: TerrainVolumeParams,
  footingY: number,
  x: number,
  y: number,
  z: number,
): number {
  const radians = (params.bearingDeg * Math.PI) / 180;
  const alongX = Math.cos(radians);
  const alongZ = Math.sin(radians);
  const dx = x - params.centreXM;
  const dz = z - params.centreZM;
  // `u` runs along the span, `w` across the bridge's width.
  const u = dx * alongX + dz * alongZ;
  const w = -dx * alongZ + dz * alongX;
  const v = y - footingY;
  const a = Math.max(0.1, params.spanM / 2);
  const b = Math.max(0.1, params.riseM);

  // Ellipse distance, the standard first-order approximation: f / |grad f|.
  // It is exact on the curve and accurate enough for a voxel field near it.
  const q = (u * u) / (a * a) + (v * v) / (b * b);
  const gradient = 2 * Math.hypot(u / (a * a), v / (b * b));
  const ringDistance = gradient > 1e-6 ? (q - 1) / gradient : -Math.min(a, b) * (1 - Math.sqrt(q));

  const angle = Math.atan2(v / b, u / a);
  const wobble =
    1 +
    0.16 * Math.sin(angle * 3 + params.seed * 0.00037) +
    0.08 * Math.sin(angle * 7 + params.seed * 0.00011);
  const halfThickness = Math.max(0.05, (params.thicknessM * wobble) / 2);
  const rock = Math.abs(ringDistance) - halfThickness;

  const across = Math.abs(w) - params.widthM / 2;
  // The foot cut follows the drawn ground, so it stays under the soil on a slope.
  const aboveFooting = ground(x, z) - params.legDepthM - y;

  return Math.max(rock, across, aboveFooting);
}

/** The region's sample bounds, with enough air on every side to close the mesh. */
export interface TerrainVolumeBounds {
  min: [number, number, number];
  max: [number, number, number];
  footingY: number;
}

export function terrainVolumeBounds(
  ground: GroundHeight,
  params: TerrainVolumeParams,
): TerrainVolumeBounds {
  const footingY = archFooting(ground, params);
  const reach = Math.max(params.spanM / 2, params.widthM / 2) + params.thicknessM + params.marginM;
  return {
    min: [
      params.centreXM - reach,
      footingY - params.legDepthM - params.marginM,
      params.centreZM - reach,
    ],
    max: [
      params.centreXM + reach,
      footingY + params.riseM + params.thicknessM + params.marginM,
      params.centreZM + reach,
    ],
    footingY,
  };
}

export interface TerrainVolumeMesh extends SurfaceNetMesh {
  /** Each vertex's fraction through its stratum: 0 at a bed's base, 1 at its top. */
  strata: Float32Array;
  /** World Y the arch's feet stand on (the lowest foot). */
  footingM: number;
}

/**
 * Sample the region's field and mesh it.
 *
 * `null` when the region is disabled or the field produced no surface, so the
 * caller has one case to handle instead of an empty buffer to draw.
 */
export function buildTerrainVolumeMesh(
  ground: GroundHeight,
  params: TerrainVolumeParams,
): TerrainVolumeMesh | null {
  if (!params.enabled) return null;
  const bounds = terrainVolumeBounds(ground, params);
  const extent: [number, number, number] = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const step = Math.max(0.05, params.voxelM);
  const counts: [number, number, number] = [
    Math.ceil(extent[0] / step) + 1,
    Math.ceil(extent[1] / step) + 1,
    Math.ceil(extent[2] / step) + 1,
  ];
  const mesh = surfaceNets({
    min: bounds.min,
    step,
    counts,
    sdf: (x, y, z) => archSdf(ground, params, bounds.footingY, x, y, z),
  });
  if (mesh.vertices === 0) return null;

  // Strata are computed here, from the same field and footing the geometry was
  // built from, so the renderer never has to agree with the mesher about where a
  // bed starts. One number per vertex: the material, in the only place a vertex
  // colour can carry it.
  const band = Math.max(0.05, params.strataBandM);
  const strata = new Float32Array(mesh.vertices);
  for (let v = 0; v < mesh.vertices; v += 1) {
    const height = (mesh.positions[v * 3 + 1] - bounds.footingY) / band;
    strata[v] = height - Math.floor(height);
  }
  return { ...mesh, strata, footingM: bounds.footingY };
}
