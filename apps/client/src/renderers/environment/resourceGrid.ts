/**
 * The ground's per-tile resource texture.
 *
 * The server sends the tile grid (light, moisture, minerals) and the soil shader
 * samples it to tint and light the ground. Two things matter here and are easy
 * to get wrong:
 *
 * - A full grid is 65 536 tiles = 1 MB of floats, so the Float32Array and the
 *   DataTexture are reused whenever the dimensions are unchanged. Allocating on
 *   every message stalled the WebSocket handler.
 * - A weather change dirties every tile; that arrives as a base64 buffer of
 *   three 0-255 channels instead of 65 536 JSON objects.
 */
import * as THREE from 'three';
import type { GroundShaderUniforms } from './ground.js';

/**
 * Tile ranges the shader normalises against, from config/resources.json.
 *
 * Light is divided by `tileLightBase` because the shader wants "fraction of full
 * daylight"; moisture and minerals are divided by their true maxima, which the
 * old hardcoded 255 did not match (the config maxima are 500).
 */
export interface TileNormalization {
  tileLightBase: number;
  maxLight: number;
  maxMoisture: number;
  maxMinerals: number;
}

/** Documented defaults, used only when the server value could not be loaded. */
export const DEFAULT_TILE_NORMALIZATION: TileNormalization = {
  tileLightBase: 80,
  maxLight: 500,
  maxMoisture: 500,
  maxMinerals: 500,
};

/** Normalised channel values recorded per tile. */
export interface ResourceTile {
  tileX: number;
  tileZ: number;
  light: number;
  moisture: number;
  minerals: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function writeTile(
  data: Float32Array,
  width: number,
  height: number,
  tile: ResourceTile,
  tuning: TileNormalization,
): void {
  const { tileX: x, tileZ: z } = tile;
  if (x < 0 || x >= width || z < 0 || z >= height) return;
  const index = (z * width + x) * 4;
  data[index] = clamp01(tile.light / tuning.tileLightBase);
  data[index + 1] = clamp01(tile.moisture / tuning.maxMoisture);
  data[index + 2] = clamp01(tile.minerals / tuning.maxMinerals);
  data[index + 3] = 0;
}

export interface ResourceGrid {
  /** Replace the whole grid. */
  setFull(tiles: ResourceTile[], width: number, height: number, tileSize: number): void;
  /** Update only the tiles that changed. */
  updateDirty(tiles: ResourceTile[]): void;
  /** Replace the grid from a base64 buffer of 3 bytes per tile. */
  setQuantized(base64: string, width: number, height: number, tileSize: number): void;
}

/**
 * @param getShader reads the live ground shader; it only exists after three.js
 *   has compiled the patched material, so it is looked up on demand.
 */
export function createResourceGrid(
  getShader: () => GroundShaderUniforms | undefined,
  tuning: TileNormalization = DEFAULT_TILE_NORMALIZATION,
): ResourceGrid {
  let texture: THREE.DataTexture | null = null;
  let width = 0;
  let height = 0;

  function allocate(data: Float32Array, w: number, h: number): THREE.DataTexture {
    const created = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    // Tiles continue around the planet: the soil shader samples the grid in
    // surface (arc-length) coordinates, so UVs leave 0..1 away from the pole.
    created.wrapS = THREE.RepeatWrapping;
    created.wrapT = THREE.RepeatWrapping;
    created.minFilter = THREE.LinearFilter;
    created.magFilter = THREE.LinearFilter;
    texture = created;
    width = w;
    height = h;
    return created;
  }

  function bind(target: THREE.DataTexture, w: number, h: number, tileSize: number): void {
    const uniforms = getShader()?.uniforms;
    if (!uniforms) return;
    uniforms.uResourceGrid = { value: target };
    uniforms.uResourceGridSize = { value: new THREE.Vector2(w, h) };
    uniforms.uTileSize = { value: tileSize };
    uniforms.uResourceGridAvailable = { value: 1.0 };
  }

  return {
    setFull(tiles, w, h, tileSize) {
      const existing = texture?.image?.data as Float32Array | undefined;
      const canReuse =
        existing instanceof Float32Array &&
        existing.length === w * h * 4 &&
        width === w &&
        height === h;

      const data = canReuse ? existing : new Float32Array(w * h * 4);
      if (canReuse) data.fill(0);
      for (const tile of tiles) writeTile(data, w, h, tile, tuning);

      const target = canReuse && texture ? texture : allocate(data, w, h);
      target.needsUpdate = true;
      bind(target, w, h, tileSize);
    },

    updateDirty(tiles) {
      if (!texture) return;
      const data = texture.image.data as Float32Array;
      if (!(data instanceof Float32Array)) return;
      for (const tile of tiles) writeTile(data, width, height, tile, tuning);
      texture.needsUpdate = true;
    },

    setQuantized(base64, w, h, tileSize) {
      const binary = atob(base64);
      const expected = w * h * 3;
      if (binary.length < expected) return;

      let target = texture;
      let data = target?.image?.data as Float32Array | undefined;
      const matches =
        data instanceof Float32Array && data.length >= w * h * 4 && width === w && height === h;
      if (!matches || !target) {
        data = new Float32Array(w * h * 4);
        target = allocate(data, w, h);
        bind(target, w, h, tileSize);
      }
      if (!target || !data) return;

      for (let i = 0, j = 0; i < expected; i += 3, j += 4) {
        data[j] = binary.charCodeAt(i) / 255;
        data[j + 1] = binary.charCodeAt(i + 1) / 255;
        data[j + 2] = binary.charCodeAt(i + 2) / 255;
      }
      target.needsUpdate = true;
    },
  };
}
