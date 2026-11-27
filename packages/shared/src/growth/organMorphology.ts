import type { NodeType, OrganMorphologyOverride } from './types.ts';

/**
 * How one organ is drawn at one point in its growth.
 *
 * The renderers used to ask only "what colour is this node type?" and drew every
 * non-leaf organ as the same tapered tube. These frames are the missing
 * botanical data: a blade opens across its width, a root extends and thickens,
 * a tuber swells into a storage body and a capsule swells before it opens.
 *
 * `length` and `width` are multipliers against the organ's mature size. Detail
 * is the share of the organ's surface features (lenticels, hairs, veins, eyes,
 * rings) that should be present; it never changes gameplay geometry.
 */
export interface OrganStageFrame {
  readonly length: number;
  readonly width: number;
  readonly detail: number;
}

export type OrganFamily =
  | 'seed'
  | 'root'
  | 'shoot'
  | 'runner'
  | 'storage'
  | 'foliage'
  | 'reproductive';

export type OrganCrossSection = 'round' | 'ribbed' | 'hollow' | 'flattened' | 'lobed';

export interface OrganMorphology {
  readonly type: NodeType;
  readonly family: OrganFamily;
  readonly crossSection: OrganCrossSection;
  readonly sides: number;
  readonly taperExponent: number;
  /** Deterministic sideways bow, as a fraction of the segment length. */
  readonly bend: number;
  readonly tip: string;
  readonly appendages: readonly string[];
  /**
   * Legacy visual type codes used by the packed mesh path. They are retained as
   * colour families, not as shape definitions: the morphology above owns shape.
   */
  readonly visualType: number;
  /** One frame per band: initiation, juvenile, expansion, mature. */
  readonly stages: readonly [OrganStageFrame, OrganStageFrame, OrganStageFrame, OrganStageFrame];
  /** Human-readable description of what is visible in each band. */
  readonly stageLabels: readonly [string, string, string, string];
}

const frame = (length: number, width: number, detail: number): OrganStageFrame => ({
  length,
  width,
  detail,
});

/**
 * The botanical registry.
 *
 * It is exhaustive on purpose: `satisfies Record<NodeType, ...>` makes adding a
 * node type without deciding how it grows a compile error, which is what keeps
 * the mesh pass, the WebGPU pass and the SDF fallback from silently turning a
 * new organ into a grey capsule.
 */
