/**
 * The underground half of the title plant, generated.
 *
 * The title ground is a cut slice, so the soil has a cross-section: a plant with
 * its roots hidden is a decal on a brown rectangle. This module owns that
 * cross-section, on its own 200x58 grid whose `y=0` is the soil line, so the
 * shoot's box stays exactly where the layout expects it and the roots simply hang
 * below.
 *
 * It used to be a table of thirteen hand-typed cubics, which looked right and
 * could not grow: the only way to make the roots deeper was to scale the drawing,
 * and a scaled root is a longer, thinner root rather than a bigger one. The table
 * is a *builder* now. One seeded pass lays out a root collar with three laterals a
 * side, forks each lateral once, and hangs one short hair off the older roots.
 * Growth is a scale about the soil line, not a redraw: the same plate thickens and deepens
 * with care, and the seed is fixed so the drawing is the same on every boot.
 *
 * Four rules keep it from looking like a wire brush:
 *
 * 1. A root is a *filled tapered shape* (`spineOutline`), never a constant-width
 *    stroke. A stroke has the same weight at its tip as at its junction.
 * 2. A fork starts on its parent's centre line and is painted before it, so the
 *    parent covers the blunt start and a join is one root dividing.
 * 3. Every spine sags away from its own chord; controls on the chord read as
 *    beams.
 * 4. Nothing is blurred, offset or shadowed. The stage is a flat cutout with no
 *    plane to cast onto, so depth comes from the taper and the ink line.
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
  /** Taper exponent. A trunk needs a hard neck; a lateral does not. */
  taper?: number;
}

export const ROOT_GRID = { width: 200, height: 58 } as const;

/** A small integer hash, so the layout is chosen but not random per boot. */
function makeRng(seed: number): () => number {
  let state = (seed * 2654435761) % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

/** A cubic from a start point, along a heading, that arrives on another heading. */
function curve(
  sx: number,
  sy: number,
  angleDeg: number,
  length: number,
  arriveDeg: number,
  bow = 0,
): [number, number, number, number, number, number, number, number] {
  const a = (angleDeg * Math.PI) / 180;
  const b = (arriveDeg * Math.PI) / 180;
  const ex = sx + Math.cos(a) * length;
  const ey = sy + Math.sin(a) * length;
  // `bow` pushes both control points off the chord, which is what makes a root
  // leaving and arriving on nearly the same heading still sag like a root instead
  // of running dead straight. It is measured on the *chord's* normal and always
  // downward on screen: taking it from the average heading let a root heading left
  // cancel its own bow, and half the plate came out dead straight.
  const chordX = ex - sx;
  const chordY = ey - sy;
  const chordLen = Math.hypot(chordX, chordY) || 1;
  const downX = -chordY / chordLen;
  const downY = chordX / chordLen;
  const bowSign = downY < 0 ? -1 : 1;
  const bnx = downX * bowSign * bow;
  const bny = downY * bowSign * bow;
  // Long control arms, so even a short fork bows: a cubic whose controls sit a
  // third of the way along is nearly its own chord, and short roots came out as
  // straight sticks.
  const back = length * 0.5;
  return [
    sx,
    sy,
    sx + Math.cos(a) * back + bnx,
    sy + Math.sin(a) * back + bny,
    ex - Math.cos(b) * back + bnx,
    ey - Math.sin(b) * back + bny,
    ex,
    ey,
  ];
}

function cubicPoint(
  p: readonly number[],
  t: number,
): { x: number; y: number; tx: number; ty: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p as unknown as number[];
  const u = 1 - t;
  const x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3;
  const y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
  const dx = 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2);
  const dy = 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2);
  const len = Math.hypot(dx, dy) || 1;
  return { x, y, tx: dx / len, ty: dy / len };
}

/**
 * One spine shortened to `t` of its own length, by de Casteljau.
 *
 * This is how the roots grow: a growing root keeps its shape and gets longer, it
 * is not a smaller copy of the finished root. Truncating the cubic is exact - the
 * shortened segment lies on the original curve - so the plate only ever extends.
 */
