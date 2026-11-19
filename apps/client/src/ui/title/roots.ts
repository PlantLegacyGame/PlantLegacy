/**
 * The underground half of the title plant.
 *
 * The title ground is a cut slice, so the soil has a cross-section: a plant with
 * its roots hidden is a decal on a brown rectangle. This is that cross-section,
 * drawn on its own 200x58 grid whose `y=0` is the soil line, so the shoot's box
 * stays exactly where the layout expects it and the roots simply hang below.
 *
 * Three decisions do all the work:
 *
 * 1. A root is a *filled tapered shape*, not a constant-width stroke. A stroked
 *    line has the same weight at its tip as at its junction, which reads as a pile
 *    of bones; a root narrows from a belly to a point.
 * 2. A branch starts *inside* its parent and is painted before it, so the parent
 *    covers the blunt start. A fork is then one root dividing instead of two
 *    sticks meeting at a corner. `roots.test.ts` pins this, because it is a
 *    property of the numbers, not of the drawing code.
 * 3. There is no shadow on the ground. The stage is a flat cutout and has no plane
 *    to throw one onto, so nothing here is blurred, offset or cast: depth comes
 *    from the roots fading as they go down and from a contact ink under each one.
 *
 * Spines are cubics on purpose. Straight ones, or ones whose control points sit on
 * the chord, read as a shelf of beams; every spine here sags away from its chord.
 */

/** Where a root leaves its parent and where it ends, as one cubic. */
export interface RootSpine {
  /** Named so a hair can be attached to it by name rather than by index. */
  id: string;
  /** Start, two controls, tip. */
  p: [number, number, number, number, number, number, number, number];
  /** Width where it leaves its parent, and at its tip. */
  w: number;
  tip: number;
  /** 1 a main root, 2 a feeder. */
  gen: 1 | 2;
  /** The stem's continuation: bark at the surface, fading into root below. */
  bark?: boolean;
  /** Taper exponent. The trunk needs a hard neck; a lateral does not. */
  taper?: number;
}

export const ROOT_SPINES: RootSpine[] = [
  // The stem itself, continuing into the soil. It is as wide as the stem at the
  // soil line, so the two are one object: no collar, no flare, no step. It necks
  // down hard, because a stem that stays 11 wide for a third of its length is a
  // pipe - and that neck is what made the first version read as a flange.
  {
    id: 'taproot',
    p: [100, 0, 100, 18, 95, 38, 101, 55],
    w: 11,
    tip: 0.6,
    gen: 1,
    taper: 1.9,
    bark: true,
  },
  // Left, shallow: level at the crown and late to turn down. The flat start is the
  // point - a lateral roots outward before it dives, and controls on the chord
  // made it a beam.
  { id: 'left', p: [99.8, 12, 93, 20, 68, 24, 46, 29], w: 4.2, tip: 0.6, gen: 1 },
  // Forks start on the parent's centre line, sized from the parent's width there,
  // so the parent covers the blunt start and the join is one root dividing.
  { id: 'leftFork', p: [83.2, 20.3, 76, 26, 66, 32, 56, 35], w: 2.4, tip: 0.4, gen: 2 },
  { id: 'leftTip', p: [46, 29, 39, 31, 33, 36, 28, 45], w: 1.6, tip: 0.35, gen: 2 },
  // Right, shallow and far: the widest reach belongs to one root, not to all.
  { id: 'right', p: [99.9, 16, 108, 22, 140, 21, 169, 29], w: 4, tip: 0.55, gen: 1 },
  { id: 'rightFork', p: [122.9, 21.3, 130, 27, 136, 33, 140, 40], w: 2.2, tip: 0.4, gen: 2 },
  { id: 'rightForkB', p: [147.1, 24.4, 152, 30, 155, 36, 156, 43], w: 1.2, tip: 0.3, gen: 2 },
  { id: 'rightTip', p: [169, 29, 177, 32, 182, 37, 184, 44], w: 1.4, tip: 0.3, gen: 2 },
  // Left, steep: drops close to the taproot, so the plate is not an even fan.
  { id: 'leftDeep', p: [99.1, 23, 95, 33, 85, 40, 79, 55], w: 3.4, tip: 0.45, gen: 1 },
  { id: 'leftDeepTip', p: [89.8, 37.1, 86, 42, 83, 48, 81, 55], w: 1.6, tip: 0.3, gen: 2 },
  // Right, deep.
  { id: 'rightDeep', p: [98.6, 30, 104, 37, 126, 41, 132, 56], w: 2.8, tip: 0.45, gen: 1 },
  { id: 'rightDeepTip', p: [115.1, 40, 112, 44, 112, 50, 107, 56], w: 1.5, tip: 0.3, gen: 2 },
  // Curving back under the crown: a root plate has roots pointing toward the
  // viewer's side too, not just left and right.
  { id: 'back', p: [100, 9, 93, 9, 87, 13, 80, 20], w: 2.8, tip: 0.4, gen: 1 },
  { id: 'backTip', p: [80, 20, 76, 22, 76, 27, 74, 32], w: 1.2, tip: 0.3, gen: 2 },
];

