/**
 * The roots that leave the plant and reach a buried find.
 *
 * The plate under the mascot is one drawing scaled about the soil line
 * (`rootDepth` in `roots.ts`): it thickens and deepens with care, but a scale
 * cannot make a root travel sideways to a chest that is buried at the edge of the
 * cut. So the reach is its own layer: one path per find, in the ground's own
 * percentage space, starting just under the crown (about 50%, 3%) and ending on
 * the piece. The path is revealed along its length, which is what "a root grows
 * towards it" looks like - not a line that fades in.
 *
 * The geometry is data, so the arithmetic can be tested without a browser: the
 * tests check that every run starts on the crown, ends inside the piece it claims,
 * and that no two runs are the same shape.
 */

import { TREASURES, type Treasure } from './treasures.ts';

/**
 * One branch off a run, named the way the rules talk about them: the run's letter
 * and the branch's number, `a_1`, `a_2`, `b_3`.
 *
 * A run is a letter (`a` is the first find in burial order) and every branch hanging
 * off it is numbered within it, so a rule can say "a_2 leaves at 31 degrees" or
 * "no branch of b rises above its join" and a reader can find the one it means.
 */
export interface RootBranch {
  /** `a_1`, `a_2`, ... */
  name: string;
  /** A grip that holds the find. */
  kind: 'grip';
  d: string;
}

/** `a` for run 0, `b` for run 1, and so on. */
export function rootRunName(index: number): string {
  return String.fromCharCode(97 + (((index % 26) + 26) % 26));
}

export interface RootRun {
  /** The find this run reaches. */
  id: string;
  /** The run's letter, `a`..`h` in burial order: its branches are numbered under it. */
  name: string;
  /** Every branch off this run, named `<letter>_<number>`. */
  branches: RootBranch[];
  /**
   * The centreline, in the ground's 0..100 coordinate space.
   *
   * Kept as a path because it is the run's identity and the reveal's spine; the
   * drawing itself is the tapered `outline` below.
   */
  d: string;
  /**
   * The drawn root: a closed, filled outline that leaves the crown wide and
   * narrows to a point at the find.
   *
   * The static plate under the mascot is drawn as a tapered shape (`roots.ts`
   * `spineOutline`) and the reaches were constant-width strokes, so a reach read
   * as a cable laid over the dirt next to real roots. A stroke cannot taper; a
   * filled outline can, which is why this is geometry rather than a wider line.
   */
  outline: string;
  /** The same shape, padded, filled with the ink colour: the plate's own edge. */
  ink: string;
  /** The grips that hold the find, as one path of tapered shapes. */
  laterals: string;
  /**
   * The run's centreline, stroked under the body.
   *
   * A fill tapers to nothing in whatever width the pane happens to be: on a phone
   * the tip came out at 0.7 px wide and simply faded away. A non-scaling stroke is
   * the px floor a fill cannot have - thinner than the body everywhere it is wide,
   * so it only shows along the thin half, where it keeps the root visible.
   */
  tip: string;
}

/** The crown: the top centre of the cut, where the plant meets the soil. */
export const ROOT_CROWN = { x: 50, y: 0 } as const;

/** A stable number from a string, so each find keeps its own curve every load. */
function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function round(value: number): number {
  // Two decimals, not one. One decimal is 1.15 px on the screen at this layer's
  // scale, and a curve drawn through coordinates quantised to a pixel and a bit has
  // corners every sample: the path measured a 3 unit radius (35 px) after smoothing
  // and only 0.9 (10 px) once it was rounded to a tenth.
  return Math.round(value * 100) / 100;
}

/**
 * Where a run should touch a find.
 *
 * The tip lands just inside the piece's top edge, off centre by about a fifth of
 * a piece's half-width: ending deeper in the piece made a reach look like it came
 * out of the far side of one find and carried on to another.
 */
export function rootRunEnd(treasure: Treasure, index = 0): { x: number; y: number } {
  const bias = (Math.abs(index) % 2 === 0 ? -1 : 1) * Math.min(treasure.width * 0.12, 2.2);
  return { x: round(treasure.x + bias), y: round(treasure.y + 3) };
}

interface Pt {
  x: number;
  y: number;
}

