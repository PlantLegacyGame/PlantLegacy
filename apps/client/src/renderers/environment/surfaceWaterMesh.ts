/**
 * The surface water, as a surface.
 *
 * The rain field was drawn by the soil shader: a fragment that stood under water
 * was tinted blue in place. That is exact at the waterline and needs no geometry,
 * but a tint has no surface - it cannot reflect the sky, catch the sun, or read as
 * a body with a top. It also had to live where the ground was drawn, so a hollow
 * deeper than the soil's own detail could not show it.
 *
 * This module is the other half: one mesh over the field, whose height is the
 * field's own water level (R in the texture - bed plus column) and whose depth is
 * the column (B). The mesh is the water's *top*, so it is level in a hollow, dips
 * to the bed where the water thins out, and ends exactly where the column reaches
 * zero. The shoreline is a contour of the solve, not an edge of the mesh: each
 * cell is clipped against the zero-depth isosurface (marching squares), so the
 * waterline runs between samples instead of following the square grid.
 *
 * The material is the same one the sea uses (`waterMaterial.ts`), so absorption,
 * Fresnel, ripples, the sun's highlight and aerial perspective are one set of
 * rules for every body of water in the world.
 *
 * No vertex is invented and no lift is applied: the surface is the number the
 * solver already decided, moved into geometry.
 */
import * as THREE from 'three';
import { worldColour } from '../worldPalette.ts';
import type { AtmosphereParams } from './atmosphere.js';
import { buildWaterContour } from './waterContour.js';
import { DEFAULT_WATER_COLORS, type WaterColors } from './waterFieldTuning.js';
import { createWaterMaterial, setWaterAtmosphere, type WaterMaterial } from './waterMaterial.js';

export interface SurfaceWaterMeshOptions {
  /** Samples per side, matching the field it is built from. */
  cells: number;
  /** Half the side of the square the field covers, metres. */
  extentM: number;
  /** Palette roles for the body, the shallows and the reflection. */
  colors?: WaterColors;
  /** Metres of column a fragment needs before it draws at all. */
  shoreDepthM?: number;
  /** How solid the body draws, 0..1. A cave river is seen through its mouth. */
  opacity?: number;
  /** Mesh name, so a stacked body can be told apart in the scene graph. */
  name?: string;
}

/** What the mesh needs from the field each time the field uploads. */
export interface SurfaceWaterSource {
  /** RGBA32F: R water level, G dampness, B depth. */
  readonly texture: THREE.Texture;
  readonly cells: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
}

export interface SurfaceWaterMesh {
  readonly mesh: THREE.Mesh;
  readonly material: WaterMaterial;
  /** Copy the field's level and depth into the geometry. */
  sync(source: SurfaceWaterSource): void;
  /** Remove the water over a Root Sight opening, metres. */
  setCavityClip(x: number, z: number, radiusM: number): void;
  /** Per-frame: sun, sky and the clock the ripples run on. */
  updateLighting(params: {
    timeSeconds: number;
    sunDir: THREE.Vector3;
    sunColor: THREE.Color;
    skyColor: THREE.Color;
    atmosphere?: AtmosphereParams;
  }): void;
  dispose(): void;
}

