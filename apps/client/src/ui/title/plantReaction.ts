/**
 * What the title plant does when you touch it.
 *
 * The mascot used to have exactly one reaction: a click scaled the whole plant up
 * by 6% and back. Every part of a drawing that can be identified can answer for
 * itself, and the answer should be about the part you touched - a leaf flicks, the
 * stem moves the whole canopy, the bud nods, a root wiggles - and a drag on the
 * top bends the plant, which springs back and forth before it settles.
 *
 * All of it is arithmetic here: amplitudes, a damped swing, a bend clamp, and a
 * release that overshoots. The DOM only writes the numbers, so the feel can be
 * tested rather than eyeballed.
 */

export type PlantPart = 'leaf' | 'stem' | 'bud' | 'root';

/** How one touched part answers. */
export interface TapResponse {
  part: PlantPart;
  /** Degrees the part swings through at its first peak. */
  swingDeg: number;
  /** How long the reaction runs. */
  durationMs: number;
  /** Time for one full there-and-back, so a leaf shivers and the canopy sways. */
  periodMs: number;
}

const RESPONSES: Record<PlantPart, Omit<TapResponse, 'part'>> = {
  // A leaf is light: it flicks quickly and stops.
  leaf: { swingDeg: 9, durationMs: 900, periodMs: 240 },
  // The stem is the whole plant: slower, wider, and it carries the leaves.
  stem: { swingDeg: 2.6, durationMs: 1100, periodMs: 620 },
  // The bud is the newest growth: it nods, once.
  bud: { swingDeg: 6.5, durationMs: 700, periodMs: 300 },
  // Roots are underground and heavy: barely move, and slowly.
  root: { swingDeg: 1.8, durationMs: 820, periodMs: 460 },
};

export function tapResponse(part: PlantPart): TapResponse {
  // An unknown part is the plant itself, not a crash: the drawing can gain a part
  // this table has not learned yet and the tap should still answer.
  const known = Object.hasOwn(RESPONSES, part);
  const resolved: PlantPart = known ? part : 'stem';
  return { part: resolved, ...RESPONSES[resolved] };
}

/**
 * A damped swing: starts at rest, peaks early, alternates, and is exactly 0 once
 * the reaction is over. The exponent is what makes a leaf look light rather than
 * like a pendulum with a motor on it.
 */
export function swingAngle(tMs: number, response: TapResponse): number {
  if (!(tMs > 0) || tMs >= response.durationMs || response.periodMs <= 0) return 0;
  const t = tMs / response.durationMs;
  const decay = (1 - t) ** 2.2;
  const phase = (tMs / response.periodMs) * Math.PI * 2;
  return response.swingDeg * decay * Math.sin(phase);
}

/** Which way a leaf flicks: neighbours alternate so a tap never looks mechanical. */
export function leafSwingSign(index: number): number {
  return index % 2 === 1 ? 1 : -1;
}

/**
 * Largest bend a drag may produce, in degrees.
 *
 * 15 was a nod, 34 was a lean. With the stem drawn as an arc that bends mostly
 * above its stiff base (title/plantBend.ts), the gesture can carry a real pull:
 * 168 degrees folds the canopy right over until the top of the plant hangs beside
 * its own base, which is the limit of what reads as a stem bending rather than
 * snapping. The drawing has a gutter on each side (TitlePlant's viewBox) so
 * nothing is cut off on the way there, in either direction; the leaves keep their
 * own rotations bounded so the canopy stays attached to the spine as it folds.
 */
export const MAX_BEND_DEG = 168;

/**
 * Bend from a horizontal drag, in degrees, positive to the right.
 *
 * `spanPx` is how far the pointer travels for a full bend - half the plant's width,
 * so dragging from the middle to its edge is a full bend and no further.
 */
export function bendDegrees(dxPx: number, spanPx: number, maxDeg: number = MAX_BEND_DEG): number {
  const span = spanPx > 0 ? spanPx : 1;
  const dx = Number.isFinite(dxPx) ? dxPx : 0;
  const limit = Number.isFinite(maxDeg) ? Math.abs(maxDeg) : MAX_BEND_DEG;
  const raw = (dx / span) * limit;
  return Math.max(-limit, Math.min(limit, raw));
}

