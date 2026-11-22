/**
 * The arc a bent stem makes.
 *
 * The mascot used to bend at two hinges: the lower band turned about the soil
 * line and the tip about the middle of the stem. That is a bent stick, not a bent
 * plant - the stem stayed a straight line and the joint read as a kink. A stem
 * under a load bends *along its length*: every point turns a little more than the
 * point below it, so the spine is an arc, the slope at the top is the angle you
 * dragged, and the leaves ride the curve.
 *
 * The curvature is not even along the stem. A rooted stem is stiff where it enters
 * the soil and does almost all of its bending above the middle; an even arc reads
 * as a bent wire, with the base already leaning when the drag starts. The tangent
 * therefore turns as `bend * (s/L)^1.2`: little at the foot, most of it near the
 * tip, which is also what brings the top of the plant down towards the ground
 * instead of swinging the whole stalk sideways.
 *
 * Length is preserved exactly (the spine is integrated along unit tangents), so
 * the plant does not stretch as it leans. Points are returned relative to the
 * stem's foot, in viewBox units, with `turnDeg` being how far the tangent has
 * turned from its rest heading - which is exactly the extra rotation a leaf
 * attached there takes.
 *
 * All of it is arithmetic, so the drawing can be tested without a browser.
 */

export interface BendPoint {
  /** Offset from the stem's foot, in viewBox units (positive is right). */
  x: number;
  /** Offset from the stem's foot, in viewBox units (negative is up). */
  y: number;
  /** How far the tangent has turned from vertical, degrees, same sign as the bend. */
  turnDeg: number;
}

/**
 * Heading of the stem at its foot in screen coordinates: straight up, y is down.
 * The mascot's art leans a few degrees left, so callers pass their own rest
 * heading; this is only the default.
 */
const UP_DEG = -90;

/**
 * How much of the bend happens near the tip: `turn = bend * t^CURVE_EXPONENT`.
 *
 * 1 would be an even arc. Higher puts the bend up the stem where a rooted plant
 * actually gives, and brings the canopy down towards the soil.
 */
const CURVE_EXPONENT = 1.2;

/** Steps used to integrate the spine. 48 is smooth to well under a pixel. */
const SPINE_STEPS = 48;

/**
 * The point at `t` along a stem of `length` bent by `bendDeg`.
 *
 * `t` is the fraction of the stem's arc length from the foot: 0 at the soil, 1 at
 * the tip. A bend of zero is a straight line, exactly, because the arc's radius
 * goes to infinity there.
 */
export function bendPoint(bendDeg: number, t: number, length: number, baseDeg = UP_DEG): BendPoint {
  const span = Number.isFinite(length) && length > 0 ? length : 1;
  const clampedT = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const s = clampedT * span;
  const angle = Number.isFinite(bendDeg) ? bendDeg : 0;
  const total = (angle * Math.PI) / 180;
  const theta0 = ((Number.isFinite(baseDeg) ? baseDeg : UP_DEG) * Math.PI) / 180;
  const turnDeg = angle * clampedT ** CURVE_EXPONENT;

  if (Math.abs(total) < 1e-9) {
    // An unbent plant is the art exactly, not the art plus a cosine of minus
    // ninety degrees: the sideways term is snapped away.
    const x = Math.cos(theta0) * s;
    return { x: Math.abs(x) < 1e-9 ? 0 : x, y: Math.sin(theta0) * s, turnDeg: 0 };
  }

  // Integrate along unit tangents, so arc length is exactly `length` however the
  // curvature is distributed.
  const steps = Math.max(1, Math.round(SPINE_STEPS * clampedT));
  const dt = clampedT / steps;
  let x = 0;
  let y = 0;
  for (let i = 0; i < steps; i += 1) {
    const midT = (i + 0.5) * dt;
    const theta = theta0 + total * midT ** CURVE_EXPONENT;
    const step = span * dt;
    x += Math.cos(theta) * step;
    y += Math.sin(theta) * step;
  }
  return { x: Math.abs(x) < 1e-9 ? 0 : x, y, turnDeg };
}

/** Where a point of the original straight drawing ends up, and how it is turned. */
export interface BendPlacement {
  /** How far to translate the part, in viewBox units. */
  dx: number;
  dy: number;
  turnDeg: number;
}

