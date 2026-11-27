/**
 * Pure geometry for the radial emote wheel.
 *
 * The wheel is eight (or N) equal sectors, sector 0 centred on the top and
 * increasing clockwise. Keeping the angle rules here means the SVG painter and
 * the pointer hit-test can never disagree about which wedge the mouse is in,
 * and the mapping is testable without a browser.
 *
 * Angles are radians, measured clockwise from straight up. Screen coordinates
 * have y growing downward, so a point at (dx, dy) relative to the wheel centre
 * is at atan2(dy, dx) + PI/2 in this system.
 */

export const TAU = Math.PI * 2;

export interface SectorAngles {
  /** Clockwise edge of the sector, radians from up. */
  start: number;
  /** Counter-clockwise edge of the sector, radians from up. */
  end: number;
  /** Centre line of the sector, radians from up. */
  mid: number;
}

/** Wrap an angle into [0, TAU). */
export function normalizeAngle(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/**
 * The sector under a pointer offset, or -1 inside the dead zone.
 *
 * `deadZonePx` is the centre button's radius: the mouse there is over the close
 * control, not over an emote. Outside the dead zone the pointer's direction is
 * all that matters, including when it is outside the drawn wheel, which is what
 * makes the wheel feel like Fortnite/GTA rather than a ring of buttons.
 */
export function sectorAtOffset(dx: number, dy: number, count: number, deadZonePx: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(count)) return -1;
  if (count <= 0) return -1;
  const distance = Math.hypot(dx, dy);
  if (distance <= Math.max(0, deadZonePx)) return -1;

  const clockwiseFromTop = normalizeAngle(Math.atan2(dy, dx) + Math.PI / 2);
  const sectorSize = TAU / count;
  // Add half a sector before flooring so a direction on a boundary belongs to
  // the sector it is entering clockwise, not the one it is leaving.
  return Math.floor((clockwiseFromTop + sectorSize / 2) / sectorSize) % count;
}

/** Start, end and centre angle for one sector. */
export function sectorAngles(index: number, count: number): SectorAngles {
  const safeCount = Math.max(1, Math.floor(count));
  const size = TAU / safeCount;
  const mid = normalizeAngle(index * size);
  return { start: mid - size / 2, end: mid + size / 2, mid };
}

/** Point on a circle at `radius`, `angle` clockwise from up. */
export function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: cx + Math.sin(angle) * radius,
    y: cy - Math.cos(angle) * radius,
  };
}

function fmt(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '');
}

/**
 * SVG path for an annular sector (the curved trapezoid between two radii).
 *
 * `gapRadians` is the total empty space between neighbouring wedges, split
 * evenly between the two edges. The wheel is small enough that every sector is
 * a minor arc, so the large-arc flag stays 0.
 */
export function annularSectorPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
  gapRadians = 0,
): string {
  const span = endAngle - startAngle;
  const inset = Math.min(Math.max(0, gapRadians) / 2, Math.max(0, span) / 2);
  const a0 = startAngle + inset;
  const a1 = endAngle - inset;
  const outerStart = polarPoint(cx, cy, outerRadius, a0);
  const outerEnd = polarPoint(cx, cy, outerRadius, a1);
  const innerEnd = polarPoint(cx, cy, innerRadius, a1);
  const innerStart = polarPoint(cx, cy, innerRadius, a0);
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;

  return [
    `M ${fmt(outerStart.x)} ${fmt(outerStart.y)}`,
    `A ${fmt(outerRadius)} ${fmt(outerRadius)} 0 ${largeArc} 1 ${fmt(outerEnd.x)} ${fmt(outerEnd.y)}`,
    `L ${fmt(innerEnd.x)} ${fmt(innerEnd.y)}`,
    `A ${fmt(innerRadius)} ${fmt(innerRadius)} 0 ${largeArc} 0 ${fmt(innerStart.x)} ${fmt(innerStart.y)}`,
    'Z',
  ].join(' ');
}

/** Where a sector's label sits: halfway along its centre line. */
export function sectorLabelPoint(
  cx: number,
  cy: number,
  radius: number,
  index: number,
  count: number,
): { x: number; y: number } {
  return polarPoint(cx, cy, radius, sectorAngles(index, count).mid);
}
