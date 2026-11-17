/**
 * T04 Mutation — vocabulary.
 *
 * A mutation is data: a trigger, an effect, a maintenance cost and one visual
 * signature. Nothing here decides *how* a plant acquires one; that is the
 * service's job. The eight growth categories are the ones DESIGN T04 names for
 * adaptive pressure.
 */

export const MUTATION_CATEGORIES = [
  'root',
  'stem',
  'leaf',
  'flower',
  'spore_sac',
  'vine',
  'defense',
  'storage',
] as const;

export type MutationCategory = (typeof MUTATION_CATEGORIES)[number];

export type MutationKind = 'cosmetic' | 'structural' | 'expressive' | 'ability' | 'stat';

/** Target families the renderers understand (what organs a style touches). */
export const MUTATION_VISUAL_TARGETS = ['foliage', 'woody', 'seed', 'bloom', 'whole'] as const;
export type MutationVisualTarget = (typeof MUTATION_VISUAL_TARGETS)[number];

/** Procedural figures a renderer can draw inside a style. */
export const MUTATION_VISUAL_PATTERNS = [
  'none',
  'mottle',
  'spots',
  'stripes',
  'veins',
  'sheen',
  'glow',
] as const;
export type MutationVisualPattern = (typeof MUTATION_VISUAL_PATTERNS)[number];

/** Wire target: 'bark' is the old name for the woody family. */
export type MutationWireVisualTarget = 'foliage' | 'woody' | 'seed' | 'bloom' | 'whole' | 'bark';

/**
 * What one mutation looks like (`config/mutation_visuals.json`).
 *
 * Appearance is data, not code: adding a mutation adds one style record and no
 * renderer change. Colours are linear multipliers on the organ texture, so the
 * plant still reads as a plant and stacked mutations multiply; `caps` bounds
 * the result.
 */
export interface MutationVisualStyle {
  /** The mutation this style belongs to. */
  id: string;
  /** 1..N in declaration order; what ships as `visualSignature`. */
  ordinal: number;
  target: MutationVisualTarget;
  pattern: MutationVisualPattern;
  patternScale: number;
  tint: [number, number, number];
  tintStrength: number;
  variegation: number;
  variegationColor: [number, number, number];
  glow: number;
  glowColor: [number, number, number];
  /** Woody tube radius scale. 1 = unchanged. */
  barkThickness: number;
  /** How far woody texture is darkened toward shadow. 0..1. */
  barkDarken: number;
  /** Thorn geometry on woody tubes. 0 = none, 1 = dense. */
  spines: number;
}

/** Ceilings a composed look may reach, so stacking cannot blow a channel out. */
export interface MutationVisualCaps {
  minTint: number;
  maxTint: number;
  maxTintStrength: number;
  maxVariegation: number;
  maxGlow: number;
  maxBarkThickness: number;
  maxBarkDarken: number;
  maxSpines: number;
  /** Extra style strength per level above the first. */
  levelVisualGain: number;
}

export interface MutationTriggers {
  /** Relative weight inside the eligible pool. 0 means "never on its own". */
  growthChanceWeight: number;
  /** Environment gates. Absent means "no constraint". */
  minLight?: number;
  maxLight?: number;
  minMoisture?: number;
  maxMoisture?: number;
  minMinerals?: number;
  /** Weather states this mutation can appear in. Absent means any. */
  weather?: string[];
  /** Day or night only. Absent means any. */
  timeOfDay?: 'day' | 'night';
}

/**
 * Effects the simulation actually reads. An effect this server does not
 * implement must not appear in config, so a mutation never promises something
 * the game ignores.
 */
export interface MutationEffects {
  /** Energy gained per second of light (diet / metabolism). */
  photosynthesisMultiplier?: number;
  /** Rate at which stored energy is spent on upkeep (metabolism). */
  energyUpkeepMultiplier?: number;
  growthCostMultiplier?: number;
  rerootSpeedMultiplier?: number;
  /** Growth speed: divides the quoted growth time (values > 1 grow faster). */
  growthSpeedMultiplier?: number;
  /** Canopy node radius and segment-length scale (plant size). */
  sizeMultiplier?: number;
  /** Root node radius and segment-length scale (root size). */
  rootSizeMultiplier?: number;
  /** Node types this mutation makes growable where the base rules refuse. */
  unlockNodeTypes?: string[];
  /** Petals drawn on a flower (base 6). */
  petalCount?: number;
  /** Leaf blade size scale. */
  leafScaleMultiplier?: number;
  /** Seed body size scale. */
  seedScaleMultiplier?: number;
  /** Stored water capacity scale (seeds start full of it). */
  waterCapacityMultiplier?: number;
  /** Stored mineral capacity scale. */
  mineralCapacityMultiplier?: number;
  /**
   * Shape bias the name promises: 0..1 toward vertical for a columnar habit.
   * Read by the growth-direction bias, so branches really rise.
   */
  verticalBias?: number;
  /** Shape bias the name promises: 0..1 toward drooping for fronds. */
  droopingBias?: number;
  /**
   * Share (0..0.9) of the stored water/mineral gate a clonal network covers for
   * growth out of root tissue: the network the rhizome belongs to subsidises the
   * new ramet instead of the shoot paying its own way.
   */
  storedResourceSharing?: number;
}

/**
 * Effect keys a level-up card may raise. Every one of them is a multiplier, so
 * a card composes with the mutation's base effect by multiplication and the
 * same accumulation rules apply at every level.
 */
