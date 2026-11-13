/**
 * Soil as a physical material, not a texture.
 *
 * Soil is a granular medium: mineral particles, water and air. Its behaviour is
 * set by how much water fills the pore space (which changes bulk density,
 * suction cohesion and the angle of repose) and by how tightly it is packed
 * (compaction, which removes void space). These functions are pure so the server
 * tick, the client shader inputs and the tests all share one model.
 *
 * Units are SI throughout: kg/m³, kPa, metres, radians, seconds.
 */

export interface SoilPhysicsParams {
  /** Density of the mineral particles themselves (quartz ~2650). */
  particleDensityKgM3: number;
  /** Bulk density oven-dry, loosely packed. */
  dryBulkDensityKgM3: number;
  /** Bulk density at full saturation (water fills the pores). */
  saturatedBulkDensityKgM3: number;
  /** Minimum (compacted) and maximum (loose) porosity of the matrix. */
  porosityMin: number;
  porosityMax: number;
  /** Effective cohesion when dry (matric suction in a dry soil). */
  cohesionDryKPa: number;
  /** Cohesion at full saturation: suction is gone, only interlocking remains. */
  cohesionSaturatedKPa: number;
  /** Internal friction angle of the particles. */
  frictionAngleDeg: number;
  /** Angle of repose when saturated (lubricated grains slide more easily). */
  reposeSaturatedDeg: number;
  /** How fast loose soil settles toward its equilibrium density, per second. */
  settlementRatePerS: number;
  /** How fast unsupported void (an open cavity) fills in, per second at zero strength. */
  cavityCollapseRatePerS: number;
}

export const DEFAULT_SOIL_PHYSICS: SoilPhysicsParams = {
  particleDensityKgM3: 2650,
  dryBulkDensityKgM3: 1300,
  saturatedBulkDensityKgM3: 1900,
  porosityMin: 0.3,
  porosityMax: 0.55,
  cohesionDryKPa: 12,
  cohesionSaturatedKPa: 2,
  frictionAngleDeg: 32,
  reposeSaturatedDeg: 18,
  settlementRatePerS: 0.08,
  cavityCollapseRatePerS: 0.35,
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Water content that maximises suction cohesion (damp, not saturated). */
export const PEAK_COHESION_MOISTURE = 0.45;

/**
 * Bulk density: dry soil plus the mass of the water in its pores.
 * Density rises with water content and falls again when the matrix is loose.
 */
export function bulkDensityKgM3(
  params: SoilPhysicsParams,
  moisture01: number,
  compaction01 = 0.5,
): number {
  const wetness = clamp01(moisture01);
  const compaction = clamp01(compaction01);
  const dryEnd = params.dryBulkDensityKgM3;
  const wetEnd = params.saturatedBulkDensityKgM3;
  const water = wetEnd - dryEnd;
  // Compaction narrows the pore space, so the same water content adds less mass
  // but the matrix itself is denser.
  const matrixGain = 1 + (compaction - 0.5) * 0.18;
  return (dryEnd + water * wetness * (1.15 - 0.3 * compaction)) * matrixGain;
}

/** Porosity from the solid density: 1 - bulk/particle. */
export function porosity(params: SoilPhysicsParams, bulkDensity: number): number {
  const ratio = 1 - bulkDensity / params.particleDensityKgM3;
  return Math.min(params.porosityMax, Math.max(params.porosityMin, ratio));
}

/** Void ratio e = Vvoid / Vsolid, the geotechnical packing measure. */
export function voidRatio(params: SoilPhysicsParams, bulkDensity: number): number {
  const n = porosity(params, bulkDensity);
  return n / Math.max(1e-6, 1 - n);
}

/**
 * Effective cohesion. Dry soil holds together by matric suction, which peaks at
 * dampness and vanishes when the pores are full; saturated soil keeps only the
 * small interlocking term.
 */
export function cohesionKPa(params: SoilPhysicsParams, moisture01: number): number {
  const wetness = clamp01(moisture01);
  // Suction rises to a peak and collapses as saturation approaches.
  const suctionCurve = Math.sin(Math.PI * Math.min(1, wetness / (2 * PEAK_COHESION_MOISTURE)));
  const suction = (params.cohesionDryKPa - params.cohesionSaturatedKPa) * suctionCurve;
  return params.cohesionSaturatedKPa + Math.max(0, suction) * (1 - wetness) ** 0.5;
}

/** Angle of repose: wet grains lubricate, so the stable slope shallows out. */
export function angleOfReposeRad(params: SoilPhysicsParams, moisture01: number): number {
  const wetness = clamp01(moisture01);
  const friction = (params.frictionAngleDeg * Math.PI) / 180;
  const wet = (params.reposeSaturatedDeg * Math.PI) / 180;
  return wet + (friction - wet) * (1 - wetness) ** 1.4;
}

/**
 * Largest unsupported span a cavity can hold, from the tunnel-crown solution
 * R = 2c / γ (Terzaghi), where γ is the unit weight of the overburden. Wet or
 * loose soil cannot hold a large void; dry cohesive soil can.
 */
export function maxUnsupportedSpanM(
  params: SoilPhysicsParams,
  moisture01: number,
  compaction01 = 0.5,
): number {
  const density = bulkDensityKgM3(params, moisture01, compaction01);
  const unitWeight = density * 9.81; // N/m³
  const cohesionPa = cohesionKPa(params, moisture01) * 1000;
  return Math.max(0, (2 * cohesionPa) / Math.max(1e-6, unitWeight));
}

/**
 * Collapse rate for an open cavity of a given radius: a cavity smaller than the
 * stable span stands, a larger one fills in, faster the more unstable it is.
 * Returns the fraction of the void that closes per second.
 */
export function cavityCollapseRatePerS(
  params: SoilPhysicsParams,
  moisture01: number,
  compaction01: number,
  cavityRadiusM: number,
): number {
  if (cavityRadiusM <= 0) return 0;
  const span = maxUnsupportedSpanM(params, moisture01, compaction01);
  if (cavityRadiusM <= span) return 0;
  const overload = cavityRadiusM / Math.max(1e-6, span) - 1;
  return params.cavityCollapseRatePerS * Math.min(2, overload);
}

/** Apply cavity collapse for `dt` seconds; void fraction stays in [0, 1]. */
export function cavityVoidAfter(
  params: SoilPhysicsParams,
  void0: number,
  dtSeconds: number,
  moisture01: number,
  compaction01: number,
  cavityRadiusM: number,
): number {
  const rate = cavityCollapseRatePerS(params, moisture01, compaction01, cavityRadiusM);
  if (rate <= 0) return clamp01(void0);
  return clamp01(void0 * Math.exp(-rate * Math.max(0, dtSeconds)));
}

/**
 * Settlement of loose fill: compacted soil is stable, loose soil creeps toward
 * the equilibrium density at a moisture-dependent rate.
 */
export function compactionAfter(
  params: SoilPhysicsParams,
  compaction01: number,
  dtSeconds: number,
  moisture01: number,
): number {
  const target = 0.55;
  const rate = params.settlementRatePerS * (0.4 + 0.6 * clamp01(moisture01));
  const next =
    compaction01 + (target - compaction01) * (1 - Math.exp(-rate * Math.max(0, dtSeconds)));
  return clamp01(next);
}