/**
 * A monotone path: every step of it is further out and further down.
 *
 * The plate's laterals leave the trunk heading out and down and never turn back.
 * The reaches used a Catmull-Rom through a waypoint that leaned them back inwards -
 * out, in, out - and the only way to make that read as a curve was 1200 relaxation
 * passes. A monotone cubic needs neither: when both coordinates only ever increase
 * the path cannot double back, cannot rise above its own start, and cannot overshoot
 * into a cusp. Fritsch-Carlson tangents (half the mean slope, clamped to three times
 * the smaller neighbouring secant) are what guarantees that.
 */
function monotonePath(knots: ReadonlyArray<Pt>, perSpan = 18): Pt[] {
  const n = knots.length;
  const xs = knots.map((p) => p.x);
  const ys = knots.map((p) => p.y);
  const tangents = (v: number[]): number[] => {
    const secants = v.slice(1).map((value, i) => value - (v[i] as number));
    return v.map((_, i) => {
      const before = secants[i - 1];
      const after = secants[i];
      if (before === undefined) return after ?? 0;
      if (after === undefined) return before;
      // A repeated value has to stay flat, or the curve bulges past it and the root
      // steps back on itself.
      if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) return 0;
      const mean = (before + after) / 2;
      const limit = 3 * Math.min(Math.abs(before), Math.abs(after));
      return Math.sign(mean) * Math.min(Math.abs(mean), limit);
    });
  };
  const mx = tangents(xs);
  const my = tangents(ys);
  const out: Pt[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const x0 = xs[i] as number;
    const x1 = xs[i + 1] as number;
    const y0 = ys[i] as number;
    const y1 = ys[i + 1] as number;
    for (let step = 0; step < perSpan; step += 1) {
      const u = step / perSpan;
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      out.push({
        x: h00 * x0 + h10 * (mx[i] as number) + h01 * x1 + h11 * (mx[i + 1] as number),
        y: h00 * y0 + h10 * (my[i] as number) + h01 * y1 + h11 * (my[i + 1] as number),
      });
    }
  }
  out.push(knots[n - 1] as Pt);
  return out;
}

/** The outline of a tapered ribbon along `points`, `half(t)` from the centre. */
function ribbon(points: Pt[], half: (t: number) => number): string {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const last = points.length - 1;
  const fallback = points[last] ?? { x: 0, y: 0 };
  for (let i = 0; i <= last; i += 1) {
    const point = points[i] ?? fallback;
    const prev = points[Math.max(0, i - 1)] ?? point;
    const next = points[Math.min(last, i + 1)] ?? point;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const length = Math.hypot(tx, ty) || 1;
    tx /= length;
    ty /= length;
    const h = half(last === 0 ? 0 : i / last);
    left.push({ x: point.x - ty * h, y: point.y + tx * h });
    right.push({ x: point.x + ty * h, y: point.y - tx * h });
  }
  const start = left[0];
  if (!start) return '';
  const fmt = (p: Pt): string => `${round(p.x)} ${round(p.y)}`;
  // The tip is a curve through the centreline's last point, not a straight cut
  // between the two edges. The first version closed the outline with `L tip`, so
  // every root ended in a flat, rectangular end - a plank, not a root tip.
  const tipRight = right[last - 1] ?? start;
  return (
    `M ${fmt(start)} ` +
    left
      .slice(1, -1)
      .map((p) => `L ${fmt(p)}`)
      .join(' ') +
    ` Q ${fmt(fallback)} ${fmt(tipRight)} ` +
    right
      // The last two are already covered: the tail of the body and the end of the
      // rounded tip. Repeating them put a zero-length segment in the outline.
      .slice(0, -2)
      .reverse()
      .map((p) => `L ${fmt(p)}`)
      .join(' ') +
    ' Z'
  );
}

/** A branch's points as a tapered shape: narrow at its join, a point at its tip. */
function tapered(points: Pt[], thick: number): string {
  return ribbon(points, (u) => 0.08 + (thick - 0.08) * (1 - u) ** 1.2);
}