export const ORGAN_MORPHOLOGY = {
  seed: {
    type: 'seed',
    family: 'seed',
    crossSection: 'lobed',
    sides: 14,
    taperExponent: 1,
    bend: 0,
    tip: 'rounded hilum',
    appendages: ['hilum', 'micropyle', 'split seam'],
    visualType: 4,
    stages: [
      frame(0.72, 0.9, 0.15),
      frame(0.84, 1.0, 0.45),
      frame(0.94, 1.08, 0.8),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['imbibed', 'swollen split', 'radicle breach', 'empty husk'],
  },
  radicle: {
    type: 'radicle',
    family: 'root',
    crossSection: 'round',
    sides: 8,
    taperExponent: 1,
    bend: 0.06,
    tip: 'root cap',
    appendages: ['root cap', 'root hairs'],
    visualType: 0,
    stages: [
      frame(0.08, 0.55, 0.05),
      frame(0.46, 0.72, 0.35),
      frame(0.82, 0.9, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['peg', 'elongation', 'hairs and cap', 'taproot transition'],
  },
  root: {
    type: 'root',
    family: 'root',
    crossSection: 'round',
    sides: 8,
    taperExponent: 1,
    bend: 0.12,
    tip: 'root cap',
    appendages: ['root cap', 'lenticels', 'bark fissures'],
    visualType: 0,
    stages: [
      frame(0.06, 0.6, 0.05),
      frame(0.4, 0.78, 0.3),
      frame(0.78, 0.92, 0.65),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['tip cap', 'elongation', 'secondary thickening', 'woody bark'],
  },
  lateral_root: {
    type: 'lateral_root',
    family: 'root',
    crossSection: 'round',
    sides: 7,
    taperExponent: 0.95,
    bend: 0.22,
    tip: 'fine root tip',
    appendages: ['collar', 'root hairs'],
    visualType: 0,
    stages: [
      frame(0.04, 0.4, 0.05),
      frame(0.36, 0.62, 0.35),
      frame(0.76, 0.88, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['pericycle bulge', 'emergence', 'spread and hairs', 'tapered woody'],
  },
  stem: {
    type: 'stem',
    family: 'shoot',
    crossSection: 'ribbed',
    sides: 9,
    taperExponent: 1.15,
    bend: 0.05,
    tip: 'growing tip',
    appendages: ['node bands', 'lenticels'],
    visualType: 1,
    stages: [
      frame(0.12, 0.55, 0.05),
      frame(0.5, 0.75, 0.4),
      frame(0.84, 0.92, 0.75),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['hypocotyl hook', 'internode extension', 'ridged green', 'lower lignification'],
  },
  branch: {
    type: 'branch',
    family: 'shoot',
    crossSection: 'round',
    sides: 8,
    taperExponent: 1.15,
    bend: 0.07,
    tip: 'bud',
    appendages: ['branch collar', 'bud scales', 'bark plates'],
    visualType: 1,
    stages: [
      frame(0.06, 0.42, 0.05),
      frame(0.4, 0.66, 0.35),
      frame(0.8, 0.9, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['bud break', 'angular offshoot', 'secondary growth', 'bark plates'],
  },
  trunk: {
    type: 'trunk',
    family: 'shoot',
    crossSection: 'round',
    sides: 10,
    taperExponent: 1.15,
    bend: 0.025,
    tip: 'leader',
    appendages: ['basal flare', 'lenticels', 'bark plates'],
    visualType: 1,
    stages: [
      frame(0.16, 0.42, 0.05),
      frame(0.52, 0.68, 0.35),
      frame(0.82, 0.9, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['whip', 'thickening', 'bark plates', 'mature flare'],
  },
  rhizome: {
    type: 'rhizome',
    family: 'runner',
    crossSection: 'ribbed',
    sides: 8,
    taperExponent: 0.95,
    bend: 0.16,
    tip: 'white growing tip',
    appendages: ['scale leaves', 'buds', 'adventitious roots'],
    visualType: 0,
    stages: [
      frame(0.05, 0.5, 0.05),
      frame(0.4, 0.72, 0.35),
      frame(0.8, 0.92, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['bud', 'white tip', 'segmented runner', 'corky rooted nodes'],
  },
  culm: {
    type: 'culm',
    family: 'shoot',
    crossSection: 'hollow',
    sides: 8,
    taperExponent: 1.05,
    bend: 0.025,
    tip: 'sheath',
    appendages: ['node rings', 'leaf sheath', 'silica band'],
    visualType: 2,
    stages: [
      frame(0.14, 0.5, 0.05),
      frame(0.5, 0.74, 0.4),
      frame(0.84, 0.92, 0.75),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['sheath', 'joint extension', 'hollow internodes', 'banded mature culm'],
  },
  floating_leaf: {
    type: 'floating_leaf',
    family: 'foliage',
    crossSection: 'flattened',
    sides: 6,
    taperExponent: 1,
    bend: 0,
    tip: 'notched pad',
    appendages: ['notch', 'upturned rim', 'radial veins'],
    visualType: 3,
    stages: [
      frame(0.18, 0.25, 0.05),
      frame(0.5, 0.55, 0.35),
      frame(0.82, 0.82, 0.75),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['submerged bud', 'rise', 'unfurl', 'mature pad'],
  },
  pneumatophore: {
    type: 'pneumatophore',
    family: 'root',
    crossSection: 'lobed',
    sides: 7,
    taperExponent: 1,
    bend: 0.2,
    tip: 'spongy peg',
    appendages: ['spongy tip', 'lenticels'],
    visualType: 0,
    stages: [
      frame(0.04, 0.4, 0.05),
      frame(0.38, 0.62, 0.35),
      frame(0.78, 0.88, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['underwater bud', 'upward knee', 'porous peg', 'lenticelled root'],
  },
  thorn: {
    type: 'thorn',
    family: 'shoot',
    crossSection: 'round',
    sides: 6,
    taperExponent: 1.15,
    bend: 0.04,
    tip: 'hardened point',
    appendages: ['woody base'],
    visualType: 1,
    stages: [
      frame(0.08, 0.45, 0.05),
      frame(0.42, 0.7, 0.4),
      frame(0.78, 0.9, 0.75),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['primordium', 'hardened cone', 'curved spine', 'woody base'],
  },
  stolon: {
    type: 'stolon',
    family: 'runner',
    crossSection: 'ribbed',
    sides: 7,
    taperExponent: 1,
    bend: 0.1,
    tip: 'runner tip',
    appendages: ['long internodes', 'nodal roots', 'plantlet'],
    visualType: 2,
    stages: [
      frame(0.05, 0.4, 0.05),
      frame(0.38, 0.62, 0.35),
      frame(0.78, 0.9, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['axillary bud', 'horizontal run', 'nodal roots', 'plantlet'],
  },
  tuber: {
    type: 'tuber',
    family: 'storage',
    crossSection: 'lobed',
    sides: 10,
    taperExponent: 0.95,
    bend: 0,
    tip: 'storage body',
    appendages: ['eyes', 'lenticels'],
    visualType: 0,
    stages: [
      frame(0.12, 0.35, 0.05),
      frame(0.46, 0.58, 0.35),
      frame(0.78, 0.84, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['stolon tip swell', 'lenticels', 'starch body', 'multiple eyes'],
  },
  vine: {
    type: 'vine',
    family: 'shoot',
    crossSection: 'round',
    sides: 7,
    taperExponent: 1.05,
    bend: 0.12,
    tip: 'searching tip',
    appendages: ['tendril', 'coil'],
    visualType: 2,
    stages: [
      frame(0.08, 0.45, 0.05),
      frame(0.42, 0.68, 0.35),
      frame(0.8, 0.9, 0.7),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['searching tip', 'contact', 'helix coil', 'mature cord'],
  },
  leaf: {
    type: 'leaf',
    family: 'foliage',
    crossSection: 'flattened',
    sides: 4,
    taperExponent: 1,
    bend: 0,
    tip: 'leaf tip',
    appendages: ['petiole', 'midrib', 'serration', 'veins'],
    visualType: 3,
    stages: [
      frame(0.08, 0.18, 0.05),
      frame(0.42, 0.42, 0.35),
      frame(0.8, 0.82, 0.75),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['bud', 'unfurl', 'expansion and veins', 'mature blade'],
  },
  cotyledon: {
    type: 'cotyledon',
    family: 'foliage',
    crossSection: 'flattened',
    sides: 4,
    taperExponent: 1,
    bend: 0,
    tip: 'fleshy seed leaf',
    appendages: ['petiole', 'fleshy midrib'],
    visualType: 7,
    stages: [
      frame(0.06, 0.3, 0.05),
      frame(0.4, 0.62, 0.35),
      frame(0.8, 0.92, 0.75),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['folded', 'opening', 'full oval', 'yellow and shed'],
  },
  flower: {
    type: 'flower',
    family: 'reproductive',
    crossSection: 'lobed',
    sides: 8,
    taperExponent: 1,
    bend: 0,
    tip: 'open bloom',
    appendages: ['sepals', 'petals', 'anthers', 'stigma'],
    visualType: 5,
    stages: [
      frame(0.18, 0.22, 0.05),
      frame(0.48, 0.45, 0.35),
      frame(0.82, 0.86, 0.75),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['bud', 'sepal split', 'petal spread', 'open bloom'],
  },
  spore_sac: {
    type: 'spore_sac',
    family: 'reproductive',
    crossSection: 'lobed',
    sides: 8,
    taperExponent: 1,
    bend: 0,
    tip: 'operculum',
    appendages: ['stalk', 'capsule', 'annulus', 'operculum'],
    visualType: 6,
    stages: [
      frame(0.14, 0.24, 0.05),
      frame(0.44, 0.5, 0.35),
      frame(0.8, 0.88, 0.75),
      frame(1.0, 1.0, 1.0),
    ],
    stageLabels: ['stalk', 'capsule swell', 'lid and ring', 'rupture and release'],
  },
} as const satisfies Record<NodeType, OrganMorphology>;

/**
 * The live registry: compiled defaults with config overrides applied.
 *
 * Kept separate from the literal so `ORGAN_MORPHOLOGY` remains a stable,
 * exhaustive compile-time table (and the tests can assert the defaults) while
 * every renderer reads the same config-loaded answer.
 */
let activeMorphology: Record<NodeType, OrganMorphology> = { ...ORGAN_MORPHOLOGY };

const CROSS_SECTIONS: readonly OrganCrossSection[] = [
  'round',
  'ribbed',
  'hollow',
  'flattened',
  'lobed',
];

const ORGAN_FAMILIES: readonly OrganFamily[] = [
  'seed',
  'root',
  'shoot',
  'runner',
  'storage',
  'foliage',
  'reproductive',
];

/**
 * The growth bands shared by the labels and the drawn frames.
 *
 * The frame interpolation used equal thirds while `organStageName` changed at
 * 15/45/80%. A shoot at 50% was drawn between juvenile and expansion while its
 * label already said expansion. These are the one set of boundaries.
 */
export const ORGAN_STAGE_BOUNDARIES = [0, 0.15, 0.45, 0.8, 1] as const;

function sanitizeText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, 80)
    : fallback;
}

function sanitizeStringList(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 48))
    .slice(0, 12);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeStageFrame(value: readonly number[] | undefined): OrganStageFrame | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [length, width, detail] = value;
  if (![length, width, detail].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  if (length <= 0 || width <= 0) return null;
  return frame(length, width, Math.min(1, Math.max(0, detail)));
}

/**
 * Apply the config's organ table over the compiled registry.
 *
 * Unknown organs and malformed fields are ignored one by one rather than
 * rejecting the whole table: a typo in one entry must not turn every organ back
 * into a grey capsule. Call with nothing to restore the compiled defaults.
 */
export function setOrganMorphologyOverrides(
  overrides: Record<string, OrganMorphologyOverride> | undefined,
): void {
  const next: Record<NodeType, OrganMorphology> = { ...ORGAN_MORPHOLOGY };
  if (overrides && typeof overrides === 'object') {
    for (const [rawType, override] of Object.entries(overrides)) {
      const type = rawType.toLowerCase() as NodeType;
      const base = ORGAN_MORPHOLOGY[type];
      if (!base || !override || typeof override !== 'object') continue;
      const crossSection = CROSS_SECTIONS.includes(override.cross_section as OrganCrossSection)
        ? (override.cross_section as OrganCrossSection)
        : base.crossSection;
      const sides =
        typeof override.sides === 'number' && Number.isFinite(override.sides)
          ? Math.min(24, Math.max(3, Math.round(override.sides)))
          : base.sides;
      const taperExponent =
        typeof override.taper_exponent === 'number' &&
        Number.isFinite(override.taper_exponent) &&
        override.taper_exponent > 0
          ? Math.min(4, Math.max(0.5, override.taper_exponent))
          : base.taperExponent;
      const bend =
        typeof override.bend === 'number' && Number.isFinite(override.bend)
          ? Math.min(0.5, Math.max(0, override.bend))
          : base.bend;
      const family = ORGAN_FAMILIES.includes(override.family as OrganFamily)
        ? (override.family as OrganFamily)
        : base.family;
      const tip = sanitizeText(override.tip, base.tip);
      const appendages = sanitizeStringList(override.appendages, base.appendages);
      const visualType =
        typeof override.visual_type === 'number' &&
        Number.isFinite(override.visual_type) &&
        override.visual_type >= 0
          ? Math.min(15, Math.round(override.visual_type))
          : base.visualType;
      const stageLabels = Array.isArray(override.stage_labels)
        ? override.stage_labels.map((label, index) =>
            sanitizeText(label, base.stageLabels[index] ?? base.stageLabels[0]),
          )
        : [];
      const validLabels =
        stageLabels.length === 4
          ? (stageLabels as [string, string, string, string])
          : base.stageLabels;
      const stages = Array.isArray(override.stages)
        ? override.stages.map((stage) => sanitizeStageFrame(stage))
        : [];
      const validStages =
        stages.length === 4 && stages.every((stage): stage is OrganStageFrame => stage !== null)
          ? (stages as [OrganStageFrame, OrganStageFrame, OrganStageFrame, OrganStageFrame])
          : base.stages;
      next[type] = {
        ...base,
        family,
        crossSection,
        sides,
        taperExponent,
        bend,
        tip,
        appendages,
        visualType,
        stages: validStages,
        stageLabels: validLabels,
      };
    }
  }
  activeMorphology = next;
}

/** The morphology for a node type, with a safe stem-shaped fallback for old data. */
export function organMorphologyFor(nodeType: string | undefined): OrganMorphology {
  const key = (nodeType ?? 'stem').toLowerCase() as NodeType;
  return activeMorphology[key] ?? activeMorphology.stem;
}

/** Every registry entry, in the node-type order the game grows them. */
export function allOrganMorphologies(): readonly OrganMorphology[] {
  return Object.values(activeMorphology);
}

export type OrganStageName = 'initiation' | 'juvenile' | 'expansion' | 'mature';

/** The four growth bands shared by every organ. */
export function organStageName(progress: number): OrganStageName {
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
  if (t < 0.15) return 'initiation';
  if (t < 0.45) return 'juvenile';
  if (t < 0.8) return 'expansion';
  return 'mature';
}

export function organStageIndex(progress: number): 0 | 1 | 2 | 3 {
  switch (organStageName(progress)) {
    case 'initiation':
      return 0;
    case 'juvenile':
      return 1;
    case 'expansion':
      return 2;
    default:
      return 3;
  }
}

/**
 * The frame an organ is drawn with at this progress.
 *
 * The organ's own frames are interpolated between the four bands so a growing
 * part moves continuously rather than stepping at 15/45/80%. A cotyledon that is
 * old enough to shed is the one exception: its mature frame is deliberately
 * allowed to yellow and shrink in the renderer, not in this pure geometry rule.
 */
export function organStageFrame(nodeType: string, progress: number): OrganStageFrame {
  const morphology = organMorphologyFor(nodeType);
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
  const index = organStageIndex(t);
  const start = ORGAN_STAGE_BOUNDARIES[index] ?? 0;
  const end = ORGAN_STAGE_BOUNDARIES[index + 1] ?? 1;
  const span = Math.max(1e-9, end - start);
  const mix = index >= 3 ? 1 : Math.min(1, Math.max(0, (t - start) / span));
  const a = morphology.stages[index];
  const b = morphology.stages[Math.min(3, index + 1)];
  const lerp = (x: number, y: number): number => x + (y - x) * mix;
  return {
    length: lerp(a.length, b.length),
    width: lerp(a.width, b.width),
    detail: lerp(a.detail, b.detail),
  };
}

/** The stage label for a node at this progress, for diagnostics and capture names. */
export function organStageLabel(nodeType: string, progress: number): string {
  return organMorphologyFor(nodeType).stageLabels[organStageIndex(progress)];
}