/**
 * Root hairs, attached by root name and position along it.
 *
 * They are computed from the spine rather than typed as free paths: hand-placed
 * hairs drifted off the roots and read as ticks floating in the dirt.
 */
export interface RootHair {
  root: string;
  /** 0 at the junction, 1 at the tip. */
  t: number;
  /** Which side of the root it leaves from. */
  side: 1 | -1;
  len: number;
}

export const ROOT_HAIRS: RootHair[] = [
  { root: 'left', t: 0.2, side: -1, len: 5 },
  { root: 'left', t: 0.34, side: 1, len: 4.2 },
  { root: 'left', t: 0.56, side: -1, len: 4.6 },
  { root: 'left', t: 0.7, side: 1, len: 3.8 },
  { root: 'leftFork', t: 0.4, side: 1, len: 3.6 },
  { root: 'leftFork', t: 0.68, side: -1, len: 3.2 },
  { root: 'leftTip', t: 0.34, side: 1, len: 3.4 },
  { root: 'leftTip', t: 0.62, side: -1, len: 3.2 },
  { root: 'right', t: 0.18, side: 1, len: 4.8 },
  { root: 'right', t: 0.38, side: -1, len: 4.2 },
  { root: 'right', t: 0.6, side: 1, len: 4.4 },
  { root: 'rightFork', t: 0.44, side: 1, len: 3.4 },
  { root: 'rightTip', t: 0.4, side: -1, len: 3.2 },
  { root: 'leftDeep', t: 0.3, side: -1, len: 4 },
  { root: 'leftDeep', t: 0.58, side: 1, len: 3.6 },
  { root: 'rightDeep', t: 0.36, side: 1, len: 3.8 },
  { root: 'rightDeep', t: 0.62, side: -1, len: 3.4 },
  { root: 'taproot', t: 0.55, side: 1, len: 3 },
  { root: 'taproot', t: 0.74, side: -1, len: 2.8 },
  { root: 'back', t: 0.5, side: -1, len: 3.2 },
];

/** One point on a spine, with the frame a hair needs and the half-width there. */
export interface SpineSample {
  x: number;
  y: number;
  /** Unit tangent, in the direction the root grows. */
  tx: number;
  ty: number;
  /** Unit normal. */
  nx: number;
  ny: number;
  half: number;
}

/** Default taper. Above 1 a root necks down just under its parent; below, it flares. */
const TAPER = 1.15;

/** Half-width at `t`: full at the junction, a point at the tip. */
function halfWidth(spine: RootSpine, t: number, pad: number): number {
  return (spine.w * (1 - t) ** (spine.taper ?? TAPER) + spine.tip * t + pad) / 2;
}

export function sampleSpine(spine: RootSpine, t: number, pad = 0): SpineSample {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = spine.p;
  const u = 1 - t;
  const x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3;
  const y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
  const dx = 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2);
  const dy = 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2);
  const len = Math.hypot(dx, dy) || 1;
  return {
    x,
    y,
    tx: dx / len,
    ty: dy / len,
    nx: -dy / len,
    ny: dx / len,
    half: halfWidth(spine, t, pad),
  };
}

const SAMPLES = 14;

