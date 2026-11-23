/**
 * Title-screen parallax, as arithmetic.
 *
 * The scene is a stack of 2D cutouts. Dragging or moving the pointer slides them
 * by different amounts, so the flat art gains depth without a 3D camera. The
 * numbers here are the whole mechanism: clamp, choose a target, ease toward it.
 * Keeping it out of the DOM lets the feel be tested instead of eyeballed.
 */

export interface ParallaxPoint {
  x: number;
  y: number;
}

export interface ParallaxConfig {
  enabled: boolean;
  /** How far from centre the background may travel, in CSS pixels. */
  dragPx: number;
  /** Share of the pointer offset followed when nobody is dragging. */
  hover: number;
}

export const PARALLAX_ORIGIN: ParallaxPoint = { x: 0, y: 0 };

export function clampParallax(point: ParallaxPoint, dragPx: number): ParallaxPoint {
  const limit = Math.max(0, dragPx);
  return {
    x: Math.max(-limit, Math.min(limit, point.x)),
    y: Math.max(-limit, Math.min(limit, point.y)),
  };
}

/**
 * Where the scene should be heading. A drag in progress always wins: the pointer
 * is still holding the view, and letting hover fight it makes the drag feel loose.
 *
 * A released drag leaves the picture where it was let go (`rest`). It used to
 * return to the middle the moment the pointer lifted, and no pointer at all -
 * the pointer leaving the window - also meant the origin, so letting go of a drag
 * undid it. The rest offset is the drag's result; hover is a small spring added
 * on top of it, so moving the pointer still animates the scene without throwing
 * away the view the player chose. Only Space clears `rest`.
 */
export function parallaxTarget(
  draft: ParallaxPoint | null,
  pointer: ParallaxPoint | null,
  config: ParallaxConfig,
  rest: ParallaxPoint = PARALLAX_ORIGIN,
): ParallaxPoint {
  if (!config.enabled) return PARALLAX_ORIGIN;
  if (draft) return clampParallax(draft, config.dragPx);
  if (!pointer) return clampParallax(rest, config.dragPx);
  return clampParallax(
    { x: rest.x + pointer.x * config.hover, y: rest.y + pointer.y * config.hover },
    config.dragPx,
  );
}

/** Exponential ease: frame-rate independent, and never overshoots. */
export function stepParallax(
  current: ParallaxPoint,
  target: ParallaxPoint,
  dtMs: number,
  settleMs: number,
): ParallaxPoint {
  if (settleMs <= 0) return target;
  const t = 1 - Math.exp((-dtMs / settleMs) * 3);
  const k = Math.max(0, Math.min(1, t));
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
  };
}

/** One layer's offset. `depth` 0 is the far sky, 1 is the nearest cutout. */
export function layerOffset(state: ParallaxPoint, depth: number): ParallaxPoint {
  const d = Math.max(0, Math.min(1, depth));
  return { x: -state.x * d, y: -state.y * d * 0.5 };
}

export function parallaxAtRest(state: ParallaxPoint, epsilon = 0.05): boolean {
  return Math.abs(state.x) <= epsilon && Math.abs(state.y) <= epsilon;
}
