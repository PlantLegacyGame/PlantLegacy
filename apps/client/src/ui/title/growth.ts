/**
 * The plant's growth ladder, as arithmetic.
 *
 * The mascot used to have ten art states, so watering it changed the picture a
 * handful of times and then only nudged a scale. A plant that is looked after for
 * weeks should visibly climb: seed, sprout, sapling, young tree, adult, elder,
 * ancient, with something different at every step.
 *
 * So growth is a hundred stages. Each one is a full profile - how tall the plant
 * is, how thick its wood is, how much foliage and how many limbs it has grown -
 * interpolated between a handful of keyframes. Every water or feed is five stages,
 * and the five in between are not cosmetic: the height, the trunk width, the leaves
 * and the limbs all move a little at each one, and the title's zoom is what lets a
 * hundred steps of a growing tree be looked at closely.
 *
 * Care is walked, not switched. The drawing animates from the stage it currently
 * shows to the one the care earned, paced by a stream of light climbing the stem:
 * the stage is linear in the run's progress (`growthStageAlong`) and the endpoints
 * are exact, so leaves open one at a time as the stream reaches their thresholds,
 * and each branch extends when the stream passes the place it leaves the trunk. A
 * load or a reset applies the stage at once, with no run and no light.
 * `growthTransitionMs` owns the length of that walk.
 *
 * The light never decides what the plant looks like; it only decides when the
 * stage's predetermined shape arrives. Each tier has its own morphology: a seed
 * in the soil, a two-leaf sprout, a green sapling whose wood hardens slowly into
 * bark, then a crowned tree whose trunk, limbs and spread go on thickening and
 * widening. The profile below is the whole appearance; the drawing reads it.
 *
 * Pure data and arithmetic: no DOM, so the ladder can be tested and the drawing
 * only has to render whatever this module says.
 */

/** Steps from the seed to the tallest form. */
export const GROWTH_STAGES = 100;

/**
 * Care actions from seed to ancient.
 *
 * Sixty, not the twenty the first ladder used: reaching the top of a hundred-stage
 * tree after twenty waterings made the last third of the ladder a week's work at
 * most, and there was nothing left to grow for. Sixty waterings is a long-run
 * ladder that a save can climb for months.
 *
 * The mapping is a curve rather than a straight line, and it is pinned so that a
 * plant with the fifteen points the old saves carry still lands on the same stage
 * it looked like before: growth is quick while a plant is young and slows as it
 * matures, which is both how a plant grows and what keeps the earliest waterings
 * the most rewarding.
 */
export const GROWTH_POINTS = 60;

/** Where an older save's full-growth care count lands on the ladder. */
const LEGACY_POINTS = 15;
const LEGACY_SHARE = 0.75;
/** Solved so the curve passes exactly through (LEGACY_POINTS, LEGACY_SHARE). */
const CURVE = Math.log(1 - LEGACY_SHARE) / Math.log(1 - LEGACY_POINTS / GROWTH_POINTS);

export type GrowthTierId = 'seed' | 'sprout' | 'sapling' | 'young' | 'adult' | 'elder' | 'ancient';

export interface GrowthTier {
  id: GrowthTierId;
  label: string;
  /** First stage of the tier (inclusive). */
  from: number;
  /** One past the last stage of the tier. */
  to: number;
}

/**
 * The named ages, in order. They are contiguous and cover 0..GROWTH_STAGES so the
 * label under the plant can never fall through a gap.
 */
export const GROWTH_TIERS: readonly GrowthTier[] = [
  { id: 'seed', label: 'Seed', from: 0, to: 3 },
  { id: 'sprout', label: 'Sprout', from: 3, to: 8 },
  { id: 'sapling', label: 'Sapling', from: 8, to: 20 },
  { id: 'young', label: 'Young tree', from: 20, to: 42 },
  { id: 'adult', label: 'Adult tree', from: 42, to: 78 },
  { id: 'elder', label: 'Elder tree', from: 78, to: 92 },
  { id: 'ancient', label: 'Ancient tree', from: 92, to: GROWTH_STAGES },
];