/**
 * Placement for a part drawn at `(x, y)` on the upright plant.
 *
 * The upright stem is treated as the arc-length parameterisation of the bend, so a
 * part keeps its distance up the stem instead of sliding along it.
 */
export function bendPlacement(
  bendDeg: number,
  y: number,
  baseY: number,
  length: number,
  baseDeg = UP_DEG,
): BendPlacement {
  const t = length > 0 ? (baseY - y) / length : 0;
  const point = bendPoint(bendDeg, t, length, baseDeg);
  const straight = bendPoint(0, t, length, baseDeg);
  return { dx: point.x - straight.x, dy: point.y - straight.y, turnDeg: point.turnDeg };
}

/** A smooth SVG path for the bent stem, through `samples` points of the arc. */
export function bendArcPath(
  bendDeg: number,
  length: number,
  baseX: number,
  baseY: number,
  samples = 14,
  shift = 0,
  baseDeg = UP_DEG,
): string {
  return bendArcSegment(bendDeg, length, baseX, baseY, 0, 1, samples, shift, baseDeg);
}

/**
 * The same arc, but only the part between two fractions of the stem.
 *
 * A tree trunk is the bottom of the same spine, not a second curve that could
 * drift away from it: the trunk and the green stem are two widths of one arc, so
 * they stay welded however far the plant is bent.
 */
export function bendArcSegment(
  bendDeg: number,
  length: number,
  baseX: number,
  baseY: number,
  fromT = 0,
  toT = 1,
  samples = 14,
  shift = 0,
  baseDeg = UP_DEG,
): string {
  const count = Math.max(1, Math.round(samples));
  const start = Math.max(0, Math.min(1, fromT));
  const end = Math.max(start, Math.min(1, toT));
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= count; i += 1) {
    const t = start + (end - start) * (i / count);
    const point = bendPoint(bendDeg, t, length, baseDeg);
    // The offset is perpendicular to the local tangent: that is how the highlight
    // and the compression shadow stay on their own side of the stem as it curves.
    const turn = (point.turnDeg * Math.PI) / 180;
    points.push({
      x: baseX + point.x + Math.cos(turn) * shift,
      y: baseY + point.y + Math.sin(turn) * shift,
    });
  }

  const n = (value: number): string => value.toFixed(2);
  let path = `M${n(points[0].x)} ${n(points[0].y)}`;
  // Quadratic through the midpoints: a polyline of 14 segments shows its corners
  // at this stroke width, and a full cubic spline is more machinery than a stem
  // needs.
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    path += ` Q${n(points[i].x)} ${n(points[i].y)} ${n(midX)} ${n(midY)}`;
  }
  const last = points[points.length - 1];
  path += ` L${n(last.x)} ${n(last.y)}`;
  return path;
}

/**
 * How strained the stem is at this bend, 0..1.
 *
 * Strain is not linear in angle: the first third of the bend is what a stem does
 * in a breeze, and the last third is what it does when it is about to give. The
 * square is what makes the creases and the thinning appear late and fast.
 */
export function bendTension(bendDeg: number, maxBendDeg: number): number {
  if (!(maxBendDeg > 0)) return 0;
  const fraction = Math.min(1, Math.abs(bendDeg) / maxBendDeg);
  return fraction * fraction;
}

/**
 * How thick an arm is where it leaves the trunk.
 *
 * Derived from the height it leaves at, never authored. Both sides of the tree at
 * the same height have to match, and an arm higher up can never be thicker than a
 * lower one. The authored widths broke both rules - an arm at t 0.46 was 16 units
 * where the one at t 0.42 on the other side was 15 - which is what made the crown
 * read as a bundle of sticks instead of a tree.
 *
 * `len` adds a little wood for a long arm, bounded to 0.8 units so it can never
 * outbid the height term (neighbouring arms differ by at least 0.04 in t, which is
 * worth 0.77 units).
 */
export function limbBaseWidth(t: number, len: number): number {
  const low = Math.max(0, Math.min(1, (t - 0.42) / 0.44));
  const reach = Math.max(0, Math.min(1, len / 100));
  return 16 - 8.5 * low + 0.8 * reach;
}