export function truncateSpine(spine: RootSpine, t: number): RootSpine {
  const f = Math.max(0.001, Math.min(1, Number.isFinite(t) ? t : 1));
  if (f >= 1) return spine;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = spine.p;
  // The three de Casteljau stages, keeping the first half at each one.
  const ax = x0 + (x1 - x0) * f;
  const ay = y0 + (y1 - y0) * f;
  const bx = x1 + (x2 - x1) * f;
  const by = y1 + (y2 - y1) * f;
  const cx = x2 + (x3 - x2) * f;
  const cy = y2 + (y3 - y2) * f;
  const dx = ax + (bx - ax) * f;
  const dy = ay + (by - ay) * f;
  const ex = bx + (cx - bx) * f;
  const ey = by + (cy - by) * f;
  const gx = dx + (ex - dx) * f;
  const gy = dy + (ey - dy) * f;
  return { ...spine, p: [x0, y0, ax, ay, dx, dy, gx, gy] };
}

/** Shorten a spine until every part of its outline is inside the grid. */
function fitToGrid(spine: RootSpine): RootSpine {
  const fits = (candidate: RootSpine): boolean => {
    for (let i = 0; i <= 12; i += 1) {
      const s = sampleSpine(candidate, i / 12);
      for (const side of [1, -1]) {
        const x = s.x + s.nx * s.half * side;
        const y = s.y + s.ny * s.half * side;
        if (x < 0.5 || x > ROOT_GRID.width - 0.5) return false;
        if (y > ROOT_GRID.height - 0.5 || y < 0) return false;
      }
    }
    return true;
  };
  let result = spine;
  for (let i = 0; i < 24 && !fits(result); i += 1) {
    result = truncateSpine(result, 0.94);
  }
  return result;
}

/**
 * The root plate, as spines.
 *
 * Six laterals (three a side) leave the stem just under the soil line and reach
 * out at their own angles and depths; each one forks once at mid-length, and the
 * fork starts on the parent's centre line. Nothing here points at anything: the
 * plate is a fan of roots because roots fan, and the strands that reach a buried
 * find are drawn separately, in the ground's own space, by the menu.
 *
 * The remaster takes the brush out of the plate: the laterals are fewer and
 * heavier, the second-order tangle is gone, and the hairs are now one per older
 * root rather than two per spine. Measured at the ancient stage, the old plate
 * put two dozen pale strokes under a 17-unit trunk and read as a wire frame; the
 * new one keeps the same reach with twelve bodies and six hairs.
 */
