/**
 * The ground the water is allowed to stand on, as textures the water shader can
 * sample.
 *
 * The water sheet is built from the terrain *field*, but the eye sees the
 * terrain *mesh*. A coarse triangle interpolates across metres of relief and
 * sits below the field on a rise, so a water surface that is genuinely
 * underground can still be drawn in front of the hill. The old guard covered a
 * 180 m detail patch and a 560 m ring; those are not the shipped ground any
 * more. The fine grid now follows the play disc's own 2 m grid out to 620 m,
 * and the coarse grid follows the transition ring out to 20 km.
 *
 * The ring's cells grow with radius, so one square texture cannot copy them
 * exactly without becoming enormous. The coarse guard therefore samples at the
 * ring's outer angular spacing (about 64 m), where the guard is actually needed;
 * the fine grid is authoritative everywhere the player can walk.
 */
import * as THREE from 'three';
import {
  HORIZON_RING_OUTER_M,
  PLAY_DISK_CELL_M,
  PLAY_DISK_RADIUS_M,
  planetSurfaceY,
} from './planetSurface.ts';
import type { WaterFieldTuning } from './waterFieldTuning.ts';

/** How far above the sampled ground a water surface may sit before it is cut. */
export const WATER_GROUND_SUBMERGE_M = 0.35;

/** The transition ring's outer angular cell, the coarsest drawn spacing. */
export const WATER_GROUND_RING_CELL_M = 64;

/** A square guard texture cannot grow without bound if a config is mistyped. */
const MAX_GUARD_CELLS = 1025;

/** The coarse grid takes over just inside the fine grid's edge, not before it. */
const COARSE_INNER_FRACTION = 0.97;

export interface WaterGroundExtents {
  fineRadiusM: number;
  fineCellM: number;
  fineCells: number;
  coarseRadiusM: number;
  coarseCellM: number;
  coarseCells: number;
  /** Radius beyond which the coarse grid is allowed to judge a fragment. */
  coarseInnerRadiusM: number;
}

export interface WaterGroundTexture {
  texture: THREE.DataTexture;
  cells: number;
  originX: number;
  originZ: number;
  sizeM: number;
  minY: number;
  spanY: number;
}

export interface WaterGroundGuard {
  readonly extents: WaterGroundExtents;
  readonly planetRadiusM: number;
  readonly fine: WaterGroundTexture;
  readonly coarse: WaterGroundTexture;
  /** Point a water material at both grids and enable its submerge test. */
  applyTo(material: THREE.ShaderMaterial, submergeM?: number): void;
  dispose(): void;
}

export interface WaterGroundGuardOptions {
  /** The play disc's radius, normally `config.terrainRadius`. */
  playRadiusM?: number;
  /** The planet radius, so curvature is not baked into the 8-bit ramp. */
  planetRadiusM?: number;
  /** Terrain height at a world XZ, including the planet's curvature. */
  sampleY: (x: number, z: number) => number;
  tuning?: Partial<WaterFieldTuning>;
}

function sampleCount(radiusM: number, cellM: number): number {
  const wanted = Math.round((radiusM * 2) / Math.max(0.5, cellM)) + 1;
  return Math.min(MAX_GUARD_CELLS, Math.max(8, wanted));
}

/**
 * Resolve the two guard grids for the current ground.
 *
 * The radii come from the world's geometry, not from the old detail/ring
 * constants: the fine grid starts at the play disc and the coarse grid reaches
 * the transition ring's outer edge.
 */