export const MULTIPLIER_EFFECT_KEYS = [
  'photosynthesisMultiplier',
  'energyUpkeepMultiplier',
  'growthCostMultiplier',
  'rerootSpeedMultiplier',
  'growthSpeedMultiplier',
  'sizeMultiplier',
  'rootSizeMultiplier',
  'leafScaleMultiplier',
  'seedScaleMultiplier',
  'waterCapacityMultiplier',
  'mineralCapacityMultiplier',
] as const;

export type MultiplierEffectKey = (typeof MULTIPLIER_EFFECT_KEYS)[number];

/** One card a level-up can offer: an effect key and the step it adds. */
export interface MutationLevelCard {
  id: MultiplierEffectKey;
  label: string;
  /** Multiplier applied to that effect for every level the card was taken. */
  step: number;
}

/**
 * Level-up rules (T04). Mutations start at level 1 and are raised by the
 * player, who spends stored resources and picks one card per level from the
 * cards the mutation itself can grow into. Nothing here is random except which
 * cards are put in front of the player.
 */
export interface MutationLevelRules {
  maxLevel: number;
  cardsPerOffer: number;
  /**
   * Cost of reaching level 2: an absolute part plus a part that scales with the
   * plant's stored biomass, so a seedling can afford its first level and a
   * mature plant pays in proportion to what it holds.
   */
  baseEnergyCost: number;
  energyCostPerLevel: number;
  energyCostPerBiomass: number;
  energyCostPerBiomassPerLevel: number;
  /** Biomass the level takes out of the body, as a share of total biomass. */
  baseBiomassFraction: number;
  biomassFractionPerLevel: number;
  /** At least one unit of tissue is always spent, however small the plant. */
  minBiomassCost: number;
  /** Extra maintenance fraction per level above 1 (0.15 = +15% each). */
  upkeepPerLevel: number;
  /** Effect key -> step one card applies, in that effect's own units. */
  cardSteps: Partial<Record<MultiplierEffectKey, number>>;
  /** Effect key -> the words the card shows. */
  cardLabels: Partial<Record<MultiplierEffectKey, string>>;
}

export interface MutationMovement {
  /** Multiplies the T06 reroot crawl speed. Stored now, read by T06. */
  rerootSpeed: number;
  translocate: boolean;
  parts: string[];
  drift: number;
}

export interface MutationShed {
  cooldownS: number;
  biomassPenaltyFraction: number;
}

export interface MutationDefinition {
  id: string;
  name: string;
  kind: MutationKind;
  geneTags: string[];
  /** Ordinal of the style in config order (1..N), shipped as visualSignature. */
  visualSignature: number;
  /** [variegation, tint strength, glow] - a compact echo of the style. */
  visualParams: [number, number, number];
  /** Wire target derived from the style's organ family. */
  visualTarget: MutationWireVisualTarget;
  /** The resolved appearance record this mutation paints. */
  visualStyle: MutationVisualStyle;
  triggers: MutationTriggers;
  maintenance: { energyPerSecond: number; biomassPerSecond: number };
  effects: MutationEffects;
  movement: MutationMovement;
  shed: MutationShed;
  /**
   * Part of the starter pool: simple, low-upkeep mutations a new plant can roll
   * before it has any mutation at all. The first mutation is always one of these.
   */
  starter?: boolean;
}

export interface MutationsConfig {
  chancePerGrowth: number;
  adaptivePressureEnabled: boolean;
  decayHalfLifeTicks: number;
  maxPressureMultiplier: number;
  defaultShedCooldownS: number;
  /** Applied to every mutation's energy maintenance (mutations cost more). */
  maintenanceScale: number;
  /** Extra upkeep per affected node (a mutation on a big plant costs more). */
  upkeepNodeScale: number;
  /** Extra upkeep per unit of affected node biomass. */
  upkeepBiomassScale: number;
  /** Ceiling on the node/biomass upkeep multiplier. */
  upkeepMaxMultiplier: number;
  /**
   * Biomass level below which unpaid mutation upkeep stops taking tissue.
   *
   * Mutation upkeep never removes a mutation and never kills the plant: an
   * unpaid bill simply holds the plant at this floor until it earns again. Only
   * the player sheds a mutation.
   */
  upkeepBiomassFloor: number;
  /**
   * Share of the over-quota excess lost per second after the body outgrows its
   * form (a size mutation was shed or lost). Tissue drains; it never snaps.
   */
  oversizeWiltPerS: number;
  /**
   * Share of stored water, minerals and energy above capacity lost per second
   * while the plant is over its form's capacity. A leak, not a clamp.
   */
  oversizeLeakPerS: number;
  /** Level-up rules shared by every mutation. */
  levelUp: MutationLevelRules;
  /** Look ceilings (C4/C7): no stack can exceed these. */
  /**
   * Look ceilings (C4/C7): no stack can exceed these. Optional so a partial
   * test fixture needs no look data; the loader always supplies it.
   */
  visualCaps?: MutationVisualCaps;
  /** Organ family -> node types it covers. 'whole' is the empty list. */
  visualTargets?: Record<string, string[]>;
  /** Every style, by mutation id. */
  visualStyles?: Record<string, MutationVisualStyle>;
  definitions: MutationDefinition[];
  /** Which growth category a node type counts as investment in. */
  categoryForNodeType: Record<string, MutationCategory>;
  /** Growth category -> gene tags it biases. */
  categoryToTags: Record<string, string[]>;
}

/** What the world can tell a mutation roll about the ground it happened in. */
export interface MutationEnvironment {
  light: number;
  moisture: number;
  minerals: number;
  weather: string;
  timeOfDay: 'day' | 'night';
}

export function emptyPressure(): Record<MutationCategory, number> {
  return {
    root: 0,
    stem: 0,
    leaf: 0,
    flower: 0,
    spore_sac: 0,
    vine: 0,
    defense: 0,
    storage: 0,
  };
}