export interface GrowthProfile {
  /** The stage this profile was asked for, clamped to the ladder. */
  stage: number;
  tier: GrowthTier;
  /** How tall the drawing stands; the art is one drawing, scaled. */
  scale: number;
  /** Trunk thickness, 0 (a green stem) to 1 (a tree's wood). */
  trunkWidth: number;
  /** Whether the woody base has arrived. */
  trunkOpacity: number;
  /**
   * How woody the stem looks, 0 (green stem) to 1 (bark).
   *
   * A sapling is still green, not a miniature brown tree: the bark arrives as the
   * trunk thickens through the young tier. The seed and sprout use their own art,
   * so this matters from the sapling up. Roots keep their own wood colour.
   */
  woodTone: number;
  /** Share of the stem's own leaves that have opened, 0..1. */
  leafReveal: number;
  /** Share of the crown's limbs that have grown, 0..1. */
  limbReveal: number;
  /**
   * Blade size against the plant's age. The blades are drawn inside the limb's
   * frame, so this counterweights `limbLength`: an old crown is made of many small
   * leaves on long arms, not a handful of huge ones on short ones.
   */
  leafScale: number;
  /**
   * How far each limb reaches, as a multiplier of its drawn length. This is the
   * crown's width: a young tree has short arms held close, an ancient one has long
   * ones laid out. It is the number that makes the tiers look different at a glance.
   */
  limbLength: number;
  /** Degrees each limb swings away from the trunk. Old trees spread; young ones do not. */
  limbSpreadDeg: number;
  /** Share of a limb's leaves that are carried, 0..1 - a thin young crown versus a dense old one. */
  crownDensity: number;
  /** Size of the terminal bud against the art: a sapling's is large, a tree's is a small tip. */
  budScale: number;
}

/** Stages at which the shapes below are pinned. Everything else interpolates. */
const KEYS = [0, 3, 8, 20, 42, 78, GROWTH_STAGES - 1];

/* Seed, sprout, sapling, young tree, adult, elder, ancient. */
/*
 * The last two pins are deliberately far apart. A tree that has been watered for
 * weeks should keep getting taller and larger, not level off into the same
 * silhouette at a different width: the ancient crown stands about a third taller
 * than the elder and reaches much farther out.
 */
const SCALE = [0.62, 0.7, 0.78, 0.88, 1.0, 1.4, 2.35];
const TRUNK_WIDTH = [0, 0, 0.06, 0.34, 0.62, 0.86, 1];
const TRUNK_OPACITY = [0, 0, 1, 1, 1, 1, 1];
const WOOD_TONE = [0, 0, 0.06, 0.45, 0.9, 1, 1];
/*
 * A seed already carries its first pair of leaves. The stem draws six leaves and
 * opens them at `(i + 1) / 6`, so a seed's 0.16 - the old first pin - was just
 * under the first threshold (0.1667): the bottom of the ladder rendered as a bare
 * green stick with every leaf switched off, and a plant that had just been reset
 * to zero looked like nothing had been drawn at all. 0.4 opens exactly two of the
 * six (0.167 and 0.333), and the pins above it climb so the stem is fully out
 * (0.55, three leaves) by the time the crown starts taking leaves away from it.
 */
const LEAF_REVEAL = [0.4, 0.55, 0.7, 0.8, 0.88, 0.95, 1];
const LIMB_REVEAL = [0, 0, 0, 0.34, 0.68, 0.9, 1];
/*
 * Small leaves on old wood. A mature tree is mostly trunk, branch and air; the
 * old curve left the blades about the same size as a sapling's, which is why a
 * tree in its last tiers still read as a seedling photographed close up.
 */
const LEAF_SCALE = [1.05, 0.96, 0.82, 0.68, 0.56, 0.48, 0.42];
const LIMB_LENGTH = [0.5, 0.56, 0.64, 0.74, 0.88, 1.18, 1.58];
const LIMB_SPREAD = [0, 1, 2, 3, 5, 9, 19];
const CROWN_DENSITY = [0, 0.2, 0.35, 0.55, 0.72, 0.92, 1];
const BUD_SCALE = [1, 1, 0.7, 0.55, 0.44, 0.36, 0.3];

const clampStage = (stage: number): number => {
  if (!Number.isFinite(stage)) return 0;
  return Math.max(0, Math.min(GROWTH_STAGES - 1, stage));
};

/** The tier a stage belongs to. */
export function growthTierAt(stage: number): GrowthTier {
  const s = clampStage(stage);
  for (const tier of GROWTH_TIERS) {
    if (s >= tier.from && s < tier.to) return tier;
  }
  return GROWTH_TIERS[GROWTH_TIERS.length - 1];
}

/** The care count as a stage, so one water is five steps up the ladder. */
export function growthStageFromPoints(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  const share = Math.min(1, points / GROWTH_POINTS);
  return clampStage((1 - (1 - share) ** CURVE) * GROWTH_STAGES);
}

/**
 * How long a growth run takes, in milliseconds, for a move of `delta` stages.
 *
 * A care action is a handful of stages on the ladder, and applying them at once
 * is what made a whole branch - and every leaf it crossed - arrive between two
 * frames. A run gives each threshold its own moment: long enough that the leaves
 * open one after another, short enough that a second watering still feels answered.
 */
export function growthTransitionMs(delta: number): number {
  const stages = Math.abs(Number.isFinite(delta) ? delta : 0);
  if (stages < 0.01) return 0;
  return Math.min(2800, Math.max(1200, 1200 + stages * 110));
}