/** A branch from a point on `spine` to an absolute target, bent by `bend`. */
function gripOn(spine: Pt[], t: number, target: Pt, thick: number, bend: number): string {
  const index = Math.min(spine.length - 1, Math.max(0, Math.round(t * (spine.length - 1))));
  const origin = spine[index] ?? target;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const len = Math.hypot(dx, dy) || 1;
  const control = {
    x: (origin.x + target.x) / 2 - (dy / len) * bend,
    y: (origin.y + target.y) / 2 + (dx / len) * bend,
  };
  const points: Pt[] = [];
  for (let step = 0; step <= 8; step += 1) {
    const u = step / 8;
    const a = (1 - u) ** 2;
    const b = 2 * (1 - u) * u;
    const c = u * u;
    points.push({
      x: a * origin.x + b * control.x + c * target.x,
      y: a * origin.y + b * control.y + c * target.y,
    });
  }
  return tapered(points, thick);
}

/**
 * One root run, from the crown to the piece.
 *
 * `d` is the cubic centreline (and what the tests hold to the crown and the
 * find); `outline` and `ink` are the drawn shapes, and `laterals` the three grips
 * that hold the find.
 */
export function rootRunFor(treasure: Treasure, index = 0): RootRun {
  const end = rootRunEnd(treasure, index);
  const noise = hashId(treasure.id);
  // Which side the find is on, and how far out it is.
  const side = end.x < 50 ? -1 : 1;
  const inward = -side;
  const reach = Math.abs(end.x - 50);
  // Under the trunk's foot, on the soil line. The plant's roots leave the *bottom*
  // of the tree, not its sides, so every run starts inside the trunk's own width -
  // and below the ground, never on it.
  // Which row of finds this one is in, counted from the top of its own side.
  //
  // Four runs leaving one crown and passing one corridor to four pieces in a single
  // column is why two roots lay on each other under the bottom finds: every curve
  // below the crown was all but the same curve. A deeper find now leaves the trunk
  // lower and travels further out before it dives, so the four run as a fan of lanes.
  const peers = TREASURES.filter((find) => find.x < 50 === treasure.x < 50).sort(
    (a, b) => a.y - b.y,
  );
  const row = Math.max(
    0,
    peers.findIndex((find) => find.id === treasure.id),
  );
  const lane = row / Math.max(1, peers.length - 1);
  const start = {
    x: round(50 + side * (0.4 + noise * 1.1)),
    // Below the soil line, not on it - and far enough below that the *whole* width
    // of the root's cut end is under the line. At the old 1.7 with a crowned start
    // the top edge sat above the horizon, so eight runs laid a row of flat dark
    // ovals along the soil surface. The plate's root crown covers these ends.
    y: round(2.8 + lane * 1.3 + noise * 0.2),
  };
  // The run stops just short of the find: what lands on the piece is its grips.
  // It used to stop 5.5 units out, which left the grips bridging a gap wide enough
  // that their curves crossed and read as a knot of wire. Three units still keeps
  // the main root from spiking through the piece, but leaves the join short enough
  // for two fingers to close it cleanly.
  const stop = { x: round(end.x + inward * 3), y: round(end.y + 0.3) };
  // Three knots, each one further out and further down than the last: down first,
  // then out along its own depth. Every coordinate is monotone, so the path cannot
  // double back, cannot rise above its starting point, and cannot overshoot.
  // Out first, then down - the plate's own profile. Its laterals leave within 15-30
  // degrees of level and arrive at 30-80, so a root travels before it dives. Run the
  // other way (down first, then out) and every reach is a straight spoke from the
  // trunk; this is the same monotone path with the curve in it.
  // The two middle knots take the lane: a deeper row stays *nearer the trunk* while
  // it dives (its outward share shrinks as the lane grows) and gives up its depth
  // sooner, so it passes under the pieces above it instead of fanning out on the same
  // angle as the shallow rows. Each is floored against the knot above it, because
  // monotone geometry is the guarantee the whole path rests on - a row close to the
  // crown cannot be given a lane that starts below its own finding.
  const laneKnot = (share: number, out: number, floor: number): Pt => ({
    x: round(50 + side * reach * out),
    y: round(Math.max(stop.y * share, floor)),
  });
  const first = laneKnot(0.2 + lane * 0.1, 0.46 - lane * 0.16 + noise * 0.04, start.y + 0.8);
  const second = laneKnot(0.55 + lane * 0.08, 0.78 - lane * 0.16 + noise * 0.04, first.y + 0.8);
  const knots: Pt[] = [start, first, second, stop];
  const spine = monotonePath(knots, 18);
  const d =
    `M ${round(spine[0]?.x ?? ROOT_CROWN.x)} ${round(spine[0]?.y ?? ROOT_CROWN.y)} ` +
    spine
      .slice(1)
      .map((p) => `L ${round(p.x)} ${round(p.y)}`)
      .join(' ');

  // Half-widths: a root leaves the crown thick, thins steadily, and ends in a
  // point. The plate uses `(1 - t) ** taper + tip`; the same curve here keeps a
  // reach and a static root the same object.
  //
  // The plate's laterals are 7.4 units across a 200-unit band, 3.7% of the band's
  // width. This layer is a 0..100 space stretched over the same band, so the
  // matching full width is 3.7 units, or 1.85 half. A run is much longer than a
  // lateral, so its body is held just under that, 1.8 half; the crown flares wider
  // where it joins the plate and the long taper carries it to a point. The first
  // version used half of 0.52 and the reaches read as pale wires laid over the
  // soil next to real roots.
  //
  // World units of the band, so the camera scales the whole root - length, taper
  // and ink alike - with everything else buried in the soil.
  const thick = 1.8 + (1 - noise) * 0.18;
  // A root leaves the plate at its body width and tapers to a point. It used to
  // flare over the first tenth to merge into the plate's crown, but the flare made
  // the cut end wider than the plate could hide; the plate already supplies the
  // crown, so the run can start as the root it is. The tip is a point, not a
  // clipped rectangle; 0.14 is about a pixel at the pulled-back zoom, and the
  // non-scaling tip stroke carries the last of it.
  const half = (t: number): number => 0.14 + (thick - 0.14) * (1 - t) ** 1.25;
  // A constant edge, not a proportional one: thick and thin roots get the same ink
  // line, so the outline stays a hair all the way down. A hair was too little on the
  // pale tan body: at the pulled-back zoom the reaches lost their edge and read as
  // flat ribbons. A tenth of a unit is still an edge, not an outline.
  const inkHalf = (t: number): number => half(t) + 0.14;

  // The grips are the only branches a reach needs. Forks and hairs were tried as
  // well and made eight long runs read as a bundle of pale wires crossing the cut;
  // the plate under the trunk carries that detail, so the reaches stay one clean
  // tapered root with two fingers on the find.
  const name = rootRunName(index);
  const branches: RootBranch[] = [];
  const addBranch = (d: string): void => {
    branches.push({ name: `${name}_${branches.length + 1}`, kind: 'grip', d });
  };
  // The grips. These are what arrives on the find: the run itself stops a few
  // units short of it, so the piece is held by branches that come over its face
  // rather than spiked by the end of the main root. Two fingers, not three: with
  // the old wide gap all three had to reach across, and their arcs crossed into a
  // loop on top of every piece. Keep the bend shallow so each finger is a rootlet
  // lying over the find, not another curve to read.
  const gripThick = 0.46 + (1 - noise) * 0.06;
  const lean = side > 0 ? 1 : -1;
  for (const [t, target, thick, bend] of [
    [0.86, { x: round(end.x - 3.6 * lean), y: round(end.y + 2.2) }, gripThick, 0.5 * lean],
    [0.96, { x: round(end.x + 2.8 * lean), y: round(end.y + 3) }, gripThick * 0.9, -0.4 * lean],
  ] as Array<[number, Pt, number, number]>) {
    addBranch(gripOn(spine, t, target, thick, bend));
  }

  return {
    id: treasure.id,
    name,
    branches,
    d,
    outline: ribbon(spine, half),
    ink: ribbon(spine, inkHalf),
    laterals: branches.map((branch) => branch.d).join(' '),
    tip: `M ${spine.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')}`,
  };
}

/** Every run, in burial order: the first find reached is the first drawn. */
export function rootRuns(treasures: ReadonlyArray<Treasure> = TREASURES): RootRun[] {
  return treasures.map((treasure, index) => rootRunFor(treasure, index));
}