export function waterGroundExtents(
  playRadiusM = PLAY_DISK_RADIUS_M,
  tuning: Partial<WaterFieldTuning> = {},
): WaterGroundExtents {
  const playRadius =
    Number.isFinite(playRadiusM) && playRadiusM > 0 ? playRadiusM : PLAY_DISK_RADIUS_M;
  const fineRadiusM = Math.max(playRadius, tuning.groundTestFineRadiusM ?? PLAY_DISK_RADIUS_M);
  const fineCellM = Math.max(0.5, tuning.groundTestFineCellM ?? PLAY_DISK_CELL_M);
  const coarseRadiusM = Math.max(fineRadiusM, tuning.groundTestRadiusM ?? HORIZON_RING_OUTER_M);
  const coarseCellM = Math.max(fineCellM, tuning.groundTestCellM ?? WATER_GROUND_RING_CELL_M);
  return {
    fineRadiusM,
    fineCellM,
    fineCells: sampleCount(fineRadiusM, fineCellM),
    coarseRadiusM,
    coarseCellM,
    coarseCells: sampleCount(coarseRadiusM, coarseCellM),
    coarseInnerRadiusM: fineRadiusM * COARSE_INNER_FRACTION,
  };
}

function buildGroundTexture(
  sampleY: (x: number, z: number) => number,
  planetRadiusM: number,
  radiusM: number,
  cells: number,
): WaterGroundTexture {
  const step = (radiusM * 2) / (cells - 1);
  const heights = new Float32Array(cells * cells);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let z = 0; z < cells; z += 1) {
    const worldZ = -radiusM + z * step;
    for (let x = 0; x < cells; x += 1) {
      const worldX = -radiusM + x * step;
      // Store height above the planet's tangent surface, not absolute world Y:
      // at 20 km the curvature alone is 2 km, which would turn an 8-bit ramp
      // into metre-sized steps. The shader adds the drop back per fragment.
      const height = sampleY(worldX, worldZ) - planetSurfaceY(planetRadiusM, worldX, worldZ);
      heights[z * cells + x] = height;
      if (height < min) min = height;
      if (height > max) max = height;
    }
  }

  const span = Math.max(0.001, max - min);
  const data = new Uint8Array(cells * cells * 4);
  for (let i = 0; i < heights.length; i += 1) {
    const value = Math.round(((heights[i] - min) / span) * 255);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, cells, cells, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    cells,
    originX: -radiusM,
    originZ: -radiusM,
    sizeM: radiusM * 2,
    minY: min,
    spanY: span,
  };
}

/**
 * Build the guard once. The terrain is static, so the textures do not need a
 * per-frame or per-upload rebuild.
 */
export function createWaterGroundGuard(options: WaterGroundGuardOptions): WaterGroundGuard {
  const extents = waterGroundExtents(options.playRadiusM, options.tuning);
  const planetRadiusM = options.planetRadiusM ?? 0;
  const fine = buildGroundTexture(
    options.sampleY,
    planetRadiusM,
    extents.fineRadiusM,
    extents.fineCells,
  );
  const coarse = buildGroundTexture(
    options.sampleY,
    planetRadiusM,
    extents.coarseRadiusM,
    extents.coarseCells,
  );

  return {
    extents,
    planetRadiusM,
    fine,
    coarse,
    applyTo(material, submergeM = WATER_GROUND_SUBMERGE_M) {
      const uniforms = material.uniforms;
      uniforms.uGroundHeight.value = fine.texture;
      uniforms.uGroundHeightAvailable.value = 1;
      (uniforms.uGroundHeightOrigin.value as THREE.Vector2).set(fine.originX, fine.originZ);
      uniforms.uGroundHeightSize.value = fine.sizeM;
      (uniforms.uGroundHeightRange.value as THREE.Vector2).set(fine.minY, fine.spanY);

      uniforms.uGroundCoarse.value = coarse.texture;
      uniforms.uGroundCoarseAvailable.value = 1;
      (uniforms.uGroundCoarseOrigin.value as THREE.Vector2).set(coarse.originX, coarse.originZ);
      uniforms.uGroundCoarseSize.value = coarse.sizeM;
      (uniforms.uGroundCoarseRange.value as THREE.Vector2).set(coarse.minY, coarse.spanY);
      uniforms.uGroundCoarseInnerRadiusM.value = extents.coarseInnerRadiusM;
      uniforms.uGroundPlanetRadius.value = planetRadiusM;
      uniforms.uWaterSubmergeM.value = submergeM;
    },
    dispose() {
      fine.texture.dispose();
      coarse.texture.dispose();
    },
  };
}
