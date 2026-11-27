/**
 * Name tags above other plants, so a field of specimens can be read at a glance.
 *
 * Mutations are expressed in the body (colour, thorns, petals, glow), but a
 * wall of plants grown for testing all looks similar until each one says what
 * it is. Each tag is a sprite with a canvas texture: cheap, always camera-facing
 * and readable through foliage because it ignores depth. Tags belong to the
 * scene, not to a plant renderer, so a plant can be removed without leaving a
 * label floating over the ground.
 *
 * A tag is a thing standing over a plant, not a HUD caption pinned to the glass:
 * its screen size follows the distance curve in `render/tagScale.ts`, so a rival
 * across the field is quieter than one at arm's length while still legible. The
 * texture is drawn at the display's own density, so a tag is not blurred by a
 * 2x screen before it is scaled at all.
 */
import * as THREE from 'three';

import { tagTextPx } from '../render/tagScale.ts';

export interface PlantLabelLayer {
  /** Create or update a plant's tag. An empty label removes it. */
  setLabel(plantId: string, text: string): void;
  /** Move a tag, in world space, above the plant's head. */
  place(plantId: string, x: number, y: number, z: number): void;
  /**
   * Size a tag for its distance from the camera. `metresPerPixel` is the world
   * size of one CSS pixel at that distance. Returns the tag's world height, so
   * the caller can stand it on top of the plant instead of through it.
   */
  sizeLabel(plantId: string, metresPerPixel: number, distanceM: number): number;
  remove(plantId: string): void;
  clear(): void;
  /** Number of tags currently drawn (dev diagnostics). */
  count(): number;
}

interface LabelEntry {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  text: string;
  /** The canvas's em size in canvas pixels: baseline times device density. */
  fontPx: number;
}

/**
 * The authored em size, in CSS pixels at density 1. The canvas is drawn at this
 * size times the device's pixel ratio, so the glyphs have real texels at 2x
 * instead of being upscaled from a 78 px raster.
 */
const TEXT_BASELINE_PX = 78;
// Only enough room for the shadow to fall. The plate is gone (see `paintLabel`),
// so the old 34 px of capsule margin would be a border of empty texture.
const TEXT_PADDING_PX = 10;
const MAX_CHARS = 30;

/** The display density the tag texture is drawn at, capped like the renderer's. */
function labelPixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const raw = window.devicePixelRatio;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(2, Math.max(1, raw));
}

/** Draw one tag into a canvas sized to the plate, truncated with an ellipsis. */
function paintLabel(
  canvas: HTMLCanvasElement,
  text: string,
  fontPx: number,
  paddingPx: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let shown = text;
  if (shown.length > MAX_CHARS) shown = `${shown.slice(0, MAX_CHARS - 1)}…`;
  const font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.font = font;
  const textWidth = ctx.measureText(shown).width;
  // Resizing resets the context state (font, fill styles), so it happens before
  // anything is drawn and the font is set again afterwards.
  const width = Math.max(2, Math.ceil(textWidth + paddingPx * 2));
  const height = fontPx + paddingPx;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  if (!text) return;

  ctx.font = font;
  // A name, not a capsule: no plate, no outline, no status dot. On a small tag the
  // plate was most of what was on screen, and a rounded box with a border fights
  // the sky, the soil and the plant all at once. The shadow is the whole of its
  // contrast budget and is enough over all three.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(4, 10, 8, 0.72)';
  ctx.shadowBlur = 7 * (fontPx / TEXT_BASELINE_PX);
  ctx.shadowOffsetY = 1.5 * (fontPx / TEXT_BASELINE_PX);
  ctx.fillStyle = 'rgba(243, 250, 236, 0.94)';
  ctx.fillText(shown, width / 2, height / 2 + 3 * (fontPx / TEXT_BASELINE_PX));
  // The context is reused for the next repaint; a shadow left set would draw a
  // second, offset copy of the name.
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

export function createPlantLabelLayer(scene: THREE.Scene): PlantLabelLayer {
  const labels = new Map<string, LabelEntry>();
  const ratio = labelPixelRatio();
  const fontPx = TEXT_BASELINE_PX * ratio;
  const paddingPx = TEXT_PADDING_PX * ratio;

  const remove = (plantId: string): void => {
    const entry = labels.get(plantId);
    if (!entry) return;
    scene.remove(entry.sprite);
    entry.sprite.material.dispose();
    entry.texture.dispose();
    labels.delete(plantId);
  };

  return {
    setLabel(plantId: string, text: string): void {
      if (!text) {
        remove(plantId);
        return;
      }
      const existing = labels.get(plantId);
      if (existing) {
        if (existing.text === text) return;
        existing.text = text;
        paintLabel(existing.canvas, text, existing.fontPx, paddingPx);
        existing.texture.needsUpdate = true;
        return;
      }
      const canvas = document.createElement('canvas');
      paintLabel(canvas, text, fontPx, paddingPx);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      // Mipmaps keep the tag legible instead of shimmering when it is far away;
      // anisotropy keeps it sharp at the shallow angle these tags are viewed at.
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 8;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        // Readable through leaves and stems: the point of the tag is to identify
        // the plant, so hiding it behind its own canopy defeats it.
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = `plant-label:${plantId}`;
      // A placeholder until the first `sizeLabel`: the plate's own aspect, one
      // metre of text by default.
      sprite.scale.set(canvas.width / fontPx, canvas.height / fontPx, 1);
      sprite.renderOrder = 60;
      sprite.visible = false;
      scene.add(sprite);
      labels.set(plantId, { sprite, texture, canvas, text, fontPx });
    },

    place(plantId: string, x: number, y: number, z: number): void {
      const entry = labels.get(plantId);
      if (!entry) return;
      entry.sprite.position.set(x, y, z);
      entry.sprite.visible = true;
    },

    sizeLabel(plantId: string, metresPerPixel: number, distanceM: number): number {
      const entry = labels.get(plantId);
      if (!entry) return 0;
      if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return 0;
      // The tag's text height on screen follows the distance curve, and the
      // canvas is `fontPx` tall for one line plus padding - so one ratio converts
      // a screen height into the sprite's world size. The ratio uses the canvas's
      // own em size, not the baseline, because the raster is density-scaled but
      // the world size must not be.
      const textPx = tagTextPx(distanceM);
      const metresPerCanvasPixel = (textPx / entry.fontPx) * metresPerPixel;
      const width = entry.canvas.width * metresPerCanvasPixel;
      const height = entry.canvas.height * metresPerCanvasPixel;
      entry.sprite.scale.set(width, height, 1);
      return height;
    },

    remove,
    clear(): void {
      for (const id of Array.from(labels.keys())) remove(id);
    },
    count: () => labels.size,
  };
}
