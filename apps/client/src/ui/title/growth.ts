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
  /** How much of the crown exists yet, 0..1. */
  treeOpacity: number;
  /** Share of the stem's own leaves that have opened, 0..1. */
  leafReveal: number;
  /** Share of the crown's limbs that have grown, 0..1. */
  limbReveal: number;
  /**
   * Blade size against the plant's age. The blades are drawn inside the limb's
   * frame, so this compensates for `limbLength`: apparent leaf size grows about
   * 1.6x over the whole ladder while the arms more than double.
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
}

/** Stages at which the shapes below are pinned. Everything else interpolates. */
const KEYS = [0, 3, 8, 20, 42, 78, GROWTH_STAGES - 1];

/* Seed, sprout, sapling, young tree, adult, elder, ancient. */
const SCALE = [0.62, 0.7, 0.78, 0.88, 1.0, 1.16, 1.32];
const TRUNK_WIDTH = [0, 0, 0.06, 0.34, 0.62, 0.86, 1];
const TRUNK_OPACITY = [0, 0, 1, 1, 1, 1, 1];
const TREE_OPACITY = [0, 0, 0, 0.5, 1, 1, 1];
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
const LEAF_SCALE = [1.15, 1.08, 1.02, 0.96, 0.92, 0.88, 0.84];
const LIMB_LENGTH = [0.5, 0.56, 0.64, 0.74, 0.85, 1.02, 1.18];
const LIMB_SPREAD = [0, 1, 2, 3, 4, 6, 7];
const CROWN_DENSITY = [0, 0.2, 0.35, 0.55, 0.72, 0.92, 1];

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
    treeOpacity: sample(TREE_OPACITY, s),
    leafReveal: sample(LEAF_REVEAL, s),
    limbReveal: sample(LIMB_REVEAL, s),
    leafScale: sample(LEAF_SCALE, s),
    limbLength: sample(LIMB_LENGTH, s),
    limbSpreadDeg: sample(LIMB_SPREAD, s),
    crownDensity: sample(CROWN_DENSITY, s),
  };
}
