/**
 * Name tags above other plants, so a field of specimens can be read at a glance.
 *
 * Mutations are expressed in the body (colour, thorns, petals, glow), but a
 * wall of plants grown for testing all looks similar until each one says what
 * it is. Each tag is a sprite with a canvas texture: cheap, always camera-facing
 * and readable through foliage because it ignores depth. Tags belong to the
 * scene, not to a plant renderer, so a plant can be removed without leaving a
 * label floating over the ground.
 */
import * as THREE from 'three';

export interface PlantLabelLayer {
  /** Create or update a plant's tag. An empty label removes it. */
  setLabel(plantId: string, text: string): void;
  /** Move a tag, in world space, above the plant's head. */
  place(plantId: string, x: number, y: number, z: number): void;
  /**
   * Size a tag so its text is {@link TARGET_TEXT_PX} tall on screen, wherever the
   * camera is. Returns the tag's world height, so the caller can stand it on top
   * of the plant instead of through it.
   */
  sizeLabel(plantId: string, metresPerPixel: number): number;
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
}

// The plate is drawn at the canvas's own size - the transparent margins the old
// fixed 1024 px canvas carried are gone - so every texel belongs to a glyph or
// its border. The sprite is then sized from the distance to keep the text at
// TARGET_TEXT_PX, which is what makes a tag readable at 30 m and does not fill
// the view at 3 m.
const FONT_PX = 78;
const TEXT_PADDING_PX = 34;
const MAX_CHARS = 30;
/**
 * Height of the tag's text on screen, in CSS pixels. 22 was legible but a row of
 * tags at 25 m filled the top of the frame and overlapped each other.
 */
const TARGET_TEXT_PX = 15;

/** Draw one tag into a canvas sized to the plate, truncated with an ellipsis. */
function paintLabel(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let shown = text;
  if (shown.length > MAX_CHARS) shown = `${shown.slice(0, MAX_CHARS - 1)}…`;
  const font = `600 ${FONT_PX}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.font = font;
  const textWidth = ctx.measureText(shown).width;
  // Resizing resets the context state (font, fill styles), so it happens before
  // anything is drawn and the font is set again afterwards.
  const width = Math.max(2, Math.ceil(textWidth + TEXT_PADDING_PX * 2));
  const height = FONT_PX + TEXT_PADDING_PX;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  if (!text) return;

  ctx.font = font;
  ctx.fillStyle = 'rgba(8, 16, 12, 0.82)';
  ctx.strokeStyle = 'rgba(156, 222, 126, 0.95)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(3, 3, width - 6, height - 6, height / 2 - 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f2fbec';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, width / 2, height / 2 + 3);
}

export function createPlantLabelLayer(scene: THREE.Scene): PlantLabelLayer {
  const labels = new Map<string, LabelEntry>();

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
        paintLabel(existing.canvas, text);
        existing.texture.needsUpdate = true;
        return;
      }
      const canvas = document.createElement('canvas');
      paintLabel(canvas, text);
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
      sprite.scale.set(canvas.width / FONT_PX, canvas.height / FONT_PX, 1);
      sprite.renderOrder = 60;
      sprite.visible = false;
      scene.add(sprite);
      labels.set(plantId, { sprite, texture, canvas, text });
    },

    place(plantId: string, x: number, y: number, z: number): void {
      const entry = labels.get(plantId);
      if (!entry) return;
      entry.sprite.position.set(x, y, z);
      entry.sprite.visible = true;
    },

    sizeLabel(plantId: string, metresPerPixel: number): number {
      const entry = labels.get(plantId);
      if (!entry) return 0;
      if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return 0;
      // The canvas is FONT_PX tall for one line of text plus padding, so scaling
      // by TARGET_TEXT_PX / FONT_PX makes the glyphs exactly that many screen
      // pixels whatever the tag's distance or the canvas's width.
      const metresPerCanvasPixel = (TARGET_TEXT_PX / FONT_PX) * metresPerPixel;
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
