/**
 * The roots that leave the plant and reach a buried find.
 *
 * The plate under the mascot is one drawing scaled about the soil line
 * (`rootDepth` in `roots.ts`): it thickens and deepens with care, but a scale
 * cannot make a root travel sideways to a chest that is buried at the edge of the
 * cut. So the reach is its own layer: one path per find, in the ground's own
 * percentage space, starting at the crown (50%, 0%) and ending on the piece. The
 * path is revealed along its length, which is what "a root grows towards it" looks
 * like - not a line that fades in.
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
  /** A fork off the spine, a grip that holds the find, or a hair off a fork. */
  kind: 'fork' | 'grip' | 'hair';
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
  /**
   * Branches and the small roots off them, as one path of tapered shapes.
   *
   * The plate's roots fork (see `roots.ts`): a lateral leaves the parent, narrows,
   * and throws its own feeders. A reach with one spine and three stroke "hairs" had
   * none of that and read as a rope with whiskers laid beside the plate.
   */
  laterals: string;
  /**
   * The feeders off those branches: the plate's root hairs.
   *
   * The plate draws generation-2 forks at full strength and their hairs as a
   * 50%-opacity stroke (`roots.ts` `hairs`), so a reach's third order has to be
   * paler than its second or the tips read as one flat brush.
   */
  hairs: string;
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

/**
 * The centreline of a branch leaving `spine` at `t`, as sampled points.
 *
 * It leaves at a wide angle and turns further down as it goes, which is what makes
 * a root crown read as a fan instead of as a set of whiskers. Returned as points so
 * a branch can have its own feeders, the way the plate's laterals do.
 */
