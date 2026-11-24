/**
 * How a non-tube organ comes out of the part it sits on.
 *
 * Every organ except a tube used to be drawn whole on its first frame: a blade
 * from 35% of its size and a flower head the same, then both only got *resized*.
 * A shape that appears and then grows is not an organ emerging - its tip exists
 * before the petiole carried it anywhere.
 *
 * Two rules, because the two organs emerge differently. A blade has a long axis,
 * so it reaches along that axis and opens across it. A head is a bud that opens:
 * it stands its height along the stem at once and spends the rest of the growth
 * spreading, so half-grown it is still a bud rather than a small open flower.
 * Both start at nothing, which is the part that was missing.
 */
const smooth = (t: number): number => t * t * (3 - 2 * t);

const clampProgress = (progress: number): number =>
  Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;

/** Share of its width a blade has at the start: a stub at the petiole, not a leaf. */
export const BLADE_WIDTH_FLOOR = 0.3;

/** Spread of a closed bud, against the open head's spread. */
export const HEAD_BUD_SPREAD = 0.28;

/**
 * How far a bud stands off its stem, against the open head's thickness.
 *
 * Above 1 on purpose: the petals of a bud are gathered and lifted, so the head is
 * taller than the flat flower it opens into. Scaling the head to at most its
 * finished size could only ever draw a small open flower.
 */
export const HEAD_BUD_STAND = 1.8;

/** How far through its emergence a head is before it starts to open at all. */
export const HEAD_BUD_STAGE = 0.3;

export interface BladeEmergence {
  /** Scale along the blade, from its petiole out to its tip. */
  length: number;
  /** Scale across the blade. */
  width: number;
}

export function bladeEmergence(progress: number): BladeEmergence {
  const t = clampProgress(progress);
  // Width trails length by a cube: halfway along, the blade has reached half its
  // length but opened only a quarter of the width it has to open. What the plant
  // puts out first is a narrow spear that broadens as it arrives - the blade is
  // never the finished lamina at a smaller size.
  const opened = t * t * t;
  return {
    length: smooth(t),
    width: BLADE_WIDTH_FLOOR + (1 - BLADE_WIDTH_FLOOR) * opened,
  };
}

export interface HeadEmergence {
  /** Scale across the stem: how far the petals have opened. */
  spread: number;
  /** Scale along the stem: how far the head stands off its tip. */
  alongStem: number;
}

export function headEmergence(progress: number): HeadEmergence {
  const t = clampProgress(progress);
  const bud = smooth(Math.min(1, t / HEAD_BUD_STAGE));
  const open = smooth(Math.max(0, (t - HEAD_BUD_STAGE) / (1 - HEAD_BUD_STAGE)));
  return {
    // A bud is narrow and tall: the spread arrives only with the opening, and the
    // stand-off rises past the finished head's thickness while the petals are
    // still gathered, then settles back to 1 as they spread and flatten. Scaling
    // the head uniformly - or even by two axes that never exceed 1 - drew half a
    // flower as a small *open* flower, which is not a stage any flower has.
    alongStem: HEAD_BUD_STAND * bud - (HEAD_BUD_STAND - 1) * open,
    spread: HEAD_BUD_SPREAD * bud + (1 - HEAD_BUD_SPREAD) * open,
  };
}