/**
 * The outline of one root: its cubic sampled across its length and offset either
 * side by a half-width that tapers to a point. `pad` thickens the same shape for
 * the contact ink, so ink and body are one drawing at two sizes.
 */
export function spineOutline(spine: RootSpine, pad = 0): string {
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const s = sampleSpine(spine, i / SAMPLES, pad);
    left.push(`${(s.x + s.nx * s.half).toFixed(2)} ${(s.y + s.ny * s.half).toFixed(2)}`);
    right.push(`${(s.x - s.nx * s.half).toFixed(2)} ${(s.y - s.ny * s.half).toFixed(2)}`);
  }
  return `M${left[0]} L${left.slice(1).join(' L')} L${right.reverse().join(' L')} Z`;
}

/** How far inside the flank a hair starts: it emerges from the root, not beside it. */
export const HAIR_INSET = 0.6;

/** A hair: out of the root's flank, then down its own length. */
export function hairPath(hair: RootHair): string {
  const spine = ROOT_SPINES.find((root) => root.id === hair.root);
  if (!spine) throw new Error(`root hair attached to unknown root: ${hair.root}`);
  const s = sampleSpine(spine, hair.t);
  // Start just inside the flank so the hair emerges from the root, not beside it.
  const sx = s.x + s.nx * hair.side * s.half * HAIR_INSET;
  const sy = s.y + s.ny * hair.side * s.half * HAIR_INSET;
  const out = hair.len * hair.side;
  // Always a little downward: soil hangs off a hair.
  const ex = sx + s.nx * out + s.tx * hair.len * 0.3;
  const ey = sy + s.ny * out + s.ty * hair.len * 0.3 + hair.len * 0.3;
  const cx = sx + s.nx * out * 0.65;
  const cy = sy + s.ny * out * 0.65 + hair.len * 0.3;
  const f = (n: number): string => n.toFixed(2);
  return `M${f(sx)} ${f(sy)} Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
}

function fillOf(spine: RootSpine): string {
  if (spine.bark) return 'url(#pl-root-bark)';
  if (spine.gen === 2) return 'var(--pl-root-tip, #cbb99b)';
  return 'var(--pl-root, #efe3cd)';
}

/** The roots, as one self-contained SVG that hangs below the shoot. */
export function rootsMarkup(): string {
  // Thinnest first, so every parent is painted over the branch it grew.
  const strands = [...ROOT_SPINES].sort((a, b) => a.w - b.w);
  const ink = strands
    .map((root) => `<path d="${spineOutline(root, 1.2)}" fill="var(--pl-root-ink, #1c1208)"/>`)
    .join('');
  const body = strands
    .map((root) => `<path d="${spineOutline(root)}" fill="${fillOf(root)}"/>`)
    .join('');
  const hairs = ROOT_HAIRS.map((hair) => `<path d="${hairPath(hair)}"/>`).join('');
  return `
    <svg class="pl-title-plant__roots" viewBox="0 0 200 58" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="pl-root-depth-ramp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="1"/>
          <stop offset="0.62" stop-color="#fff" stop-opacity="0.92"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0.5"/>
        </linearGradient>
        <mask id="pl-root-depth">
          <rect x="0" y="0" width="200" height="58" fill="url(#pl-root-depth-ramp)"/>
        </mask>
        {/* Bark at the soil line, root within a dozen units: one shape, so there is
            no collar to line up. */}
        <linearGradient id="pl-root-bark" gradientUnits="userSpaceOnUse"
                        x1="0" y1="0" x2="0" y2="58">
          <stop offset="0" stop-color="var(--pl-stem-dark, #46741f)"/>
          <stop offset="0.14" stop-color="var(--pl-stem-dark, #46741f)"/>
          <stop offset="0.3" stop-color="var(--pl-root, #efe3cd)"/>
        </linearGradient>
      </defs>
      <g mask="url(#pl-root-depth)">
        <g opacity="0.3">${ink}</g>
        ${body}
        <g fill="none" stroke="var(--pl-root-tip, #cbb99b)" stroke-opacity="0.5"
           stroke-width="1" stroke-linecap="round">${hairs}</g>
      </g>
    </svg>`;
}