function branchPoints(spine: Pt[], t: number, side: number, length: number): Pt[] {
  const index = Math.min(spine.length - 1, Math.max(0, Math.round(t * (spine.length - 1))));
  const origin = spine[index] ?? { x: ROOT_CROWN.x, y: ROOT_CROWN.y };
  const before = spine[Math.max(0, index - 1)] ?? origin;
  const after = spine[Math.min(spine.length - 1, index + 1)] ?? origin;
  const heading = Math.atan2(after.y - before.y, after.x - before.x);
  // 31 degrees off the parent, then a further 29 over its length: the plate's forks
  // leave at 22-46 and turn 24-44 more, so the departure was set at 66 degrees here
  // - twice the plate's widest - and every join was a kink.
  const out = heading + side * 0.55;
  // The bend is clamped to level: a fork on the upper side of a level parent would
  // otherwise lift above the point it left (measured 0.88 units, ten pixels on
  // screen), and no root on the plate ever rises.
  const control = {
    x: origin.x + Math.cos(out) * length * 0.5,
    y: Math.max(origin.y + length * 0.18, origin.y + Math.sin(out) * length * 0.5),
  };
  const end = {
    x: origin.x + Math.cos(out + side * 0.5) * length,
    // A branch never rises above the point it left its parent: the plate's roots
    // only ever go down, and a fork that lifts is a wire bent upward.
    y: Math.max(
      origin.y + length * 0.3,
      origin.y + Math.sin(out + side * 0.5) * length + length * 0.12,
    ),
  };
  const points: Pt[] = [];
  for (let step = 0; step <= 8; step += 1) {
    const u = step / 8;
    const a = (1 - u) ** 2;
    const b = 2 * (1 - u) * u;
    const c = u * u;
    points.push({
      x: a * origin.x + b * control.x + c * end.x,
      y: a * origin.y + b * control.y + c * end.y,
    });
  }
  return points;
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
 * find); `outline` and `ink` are the drawn shapes, and `hairs` the root hairs
 * that make it read as a root instead of a drawn line.
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
    // Below the soil line, not on it. The widest part of a root is its crown, and a
    // crown sitting on the line paints its own shoulder over the horizon, which is
    // what still read as a root growing in the air. The band is 0..100 deep, so this
    // is one to three per cent of it under the ground - and deeper for a deeper row.
    y: round(1.7 + lane * 1.6 + noise * 0.3),
  };
  // The run stops short of the find: what lands on the piece is its grips.
  const stop = { x: round(end.x + inward * 5.5), y: round(end.y + 0.2) };
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
  // The plate's laterals are about 1.6 units of a 200-unit band, so 0.8% of the
  // band's width. This layer is a 0..100 space stretched over the same band, so the
  // matching half-width is 0.4, not 0.8: the first passes were twice the plate's
  // thickness and read as pale bands laid across the soil instead of as roots.
  // World units of the band, so the camera scales the whole root - length, taper and
  // ink alike - with everything else buried in the soil.
  // The plate's own laterals are about 0.8 of its 200-unit band, which on screen is
  // a hair over a pixel. This layer is the same 0..100 space stretched across the
  // whole cut, so the matching half-width is 0.16, not 0.4 or 0.5: the reaches were
  // three times the plate's thickness and read as cables laid over the soil.
  // This layer is the whole cut in 0..100, so one unit is about 11 px at a 1150 px
  // pane and about six at the pulled-back zoom. A half-width below 0.1 is then under
  // a pixel and the root disappears: the tip keeps 0.1 for that reason.
  // These runs are three times as long as a plate lateral (the plate's widest is 74
  // of its 200 units, a reach is 41 of 100 across the whole pane), so the same taper
  // reads as a thread. The base is a quarter wider than the plate's for that reason;
  // 0.1 is still 2.3 px at the tip on a desktop pane.
  const thick = 0.44 + (1 - noise) * 0.1;
  // It closes to a hair at the tip, so the rounded end is a point rather than a
  // rounded rectangle.
  // Flared at the crown: the first tenth of the run is up to twice as thick, which
  // is what merges it into the plate's root crown instead of starting as a wire.
  // The plate's laterals are 6.8 px wide at the base, 3.8 at half way and 0.63 at the
  // tip - 56% then 9% - from a `(1 - t) ** 0.95` taper. This was 1.1 with a 0.1 floor,
  // which held 29% of the base out to the very tip: the last fifth stayed a fat wire
  // instead of thinning off. 1.3 with a 0.09 floor gives 53% at half and 20% at nine
  // tenths, and 0.09 is still 2 px on screen at zoom 1.
  const half = (t: number): number =>
    (0.12 + (thick - 0.12) * (1 - t) ** 1.25) * (1 + 0.6 * Math.max(0, 1 - t * 6));
  // A constant edge, not a proportional one: a thick root and a thin one get the
  // same ink line, so the outline stays thin all the way down.
  const inkHalf = (t: number): number => half(t) + 0.06;

  // Branches, and the feeders off them.
  //
  // The plate draws a lateral that forks its own smaller roots (`roots.ts`, the
  // generation-2 spines); a reach with two whiskers on it had none of that and read
  // as wire. Two branches carry two feeders each, and the spine throws three short
  // ones of its own, all sized from the parent's width where they leave it.
  const name = rootRunName(index);
  const branches: RootBranch[] = [];
  const addBranch = (kind: RootBranch['kind'], d: string): void => {
    branches.push({ name: `${name}_${branches.length + 1}`, kind, d });
  };
  const fork = (from: Pt[], t: number, side: number, length: number, scale: number): Pt[] => {
    const points = branchPoints(from, t, side, length);
    addBranch('fork', tapered(points, half(t) * scale));
    return points;
  };
  // The count matches the plate's: a lateral carries two forks, each of which has one
  // hair, and nothing else. Four branches on the spine (two of them plucked out of
  // thin air at 0.2, 0.47 and 0.7 of the way down) is twice the richest root on the
  // plate, and it is what made the reaches read as a wire brush next to it.
  const leftW = half(0.34) * 0.62;
  const rightW = half(0.64) * 0.5;
  const left = fork(spine, 0.34, 1, 10 + (1 - noise) * 5, 0.62);
  addBranch('hair', tapered(branchPoints(left, 0.55, -1, 4 + noise * 1.6), leftW * 0.5));
  const right = fork(spine, 0.64, -1, 8 + noise * 4, 0.5);
  addBranch('hair', tapered(branchPoints(right, 0.6, 1, 3.6 + noise * 1.6), rightW * 0.46));
  // The grips. These are what arrives on the find: the run itself stops four units
  // short of it, so the piece is held by branches that come over its face rather
  // than spiked by the end of the main root. They leave the last fifth of the run
  // and are the thick end of it, so they stay visible at the pulled-back zoom.
  const gripThick = 0.2 + (1 - noise) * 0.05;
  const lean = side > 0 ? 1 : -1;
  for (const [t, target, thick, bend] of [
    [0.8, { x: round(end.x - 3.4 * lean), y: round(end.y + 2.4) }, gripThick, 1.5 * lean],
    [0.87, { x: round(end.x + 3.2 * lean), y: round(end.y + 3.4) }, gripThick * 0.92, -1.3 * lean],
    [0.94, { x: round(end.x + inward * 1.2), y: round(end.y + 5.2) }, gripThick * 0.85, 1.1],
    [0.99, { x: round(end.x + inward * 2.2), y: round(end.y + 1.2) }, gripThick * 0.8, -1.2],
  ] as Array<[number, Pt, number, number]>) {
    addBranch('grip', gripOn(spine, t, target, thick, bend));
  }

  return {
    id: treasure.id,
    name,
    branches,
    d,
    outline: ribbon(spine, half),
    ink: ribbon(spine, inkHalf),
    laterals: branches
      .filter((branch) => branch.kind !== 'hair')
      .map((branch) => branch.d)
      .join(' '),
    hairs: branches
      .filter((branch) => branch.kind === 'hair')
      .map((branch) => branch.d)
      .join(' '),
    tip: 'M ' + spine.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L '),
  };
}

/** Every run, in burial order: the first find reached is the first drawn. */
export function rootRuns(treasures: ReadonlyArray<Treasure> = TREASURES): RootRun[] {
  return treasures.map((treasure, index) => rootRunFor(treasure, index));
}
