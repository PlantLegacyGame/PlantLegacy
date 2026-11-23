/**
 * Where the sun and the moon are drawn, as arithmetic.
 *
 * A body is placed twice: `setCelestial` writes the *layout* (a percentage of the
 * sky's arc, quantised so it is not a layout pass every frame), and
 * `setCelestialSmooth` writes a translate that carries the disc from that step to
 * where the body actually is. The two only agree when the layout has already run
 * for the frame: reading the drawn step, then changing it, leaves one step's
 * worth of offset applied twice - the disc jumps forwards and is pulled back on
 * the next frame, which is the jerk the plan's item 1 describes.
 *
 * Keeping the geometry here makes that ordering a test rather than a comment.
 */

export interface ArcBox {
  /** The arc's laid-out width, in CSS pixels. */
  w: number;
  /** The arc's laid-out height, in CSS pixels. */
  h: number;
  /** Half a disc plus air: the CSS `left` clamp resolves in these pixels. */
  clamp: number;
}

export interface OrbBody {
  x: number;
  y: number;
}

/** The arc starts and ends this far in from the edges of its own box, in %. */
export const ARC_INSET_MIN_PCT = 5;
export const ARC_INSET_SPAN_PCT = 90;
/** Layout quantisation: a quarter of a percent of the arc, about two pixels. */
export const ARC_INSET_STEPS = 4;
export const ARC_HEIGHT_STEPS = 400;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function arcInset(x: number): number {
  return ARC_INSET_MIN_PCT + clamp01(x) * ARC_INSET_SPAN_PCT;
}

export function arcHeight(y: number): number {
  return clamp01(y);
}

function quantise(value: number, steps: number): number {
  return Math.round(value * steps) / steps;
}

export function quantArcInset(x: number): number {
  return quantise(arcInset(x), ARC_INSET_STEPS);
}

export function quantArcHeight(y: number): number {
  return quantise(arcHeight(y), ARC_HEIGHT_STEPS);
}

/**
 * A percentage of the arc, in pixels, in the clamped space the CSS uses. The
 * clamp is the disc's own radius plus a little air: a body rising out of the
 * clamp has to be measured in the same space or it lands a few pixels off the
 * arc and jumps as it clears it.
 */
export function arcPixel(pct: number, box: ArcBox): number {
  return Math.min(box.w - box.clamp, Math.max(box.clamp, (pct / 100) * box.w));
}

/**
 * The translate that carries a disc from the step it is laid out at to where its
 * body is now. Both terms are percentages of the same box, so the offset needs no
 * pane, no zoom and no cached baseline.
 */
export function smoothOrbOffset(
  laidOutInsetPct: number,
  laidOutHeightPct: number,
  body: OrbBody,
  box: ArcBox,
): { dx: number; dy: number } {
  return {
    dx: arcPixel(arcInset(body.x), box) - arcPixel(laidOutInsetPct, box),
    dy: -(arcHeight(body.y) - laidOutHeightPct) * box.h,
  };
}

/**
 * The disc's screen position from its layout alone. `y` is measured downwards
 * from the arc's top (the CSS `top` is `(1 - height) * 100%`), which is the same
 * direction the smooth translate's `dy` is applied in.
 */
export function orbScreenPx(
  laidOutInsetPct: number,
  laidOutHeightPct: number,
  box: ArcBox,
): { x: number; y: number } {
  return { x: arcPixel(laidOutInsetPct, box), y: (1 - laidOutHeightPct) * box.h };
}
