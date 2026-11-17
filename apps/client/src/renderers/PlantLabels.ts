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
  /** Resize a tag so it stays readable at its distance from the camera. */
  scaleLabel(plantId: string, width: number): void;
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

// 1024 px wide for a ~4 m sprite: at that ratio the text is roughly 200 px
// per metre, so it stays sharp when the tag is close to the camera. The old
// 640 px canvas was upscaled by the sprite and read as blurry pixels.
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 256;
const FONT_PX = 78;
const TEXT_PADDING_PX = 34;
const MAX_CHARS = 30;

/** Draw one tag, truncated with an ellipsis instead of shrinking. */
function paintLabel(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!text) return;

  let shown = text;
  if (shown.length > MAX_CHARS) shown = `${shown.slice(0, MAX_CHARS - 1)}…`;

  ctx.font = `600 ${FONT_PX}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const textWidth = ctx.measureText(shown).width;
  const width = Math.min(CANVAS_WIDTH - 8, textWidth + TEXT_PADDING_PX * 2);
  const height = FONT_PX + TEXT_PADDING_PX;
  const left = (CANVAS_WIDTH - width) / 2;
  const top = (CANVAS_HEIGHT - height) / 2;

  ctx.fillStyle = 'rgba(8, 16, 12, 0.82)';
  ctx.strokeStyle = 'rgba(156, 222, 126, 0.95)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 34);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f2fbec';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 3);
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
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
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
      // Aspect follows the canvas: 1024 x 256 is 4:1, and the transparent rows
      // above and below the plate keep the glyphs from being squashed.
      sprite.scale.set(4.6, 1.15, 1);
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

    scaleLabel(plantId: string, width: number): void {
      const entry = labels.get(plantId);
      if (!entry) return;
      entry.sprite.scale.set(width, width * 0.275, 1);
    },

    remove,
    clear(): void {
      for (const id of Array.from(labels.keys())) remove(id);
    },
    count: () => labels.size,
  };
}