export function createSurfaceWaterMesh(options: SurfaceWaterMeshOptions): SurfaceWaterMesh {
  const cells = Math.max(8, Math.round(options.cells));
  const extentM = Math.max(4, options.extentM);

  // The geometry is rebuilt from the same solve that drives the shader. The
  // arrays start empty: a freshly-created world has no water, and an index count
  // of zero is an empty mesh rather than a sheet at y=0.
  const geometry = new THREE.BufferGeometry();
  const positionArray = new THREE.BufferAttribute(new Float32Array(0), 3);
  const waterArray = new THREE.BufferAttribute(new Float32Array(0), 1);
  const flowArray = new THREE.BufferAttribute(new Float32Array(0), 2);
  geometry.setAttribute('position', positionArray);
  geometry.setAttribute('aWater', waterArray);
  geometry.setAttribute('aFlowUV', flowArray);
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(extentM, 0, extentM),
    Math.hypot(extentM, 60),
  );

  const colors = options.colors ?? DEFAULT_WATER_COLORS;
  const waterMaterial = createWaterMaterial({ edgeFade: true });
  const uniforms = waterMaterial.material.uniforms;
  /** A uniform this module knows the material declares. */
  const uniform = (name: string): THREE.IUniform => {
    const found = uniforms[name];
    if (!found) throw new Error(`the water material declares no ${name}`);
    return found;
  };
  (uniform('uDeepColor').value as THREE.Color).copy(worldColour(colors.deep));
  (uniform('uShallowColor').value as THREE.Color).copy(worldColour(colors.shallow));
  (uniform('uSkyColor').value as THREE.Color).copy(worldColour(colors.sky));
  // A puddle is a body, not a window onto bright soil: at 0.9 of a shallow
  // sheet's low alpha, the bed showed through as pale cyan islands.
  uniform('uOpacity').value = options.opacity ?? 0.97;
  uniform('uMinVisibleDepth').value = options.shoreDepthM ?? 0.01;
  uniform('uNearDiscard').value = 0.08;
  // The surface is the level the solver chose, so there is nothing for a
  // submerge test to reject: a fragment is either part of the body (drawn) or
  // below the shoreline threshold (cut by the edge fade).
  uniform('uWaterSubmergeM').value = 1e3;
  uniform('uFadeRange').value = new THREE.Vector2(1e6, 1e6);
  uniform('uRippleStrength').value = 0.4;
  uniform('uFlow').value = new THREE.Vector2(0.03, 0.02);

  const mesh = new THREE.Mesh(geometry, waterMaterial.material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = options.name ?? 'surfaceWater';

  return {
    mesh,
    material: waterMaterial,
    sync(source) {
      const image = source.texture.image as { data?: Float32Array } | undefined;
      const data = image?.data;
      if (!data || data.length < source.cells * source.cells * 4) return;
      // The field's origin is the lower-left corner of its square, so the mesh
      // moves with the field and the vertices stay in cell-local metres.
      mesh.position.set(source.originX, 0, source.originZ);
      const contour = buildWaterContour(data, source.cells, source.cellSizeM);
      if (contour.positions.length === 0) {
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
        return;
      }
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(contour.positions), 3),
      );
      geometry.setAttribute(
        'aWater',
        new THREE.BufferAttribute(new Float32Array(contour.depths), 1),
      );
      geometry.setAttribute(
        'aFlowUV',
        new THREE.BufferAttribute(new Float32Array((contour.positions.length / 3) * 2), 2),
      );
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(contour.indices), 1));
      // Water runs downhill. The solver already moves the volume that way; this
      // reads its own surface gradient so the streaks and ripples travel down
      // the fall line instead of drifting in one fixed direction. A level pool
      // has no gradient and keeps the old slow drift.
      const middleCell = Math.floor(cells * 0.5);
      const centre = middleCell * cells + middleCell;
      const levelAt = (index: number): number => data[index * 4] ?? 0;
      const gx = (levelAt(centre + 1) - levelAt(centre - 1)) / (2 * source.cellSizeM);
      const gz = (levelAt(centre + cells) - levelAt(centre - cells)) / (2 * source.cellSizeM);
      const slope = Math.hypot(gx, gz);
      if (slope > 1e-4) {
        const speed = Math.min(0.22, 0.08 + slope * 0.9);
        (uniform('uFlow').value as THREE.Vector2).set((-gx / slope) * speed, (-gz / slope) * speed);
      } else {
        (uniform('uFlow').value as THREE.Vector2).set(0.03, 0.02);
      }
      // The square's edge must never be visible: fade the last fifth of the rim
      // out radially, with the centre following the field.
      uniform('uSheetCenter').value = new THREE.Vector2(
        source.originX + source.cells * source.cellSizeM * 0.5,
        source.originZ + source.cells * source.cellSizeM * 0.5,
      );
      uniform('uSheetFade').value = new THREE.Vector2(extentM * 0.8, extentM * 0.99);
    },
    setCavityClip(x, z, radiusM) {
      uniform('uCavityCenter').value = new THREE.Vector2(x, z);
      uniform('uCavityRadius').value = Math.max(0, radiusM);
    },
    updateLighting(params) {
      uniform('uTime').value = params.timeSeconds;
      (uniform('uSunDir').value as THREE.Vector3).copy(params.sunDir);
      (uniform('uSunColor').value as THREE.Color).copy(params.sunColor);
      (uniform('uSkyColor').value as THREE.Color).copy(params.skyColor);
      if (params.atmosphere) setWaterAtmosphere(waterMaterial, params.atmosphere);
    },
    dispose() {
      geometry.dispose();
      waterMaterial.material.dispose();
    },
  };
}
