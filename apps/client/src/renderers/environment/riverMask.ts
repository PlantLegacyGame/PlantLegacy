/**
 * The surveyed river's baked mask, and the wire shape of the water table.
 *
 * Both outlived the sheet pipeline they were written inside: the soil shader
 * reads the mask to darken the wet bank and to keep the channel greyer than the
 * fields it crosses, and the water table arrives from the server through the
 * same tidy little grid. They live here so that deleting the sheets did not
 * mean retyping a texture baker.
 */
import { type RiverPath, riverNearest } from '@plant-legacy/shared/world';
import * as THREE from 'three';

/** Baked map of the surveyed route, used by the shaders. */
export interface RiverMask {
  texture: THREE.Texture;
  /** World position of the mask's (0, 0) texel corner. */
  originX: number;
  originZ: number;
  /** Side length of the square the mask covers, metres. */
  sizeM: number;
}

/**
 * Bake the surveyed route into a texture the water and soil shaders can sample.
 *
 * Red marks the channel (expanded by `marginM`) and green the damp bank band, so
 * a fragment anywhere in the world can ask "am I in the river?" without the
 * survey being re-run in GLSL.
 */
export function createRiverMask(
  path: RiverPath,
  extentM = 180,
  cells = 512,
  marginM = 0.5,
): RiverMask {
  const size = Math.max(8, Math.round(cells));
  const span = Math.max(8, extentM) * 2;
  const reach = path.halfWidthM + path.apronM + marginM;
  const data = new Uint8Array(size * size * 4);
  const bankWidth = Math.max(1, path.halfWidthM * 0.9);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const x = -span / 2 + ((i + 0.5) / size) * span;
      const z = -span / 2 + ((j + 0.5) / size) * span;
      const hit = riverNearest(path, x, z, reach);
      if (!hit) continue;
      const k = (j * size + i) * 4;
      data[k] = hit.distanceM <= path.halfWidthM + marginM ? 255 : 0;
      const bank = Math.min(1, Math.max(0, 1 - (hit.distanceM - bankWidth) / bankWidth));
      data[k + 1] = Math.round(255 * bank);
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { texture, originX: -span / 2, originZ: -span / 2, sizeM: span };
}

/** Coarse water-table grid as the server sends it. */
export interface WaterTableField {
  originX: number;
  originZ: number;
  cellSizeM: number;
  cells: number;
  /** Absolute world Y of the table per cell, row-major. */
  heights: Float32Array;
}
