/**
 * Framing and measurement for the dev-only head capture.
 *
 * The in-game captures cannot be measured: a spore sac sits
 * about fifteen brightness levels above the ground behind it, so every
 * threshold tried over those frames either swallowed the hillside or found
 * nothing. The capture in `main.ts` draws one head alone on a flat background
 * instead, and this module holds the parts of it that can be reasoned about
 * without a canvas - where to put the camera, and how to read extents out of
 * pixels - so they are tested rather than checked by eye.
 */

/** Room left around the head in the capture, as a multiple of its own half-size. */
export const HEAD_CAPTURE_MARGIN = 1.15;

/**
 * A pixel is head when its brightness clears this. The capture draws the head
 * flat white on black, so the cut sits at the midpoint of the two and nothing
 * ambient decides the answer.
 */
export const HEAD_CAPTURE_THRESHOLD = 128;

/** Side of the square capture, in pixels. */
export const HEAD_CAPTURE_SIZE = 512;

/**
 * Half-height of the capture's view, in metres: the head's own half-size plus
 * the margin. Both states are captured through one frame, so the numbers from
 * one are directly comparable with the other.
 */
export function captureHalfExtent(
  halfWidthM: number,
  halfHeightM: number,
  margin: number = HEAD_CAPTURE_MARGIN,
): number {
  const half = Math.max(Math.abs(halfWidthM), Math.abs(halfHeightM));
  if (!Number.isFinite(half) || half <= 0) {
    throw new Error(`capture frame needs a drawn head, got half-extent ${half}`);
  }
  if (!Number.isFinite(margin) || margin < 1) {
    throw new Error(`capture margin must leave the head room to fit, got ${margin}`);
  }
  return half * margin;
}

/** The lit part of a capture frame: its box, in pixels from the frame's origin. */
export interface SilhouetteExtents {
  /** Leftmost lit column. */
  left: number;
  /** Topmost lit row. */
  top: number;
  /** How many columns the silhouette spans. */
  width: number;
  /** How many rows the silhouette spans. */
  height: number;
  /** Lit pixel count, so a stray speck cannot pass as the head. */
  pixels: number;
}

/**
 * Measured extents of the lit silhouette in one capture frame.
 *
 * Returns null when nothing clears the threshold: an empty frame is a failed
 * capture, not a head of size zero, and the caller says so.
 */
export function measureSilhouette(
  luma: readonly number[],
  width: number,
  height: number,
  threshold: number = HEAD_CAPTURE_THRESHOLD,
): SilhouetteExtents | null {
  if (luma.length !== width * height) {
    throw new Error(`frame is ${luma.length} samples, not ${width}x${height}`);
  }
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (luma[y * width + x] < threshold) continue;
      pixels++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (pixels === 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1, pixels };
}

/** Metres per pixel in a capture: the frame spans twice the half-extent. */
export function metresPerPixel(halfExtentM: number, size: number = HEAD_CAPTURE_SIZE): number {
  if (!(halfExtentM > 0)) throw new Error(`capture needs a view half-extent, got ${halfExtentM}`);
  if (!(size > 0)) throw new Error(`capture needs a frame size, got ${size}`);
  return (2 * halfExtentM) / size;
}

/**
 * Where the captured head came from.
 *
 * `planted` is a head the plant is actually drawing; `specimen` is the builder's
 * default stand-in, used when nothing of that organ is planted. The fallback is
 * how a wrong measurement reached the doc once: the capture answered happily on
 * a page with no plant, and nothing in the numbers said which head they were
 * about. Every report now carries this, and a specimen capture says it aloud.
 */
export type HeadCaptureSource = 'planted' | 'specimen';

/**
 * What to warn about after a capture, or null when there is nothing to say.
 *
 * A specimen capture is still a valid measurement of the rule, but it is not a
 * measurement of the plant, so it must not pass as one.
 */
export function headCaptureNotice(source: HeadCaptureSource, nodeType: string): string | null {
  if (source === 'planted') return null;
  return (
    `${nodeType} capture measured the fallback specimen, not a planted head: ` +
    'these pixels describe the builder, not the head in the plant'
  );
}

/** One measured head, as the dev capture reports it. */
export interface HeadCaptureReport {
  nodeType: string;
  /** A planted head, or the fallback specimen standing in for one. */
  source: HeadCaptureSource;
  progress: number;
  /** The emergence scales the capture drew the head with. */
  spread: number;
  alongStem: number;
  /** The view's half-height in metres, shared by every state of this head. */
  halfExtentM: number;
  metresPerPixel: number;
  /** Measured silhouette width and height, in pixels of the capture frame. */
  widthPx: number;
  heightPx: number;
  pixels: number;
  /** The capture itself, as a PNG data URL. */
  dataUrl: string;
}