/**
 * The stage at `progress` through a growth run.
 *
 * Linear on purpose: the stage is walking alongside the stream of light, which
 * climbs at a constant speed, so a leaf opens when the stream reaches it rather
 * than all of the growth landing while the light is still at the foot. The
 * endpoints are exact - the run always starts on the old stage and ends on the
 * stage care earned.
 */
export function growthStageAlong(from: number, to: number, progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return from;
  if (progress >= 1) return to;
  return from + (to - from) * progress;
}

/** The two numbers a retargeted run needs to stay continuous. */
export interface GrowthResume {
  /** The stage the resumed timeline starts from, so the light front keeps its place. */
  fromStage: number;
  /** How much of the new timeline is still ahead, 1 - progress. */
  remainingShare: number;
}

/**
 * Continue a growth run when care arrives before the last one has finished.
 *
 * The old code restarted the run at the new stage and sent the light back to the
 * root. Here the light front (`progress`) is kept. The stage at that same front
 * has to stay on what is already drawn (`shownStage`), so the timeline is solved
 * backwards for the start stage:
 *
 *   shown = from + (target - from) * progress
 *
 * The result is allowed below the ladder: it is only a point on the resumed
 * timeline, never a stage that is drawn. This keeps the stream, the plant and the
 * new care moving together instead of resetting the light.
 */
export function resumeGrowth(
  shownStage: number,
  targetStage: number,
  progress: number,
): GrowthResume {
  const shown = clampStage(shownStage);
  const target = clampStage(targetStage);
  const p = unit(progress);
  if (p <= 0) return { fromStage: shown, remainingShare: 1 };
  if (p >= 1) return { fromStage: shown, remainingShare: 0 };
  return {
    fromStage: (shown - target * p) / (1 - p),
    remainingShare: 1 - p,
  };
}

/** Clamp a number into the unit interval, with nonsense treated as zero. */
function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * How much of one crown arm has grown at `progress` through a growth run.
 *
 * The light reaches a branch when it passes the height the branch leaves the
 * trunk: an arm low on the trunk starts before one near the tip, and each takes a
 * short share of the run to reach the shape the stage already decided for it.
 * Lower arms finish early, so the run reads as the stream climbing the stem and
 * opening the crown from the bottom up rather than every branch swelling at once.
 *
 * `attachmentT` is the arm's height on the stem, 0 at the soil and 1 at the tip.
 * `from` and `to` are the arm's reveal at the ends of the run. The endpoints are
 * exact: a care action always leaves every arm on its predetermined target.
 */
export function limbGrowAlong(
  attachmentT: number,
  from: number,
  to: number,
  progress: number,
): number {
  const before = unit(from);
  const target = Math.max(before, unit(to));
  if (!Number.isFinite(progress) || progress <= 0) return before;
  if (progress >= 1) return target;
  const at = unit(attachmentT);
  // The stream passes the arm's socket just before its own height, then gives the
  // arm a share of the run to reach out. An arm near the tip has less run left, so
  // its window is clipped by the end of the stream instead of growing past it.
  const start = Math.max(0, at - 0.02);
  const end = Math.min(1, start + 0.2 + 0.05 * (1 - at));
  const reach = unit((progress - start) / Math.max(0.001, end - start));
  return before + (target - before) * reach;
}

/** Linear read of a pinned curve, clamped at both ends. */
function sample(curve: readonly number[], stage: number): number {
  if (stage <= KEYS[0]) return curve[0];
  for (let i = 1; i < KEYS.length; i += 1) {
    if (stage <= KEYS[i]) {
      const span = KEYS[i] - KEYS[i - 1];
      const t = span <= 0 ? 0 : (stage - KEYS[i - 1]) / span;
      return curve[i - 1] + (curve[i] - curve[i - 1]) * t;
    }
  }
  return curve[curve.length - 1];
}

/** Everything the drawing needs to render one stage. */
export function growthProfile(stage: number): GrowthProfile {
  const s = clampStage(stage);
  return {
    stage: s,
    tier: growthTierAt(s),
    scale: sample(SCALE, s),
    trunkWidth: sample(TRUNK_WIDTH, s),
    trunkOpacity: sample(TRUNK_OPACITY, s),
    woodTone: sample(WOOD_TONE, s),
    leafReveal: sample(LEAF_REVEAL, s),
    limbReveal: sample(LIMB_REVEAL, s),
    leafScale: sample(LEAF_SCALE, s),
    limbLength: sample(LIMB_LENGTH, s),
    limbSpreadDeg: sample(LIMB_SPREAD, s),
    crownDensity: sample(CROWN_DENSITY, s),
    budScale: sample(BUD_SCALE, s),
  };
}