/**
 * Where the plant is, after letting go.
 *
 * A spring, not an ease: it passes through straight at speed, overshoots the other
 * way, and comes back smaller, which is what "springs back and forth until it
 * settles" means. Exactly 0 at the end, so nothing is left holding a transform.
 */
export function releaseAngle(tMs: number, fromDeg: number, settleMs = 1900): number {
  if (!Number.isFinite(fromDeg) || fromDeg === 0) return 0;
  if (!(tMs > 0)) return fromDeg;
  if (tMs >= settleMs || settleMs <= 0) return 0;
  const t = tMs / settleMs;
  const decay = (1 - t) ** 2.4;
  // One full there-and-back in about half a second: fast enough to read as a
  // spring, slow enough to see the second pass.
  const phase = (tMs / 470) * Math.PI * 2;
  return fromDeg * decay * Math.cos(phase);
}

/**
 * Which part of the drawing a pointer landed on, from the SVG's own annotations.
 * Falls back to the stem: a tap on the plant that misses the markup is still a tap
 * on the plant.
 */
export function partFromDataset(dataset: { part?: string; leaf?: string }): {
  part: PlantPart;
  index: number;
} {
  const raw = (dataset.part ?? '').toLowerCase();
  const part: PlantPart =
    raw === 'leaf' || raw === 'bud' || raw === 'root' || raw === 'stem' ? raw : 'stem';
  const index = Number.parseInt(dataset.leaf ?? '', 10);
  return { part, index: Number.isFinite(index) ? index : 0 };
}

/**
 * How far the plant leans toward a pointer that is over it, in degrees.
 *
 * A mascot that only answers when struck feels like a switch. This is the drawing
 * noticing where you are: the tip tips toward the cursor, by a few degrees, and
 * returns the moment the pointer leaves. It is a lean, not a highlight - nothing
 * changes colour and nothing is outlined, because the plant is a drawing and not a
 * control. Positive is clockwise, which is the direction of a lean to the right.
 */
export const MAX_LEAN_DEG = 3.2;

export function leanTowardPointer(
  pointerX: number,
  centerX: number,
  halfSpanPx: number,
  maxDeg = MAX_LEAN_DEG,
): number {
  if (!Number.isFinite(pointerX) || !Number.isFinite(centerX)) return 0;
  if (!Number.isFinite(halfSpanPx) || halfSpanPx <= 0) return 0;
  const reach = Math.max(1, halfSpanPx * 2);
  const t = Math.max(-1, Math.min(1, (pointerX - centerX) / reach));
  const cap = Number.isFinite(maxDeg) ? maxDeg : MAX_LEAN_DEG;
  return t * cap;
}

/** A gust arrives every 9-21 seconds, and lasts about two and a half. */
export const GUST_MIN_MS = 9000;
export const GUST_MAX_MS = 21000;
export const GUST_DURATION_MS = 2600;
export const GUST_PEAK_DEG = 2.4;

/** When the next gust should start, given when this one did. */
export function nextGustAt(nowMs: number, random: () => number = Math.random): number {
  const r = random();
  const unit = Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0.5;
  return nowMs + GUST_MIN_MS + unit * (GUST_MAX_MS - GUST_MIN_MS);
}

/**
 * The angle a gust adds to the canopy right now.
 *
 * It swells and eases: zero at both ends, so a gust begins and finishes without a
 * step, and it rocks twice on the way through rather than pushing once.
 */
export function gustAngle(
  nowMs: number,
  startMs: number,
  durationMs = GUST_DURATION_MS,
  peakDeg = GUST_PEAK_DEG,
): number {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : GUST_DURATION_MS;
  const elapsed = nowMs - startMs;
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= duration) return 0;
  const t = elapsed / duration;
  const peak = Number.isFinite(peakDeg) ? peakDeg : GUST_PEAK_DEG;
  return peak * Math.sin(Math.PI * t) * Math.cos(2 * Math.PI * t);
}