export function buildRoots(seed = 7): RootSpine[] {
  const rand = makeRng(seed);
  const jitter = (amount: number): number => (rand() - 0.5) * 2 * amount;
  const spines: RootSpine[] = [];
  const add = (spine: Omit<RootSpine, 'grow'>): RootSpine => {
    const fitted = fitToGrid(spine);
    spines.push(fitted);
    return fitted;
  };

  // There is no central taproot. A mature tree's support is a ring of structural
  // roots leaving the collar, and the old wide taproot read as a triangular tooth
  // hanging under the trunk. The three laterals a side leave the collar themselves,
  // close to the surface, so the plate opens as a fan instead of hanging from one
  // spine. Their overlapping bases make the collar.

  // Laterals: outward first, then down. A lateral that leaves already diving is a
  // fence post; the flat start is what makes the plate look like it is spreading.
  //
  // The two sides are *not* mirror images. A plate of matched pairs is a bouquet,
  // which is exactly what a grown plate read as: a ball of strands. The side
  // offset in `reach` and the jitter on every angle break the symmetry, so one
  // side sweeps far and shallow and the other dives sooner - as roots do.
  // `out` is where it leaves, `drop` how much it turns down over its length, `bow`
  // how far the middle sags. A lateral that arrives on a steep heading is a frond:
  // the static plate these replaced left and arrived within a few degrees of level
  // and got its droop from the sag, which is a far calmer shape.
  // Widths step down with each lateral: the three of them used to be 4.2 / 3.6 /
  // 2.8 against a necked taproot, so they were the widest roots in the drawing.
  // Heavier than the old 5.4 / 4.4 / 3.4 and each forking once instead of twice.
  // The plate has to read as a root system, not as the veins of a leaf: a smaller
  // number of substantial roots carries the eye out to the fine material at the
  // tips, while the same reach drawn with twice the strands reads as a wire brush.
  const LATERALS = [
    { y: 4, out: 18, len: 74, drop: 15, bow: 12, w: 7.4 },
    { y: 8, out: 33, len: 56, drop: 19, bow: 11, w: 6.0 },
    { y: 12, out: 58, len: 44, drop: 24, bow: 9, w: 4.7 },
  ];
  for (const side of [-1, 1]) {
    for (const [index, lateral] of LATERALS.entries()) {
      // The far side of the plate reaches the edge of the cut, the near side a
      // little less: one root owns the widest reach instead of all of them.
      const reach = lateral.len + jitter(8) + (side > 0 ? 8 : 2);
      const heading = side > 0 ? lateral.out + jitter(5) : 180 - lateral.out + jitter(5);
      const parent = add({
        id: `lateral${side > 0 ? 'R' : 'L'}${index}`,
        p: curve(
          100 + side * 1.2,
          lateral.y + jitter(1.5),
          heading,
          reach,
          heading + side * lateral.drop,
          lateral.bow,
        ),
        w: lateral.w,
        tip: 0.5,
        gen: 1,
        // Below 1 the root keeps its body further along instead of thinning to a
        // hair for the last third: a long root that tapers like a spike has no
        // visible body at all, and that is what read as a string. 0.95 rather than
        // 0.85 so a lateral keeps its body further out.
        taper: 0.95,
      });
      // Forks start on the parent's centre line, sized from its width there, so the
      // parent covers the blunt start and the join is one root dividing.
      // Forks leave while the parent still has a body. At 0.8 of the way out the
      // lateral is thinner than the feeder leaving it, so the feeder's flat start
      // showed either side of it: a root that had been sliced off.
      for (const [forkIndex, at] of [0.5].entries()) {
        const point = cubicPoint(parent.p, at);
        // A fork is sized from the parent's width *there*, not at its base. Sized
        // from the base it came out twice as wide as the root it leaves, which is
        // what put a knob on the end of every lateral.
        const local = sampleSpine(parent, at).half * 2;
        const headingDeg = (Math.atan2(point.ty, point.tx) * 180) / Math.PI;
        const forkHeading = headingDeg + side * (22 + rand() * 24);
        add({
          id: `fork${side > 0 ? 'R' : 'L'}${index}${forkIndex}`,
          p: curve(
            point.x,
            point.y,
            forkHeading,
            16 + rand() * 16,
            forkHeading + side * (24 + rand() * 20),
            5 + rand() * 3,
          ),
          // Narrower than the parent at that point, so the parent covers its start.
          w: local * 0.9,
          // Sized from the fork's own width: a fixed tip on a thin feeder leaves it
          // with no taper at all.
          tip: local * 0.24,
          gen: 2,
          taper: 0.9,
        });
      }
    }
  }
  return spines;
}

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
  const { x, y, tx, ty } = cubicPoint(spine.p, t);
  return { x, y, tx, ty, nx: -ty, ny: tx, half: halfWidth(spine, t, pad) };
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
export function hairPath(spine: RootSpine, t: number, side: 1 | -1, len: number): string {
  const s = sampleSpine(spine, t);
  const sx = s.x + s.nx * side * s.half * HAIR_INSET;
  const sy = s.y + s.ny * side * s.half * HAIR_INSET;
  const out = len * side;
  const ex = sx + s.nx * out + s.tx * len * 0.3;
  const ey = sy + s.ny * out + s.ty * len * 0.3 + len * 0.3;
  const cx = sx + s.nx * out * 0.65;
  const cy = sy + s.ny * out * 0.65 + len * 0.3;
  const f = (n: number): string => n.toFixed(2);
  return `M${f(sx)} ${f(sy)} Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
}

/**
 * Hairs along a spine, placed by its own geometry rather than typed as free paths:
 * hand-placed hairs drifted off the roots and read as ticks floating in the dirt.
 * One hair per older spine, and none on the feeders: the old two-per-spine rule
 * put a second fringe around every fork and turned the plate's edge into a brush.
 */
function spineHairs(spine: RootSpine): Array<{ t: number; side: 1 | -1; len: number }> {
  if (spine.bark) return [{ t: 0.56, side: 1, len: 3 }];
  if (spine.gen === 2) return [];
  const seed = spine.id.length * 7 + spine.id.charCodeAt(spine.id.length - 1);
  return [
    {
      t: 0.42 + (seed % 5) * 0.02,
      side: seed % 2 === 0 ? 1 : -1,
      len: 3 + (seed % 3) * 0.45,
    },
  ];
}

/**
 * The plate at a growth level.
 *
 * Growth is a *scale*, not a redraw: the plate is the same drawing at every care
 * count and the element is scaled about the soil line. Growing it by truncating
 * every root along its own curve was tried and it is worse in the scene: a
 * part-grown plate is a fringe of short stubs, and a full one is a ball of
 * strands, because extension makes every root longer without making it thicker.
 * Scaling gives the same plate bigger, which is what the care count is showing.
 */
export function rootDepth(points: number): number {
  const care = Number.isFinite(points) ? Math.max(0, points) : 0;
  // A *fraction* of the plant's own care scale: the plate hangs off the shoot, so
  // it grows with it. It used to be 0.85 to 1, which meant the roots grew by 18%
  // while the shoot above them grew by 60% - the same plant aged into a tree above
  // the soil and stayed a seedling below it. 0.74 to 1.04 gives the roots the same
  // growth in proportion, and the last few percent of flare is the root crown
  // thickening around the trunk of an old tree, which is what a root plate does.
  return 0.74 + 0.3 * (1 - Math.exp(-care / 14));
}

function fillOf(spine: RootSpine): string {
  if (spine.bark) return 'url(#pl-root-bark)';
  if (spine.gen === 2) return 'var(--pl-root-tip, #b59a76)';
  // A vertical ramp, not a flat fill. The plate is a cut through soil: a root is
  // paler where it meets the surface and warmer as it goes down, and a single
  // cream body made every lateral read as a wire lying on top of the dirt.
  return 'url(#pl-root-body)';
}

/** The roots' markup, without the SVG wrapper. */
export function rootsContent(): string {
  const spines = buildRoots();
  // Thinnest first, so every parent is painted over the branch it grew.
  const strands = [...spines].sort((a, b) => a.w - b.w);
  const ink = strands
    .map((root) => `<path d="${spineOutline(root, 1.2)}" fill="var(--pl-root-ink, #1c1208)"/>`)
    .join('');
  const body = strands
    .map((root) => `<path d="${spineOutline(root)}" fill="${fillOf(root)}"/>`)
    .join('');
  const hairs = spines
    .flatMap((spine) =>
      spineHairs(spine)
        .filter((hair) => hair.t <= 0.98)
        .map((hair) => `<path d="${hairPath(spine, hair.t, hair.side, hair.len)}"/>`),
    )
    .join('');
  return `
      <defs>
        {/* The crown is solid at the soil line: the trunk's filled flare covers the
            flat top of the plate, so the two are one silhouette rather than a
            faded shelf with a bulb above it. */}
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
        <linearGradient id="pl-root-body" gradientUnits="userSpaceOnUse"
                        x1="0" y1="0" x2="0" y2="58">
          <stop offset="0" style="stop-color: var(--pl-root, #d9c3a1)"/>
          <stop offset="0.58" style="stop-color: var(--pl-root-tip, #b59a76)"/>
          <stop offset="1" style="stop-color: var(--pl-root-tip, #b59a76)"/>
        </linearGradient>
        <linearGradient id="pl-root-bark" gradientUnits="userSpaceOnUse"
                        x1="0" y1="0" x2="0" y2="58">
          {/* Bark, not stem: the crown of the plate is the same wood as the trunk
              above it. It was the *stem* green, so every plant stood on a green
              collar that turned into brown wood and then pale root inside four
              units - the one colour in the drawing that was simply wrong. */}
          {/* The wood carries deeper than it used to. The trunk's foot is one shape
              ending at the soil line and the plate's collar is another starting
              there; when the collar turned pale within ten units they read as two
              pieces stacked, with the ground as the seam. Bark now runs well below
              the line and lets go of the colour gradually, so the trunk sinks into
              its roots instead of being plugged into them. */}
          <stop offset="0" stop-color="var(--pl-root-bark, #432c15)"/>
          <stop offset="0.2" stop-color="var(--pl-bark, #6a4a2b)"/>
          <stop offset="0.52" stop-color="var(--pl-root, #d9c3a1)"/>
        </linearGradient>
      </defs>
      <g mask="url(#pl-root-depth)">
        <g opacity="0.3">${ink}</g>
        ${body}
        <g fill="none" stroke="var(--pl-root-tip, #b59a76)" stroke-opacity="0.42"
           stroke-width="1" stroke-linecap="round">${hairs}</g>
      </g>`;
}

/** The roots, as one self-contained SVG that hangs below the shoot. */
export function rootsMarkup(): string {
  return (
    '<svg class="pl-title-plant__roots" viewBox="0 0 200 58" aria-hidden="true" ' +
    `focusable="false">${rootsContent()}</svg>`
  );
}
