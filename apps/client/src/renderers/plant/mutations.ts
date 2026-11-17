/**
 * Mutation appearance (T04, ADR-054/ADR-059).
 *
 * T04 owns how a plant acquires a mutation. This module owns what a renderer
 * draws for one, and it is data: `config/mutation_visuals.json` carries a style
 * record per mutation id, so adding a mutation is a config edit (RULE_3).
 *
 * A plant holds several mutations at once, so the renderer does not pick a
 * single "signature" any more (that was C1: a second mutation never appeared).
 * Every held mutation contributes its own style, each style names the organ
 * family it touches, and the per-organ result is composed here: tints multiply,
 * variegation and darkening stack as `1 - product(1 - v)`, glow adds, bark
 * thickness adds its excess, and everything is clamped by `caps` so a stack can
 * neither blow a channel out (C4) nor thicken without bound (C7).
 */

export const MUTATION_ORGAN_FAMILIES = ['foliage', 'woody', 'seed', 'bloom'] as const;
export type MutationOrganFamily = (typeof MUTATION_ORGAN_FAMILIES)[number];
/** What a style targets: one organ family, or the whole organism. */
export type MutationVisualTarget = MutationOrganFamily | 'whole';

export type MutationVisualPattern =
  | 'none'
  | 'mottle'
  | 'spots'
  | 'stripes'
  | 'veins'
  | 'sheen'
  | 'glow';

export interface MutationVisualStyle {
  id: string;
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
  /** Woody tube radius scale; geometry, applied by the mesh builders. */
  barkThickness: number;
  barkDarken: number;
  /** Thorn geometry on woody tubes, 0..1. */
  spines: number;
}

export interface MutationVisualCaps {
  minTint: number;
  maxTint: number;
  maxTintStrength: number;
  maxVariegation: number;
  maxGlow: number;
  maxBarkThickness: number;
  maxBarkDarken: number;
  maxSpines: number;
  /** Extra style strength per level above the first, so levels are visible. */
  levelVisualGain: number;
}

export const DEFAULT_MUTATION_VISUAL_CAPS: MutationVisualCaps = {
  minTint: 0.55,
  maxTint: 1.35,
  maxTintStrength: 0.9,
  maxVariegation: 0.8,
  maxGlow: 0.95,
  maxBarkThickness: 1.6,
  maxBarkDarken: 0.45,
  maxSpines: 1,
  levelVisualGain: 0.35,
};

/** Node type -> the organ family a mutation paints. */
const ORGAN_FAMILY: Record<string, MutationOrganFamily> = {
  root: 'woody',
  stem: 'woody',
  branch: 'woody',
  trunk: 'woody',
  vine: 'woody',
  leaf: 'foliage',
  cotyledon: 'foliage',
  seed: 'seed',
  flower: 'bloom',
  spore_sac: 'bloom',
};

export function organFamily(organ: string): MutationOrganFamily {
  return ORGAN_FAMILY[organ] ?? 'foliage';
}

/** One held mutation as the server reports it, or a rival's single pigment. */
export interface MutationLookSource {
  id?: string;
  /** Style ordinal (1..N) as shipped in `visualSignature`. */
  visualSignature?: number;
  /** [variegation, tint strength, glow] - the fallback when no style is known. */
  visualParams?: readonly number[];
  visualTarget?: string;
  /** 1 when absent; levels amplify a style's strength. */
  level?: number;
}

/** What one organ family is painted with, after composition. */
export interface MutationLook {
  /** Strongest style ordinal in the stack; 0 when nothing is held. */
  signature: number;
  tint: [number, number, number];
  tintStrength: number;
  variegation: number;
  variegationColor: [number, number, number];
  glow: number;
  glowColor: [number, number, number];
  pattern: MutationVisualPattern;
  patternScale: number;
  /** Woody tube radius scale (geometry). 1 = unchanged. */
  barkScale: number;
  barkDarken: number;
  spines: number;
}

/** A plant's composed appearance, one look per organ family. */
export interface MutationLookStack {
  looks: Record<MutationOrganFamily, MutationLook>;
  /**
   * Everything the plant is painted with, regardless of organ. A billboard draws
   * a whole plant as one disc, so it cannot pick a family: it uses this.
   */
  disc: MutationLook;
  signature: number;
}

export const NEUTRAL_LOOK: MutationLook = {
  signature: 0,
  tint: [1, 1, 1],
  tintStrength: 0,
  variegation: 0,
  variegationColor: [1, 1, 1],
  glow: 0,
  glowColor: [0.2, 0.75, 0.45],
  pattern: 'none',
  patternScale: 1,
  barkScale: 1,
  barkDarken: 0,
  spines: 0,
};

export const NEUTRAL_STACK: MutationLookStack = {
  looks: {
    foliage: NEUTRAL_LOOK,
    woody: NEUTRAL_LOOK,
    seed: NEUTRAL_LOOK,
    bloom: NEUTRAL_LOOK,
  },
  disc: NEUTRAL_LOOK,
  signature: 0,
};

let stylesById = new Map<string, MutationVisualStyle>();
let stylesByOrdinal = new Map<number, MutationVisualStyle>();
let caps: MutationVisualCaps = { ...DEFAULT_MUTATION_VISUAL_CAPS };

/**
 * Install the style table from `config/mutation_visuals.json`.
 *
 * Called once after the config loads. Without it the module still works: a
 * mutation falls back to the compact `visualParams` the server ships, so a
 * failed config fetch costs fidelity, not visibility.
 */
export function configureMutationVisuals(
  styles: readonly MutationVisualStyle[],
  nextCaps?: Partial<MutationVisualCaps>,
): void {
  stylesById = new Map();
  stylesByOrdinal = new Map();
  for (const style of styles) {
    stylesById.set(style.id, style);
    stylesByOrdinal.set(style.ordinal, style);
  }
  caps = { ...DEFAULT_MUTATION_VISUAL_CAPS, ...nextCaps };
}

export function mutationVisualCaps(): MutationVisualCaps {
  return caps;
}

export function mutationStyleById(id: string): MutationVisualStyle | undefined {
  return stylesById.get(id);
}

export function mutationStyleByOrdinal(ordinal: number): MutationVisualStyle | undefined {
  return stylesByOrdinal.get(ordinal);
}

export function mutationVisualStyleCount(): number {
  return stylesById.size;
}

const WIRE_TARGET_FAMILY: Record<string, MutationVisualTarget> = {
  foliage: 'foliage',
  woody: 'woody',
  bark: 'woody',
  seed: 'seed',
  bloom: 'bloom',
  whole: 'whole',
  none: 'whole',
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** A style rebuilt from the compact wire params, used when config is missing. */
function fallbackStyle(source: MutationLookSource): MutationVisualStyle | null {
  if (typeof source.visualSignature !== 'number' && !source.visualParams) return null;
  const params = source.visualParams ?? [];
  const target = WIRE_TARGET_FAMILY[source.visualTarget ?? 'whole'] ?? 'whole';
  const variegation = clamp(params[0] ?? 0, 0, 1);
  return {
    id: source.id ?? `signature_${source.visualSignature ?? 0}`,
    ordinal: source.visualSignature ?? 0,
    target,
    pattern: variegation > 0 ? 'mottle' : 'none',
    patternScale: 1,
    tint: [1, 1, 1],
    tintStrength: clamp(params[1] ?? 0, 0, 1),
    variegation,
    variegationColor: [0.95, 0.98, 0.72],
    glow: clamp(params[2] ?? 0, 0, 1),
    glowColor: [0.2, 0.75, 0.45],
    barkThickness: 1,
    barkDarken: 0,
    spines: 0,
  };
}

/** The style for one held mutation, by id first and ordinal second. */
export function styleForSource(source: MutationLookSource): MutationVisualStyle | null {
  const byId = source.id ? stylesById.get(source.id) : undefined;
  if (byId) {
    // The ordinal on the wire belongs to this style; keep them consistent so a
    // stack built from a rival's pigment resolves the same way.
    return byId;
  }
  const byOrdinal =
    typeof source.visualSignature === 'number'
      ? stylesByOrdinal.get(source.visualSignature)
      : undefined;
  if (byOrdinal && (!source.id || !stylesById.has(source.id))) return byOrdinal;
  return fallbackStyle(source);
}

/** A style's strength amplified by its level, still inside the caps. */
function leveledStyle(style: MutationVisualStyle, level: number): MutationVisualStyle {
  const steps = Math.max(0, Math.floor(level) - 1);
  if (steps === 0) return style;
  const gain = 1 + caps.levelVisualGain * steps;
  return {
    ...style,
    tintStrength: clamp(style.tintStrength * gain, 0, caps.maxTintStrength),
    variegation: clamp(style.variegation * gain, 0, caps.maxVariegation),
    glow: clamp(style.glow * gain, 0, caps.maxGlow),
    barkThickness: clamp(1 + (style.barkThickness - 1) * gain, 1, caps.maxBarkThickness),
    barkDarken: clamp(style.barkDarken * gain, 0, caps.maxBarkDarken),
    spines: clamp(style.spines * gain, 0, caps.maxSpines),
  };
}

function neutralLook(signature: number): MutationLook {
  return { ...NEUTRAL_LOOK, tint: [1, 1, 1], signature };
}

/**
 * Compose every held mutation's style into one look per organ family.
 *
 * This is the fix for C1 (only one signature was ever drawn): a plant with
 * variegated foliage and thickened bark now shows both, each on its own organs.
 */
export function lookFromMutations(sources: readonly MutationLookSource[]): MutationLookStack {
  const resolved: MutationVisualStyle[] = [];
  let signature = 0;
  for (const source of sources) {
    const style = styleForSource(source);
    if (!style) continue;
    signature = Math.max(signature, style.ordinal);
    resolved.push(leveledStyle(style, source.level ?? 1));
  }
  if (resolved.length === 0) return NEUTRAL_STACK;

  const looks = {} as Record<MutationOrganFamily, MutationLook>;
  for (const family of MUTATION_ORGAN_FAMILIES) {
    looks[family] = composeFamily(resolved, family, signature);
  }
  return { looks, disc: composeFamily(resolved, null, signature), signature };
}

function composeFamily(
  styles: readonly MutationVisualStyle[],
  family: MutationOrganFamily | null,
  signature: number,
): MutationLook {
  const tint: [number, number, number] = [1, 1, 1];
  let tintStrength = 0;
  let variegationLeft = 1;
  let variegationColor: [number, number, number] = [1, 1, 1];
  let variegationWeight = 0;
  let glow = 0;
  let glowColor: [number, number, number] = [0.2, 0.75, 0.45];
  let glowWeight = 0;
  let barkExcess = 0;
  let darkenLeft = 1;
  let spines = 0;
  let pattern: MutationVisualPattern = 'none';
  let patternScale = 1;
  let patternWeight = 0;
  let any = false;

  for (const style of styles) {
    // `family === null` composes everything: the disc a billboard draws.
    if (family !== null && style.target !== family && style.target !== 'whole') continue;
    any = true;
    // Tint multiplies: mix(1, tint, strength) per style, then clamp once.
    for (let channel = 0; channel < 3; channel += 1) {
      const amount = 1 + (style.tint[channel] - 1) * style.tintStrength;
      tint[channel] *= amount;
    }
    tintStrength = Math.max(tintStrength, style.tintStrength);

    if (style.variegation > 0) {
      const weight = style.variegation;
      variegationColor = [
        (variegationColor[0] * variegationWeight + style.variegationColor[0] * weight) /
          (variegationWeight + weight),
        (variegationColor[1] * variegationWeight + style.variegationColor[1] * weight) /
          (variegationWeight + weight),
        (variegationColor[2] * variegationWeight + style.variegationColor[2] * weight) /
          (variegationWeight + weight),
      ];
      variegationWeight += weight;
      variegationLeft *= 1 - style.variegation;
      if (style.pattern !== 'none' && weight > patternWeight) {
        pattern = style.pattern;
        patternScale = style.patternScale;
        patternWeight = weight;
      }
    }
    if (style.glow > 0) {
      const weight = style.glow;
      glowColor = [
        (glowColor[0] * glowWeight + style.glowColor[0] * weight) / (glowWeight + weight),
        (glowColor[1] * glowWeight + style.glowColor[1] * weight) / (glowWeight + weight),
        (glowColor[2] * glowWeight + style.glowColor[2] * weight) / (glowWeight + weight),
      ];
      glowWeight += weight;
      glow += style.glow;
      if (style.pattern === 'glow' && weight > patternWeight) {
        pattern = 'glow';
        patternScale = style.patternScale;
        patternWeight = weight;
      }
    }
    barkExcess += Math.max(0, style.barkThickness - 1);
    darkenLeft *= 1 - style.barkDarken;
    spines = Math.max(spines, style.spines);
  }

  if (!any) return neutralLook(signature);

  return {
    signature,
    tint: [
      clamp(tint[0], caps.minTint, caps.maxTint),
      clamp(tint[1], caps.minTint, caps.maxTint),
      clamp(tint[2], caps.minTint, caps.maxTint),
    ],
    tintStrength: clamp(tintStrength, 0, caps.maxTintStrength),
    variegation: clamp(1 - variegationLeft, 0, caps.maxVariegation),
    variegationColor,
    glow: clamp(glow, 0, caps.maxGlow),
    glowColor,
    pattern,
    patternScale,
    barkScale: clamp(1 + barkExcess, 1, caps.maxBarkThickness),
    barkDarken: clamp(1 - darkenLeft, 0, caps.maxBarkDarken),
    spines: clamp(spines, 0, caps.maxSpines),
  };
}

/** The look that applies to one node type. */
export function organLook(stack: MutationLookStack, organ: string): MutationLook {
  const family = organFamily(organ);
  return stack.looks[family] ?? NEUTRAL_LOOK;
}

/** The look that applies to any of the given organs (first match wins). */
export function lookForOrgans(
  stack: MutationLookStack,
  organs: readonly string[],
): MutationLook | null {
  for (const organ of organs) {
    const look = organLook(stack, organ);
    if (look.signature > 0) return look;
  }
  return null;
}

/** A key for the parts of a look that are geometry, not paint. */
export function geometryKey(stack: MutationLookStack): string {
  const parts: string[] = [];
  for (const family of MUTATION_ORGAN_FAMILIES) {
    const look = stack.looks[family];
    parts.push(`${look.barkScale.toFixed(3)}:${look.spines.toFixed(3)}`);
  }
  return parts.join('|');
}

export function lookIsNeutral(look: MutationLook): boolean {
  return (
    look.tint[0] === 1 &&
    look.tint[1] === 1 &&
    look.tint[2] === 1 &&
    look.variegation === 0 &&
    look.glow === 0 &&
    look.barkScale === 1 &&
    look.spines === 0 &&
    look.pattern === 'none'
  );
}

// ---------------------------------------------------------------------------
// Legacy per-node signature channel
//
// The packed vertex word still carries four bits, now only for the billboard and
// impostor tiers, which draw one plant as a disc. They keep reading a single
// integer signature; the mesh tiers use the composed stack.
// ---------------------------------------------------------------------------

/** Bits the packed vertex word can hold for a signature. */
export const MUTATION_MASK_BITS = 4;
export const MUTATION_MASK_LIMIT = (1 << MUTATION_MASK_BITS) - 1;

/**
 * The strongest ordinal a plant holds, clamped to the four bits the packed
 * word can carry. A style ordinal above the mask cannot be represented, and a
 * truncated index would paint a *different* mutation's colour, so anything out
 * of range reports 0 ("none") instead.
 */
export function encodeMutationSignature(values: readonly (number | string)[]): number {
  let best = 0;
  for (const value of values) {
    const ordinal = typeof value === 'number' ? value : (stylesById.get(value)?.ordinal ?? 0);
    best = Math.max(best, ordinal);
  }
  return best > 0 && best <= MUTATION_MASK_LIMIT ? best : 0;
}

export function mutationMaskHas(signature: number, ordinal: number): boolean {
  return signature === ordinal;
}

/** A node's signature index from either wire shape, clamped to four bits. */
export function nodeMutationMask(node: {
  mutationFlags?: number;
  mutations?: readonly string[];
}): number {
  const flags = node.mutationFlags ?? 0;
  const named = node.mutations ? encodeMutationSignature(node.mutations) : 0;
  const signature = Math.max(flags, named);
  return signature > 0 && signature <= MUTATION_MASK_LIMIT ? signature : 0;
}

/** Reads the signature off a server node, which may carry either shape. */
export function readServerMutationMask(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const record = node as { mutationFlags?: unknown; mutations?: unknown };
  const flags = typeof record.mutationFlags === 'number' ? record.mutationFlags : 0;
  const names = Array.isArray(record.mutations)
    ? record.mutations.filter((name): name is string => typeof name === 'string')
    : [];
  const value = Math.max(flags, encodeMutationSignature(names));
  return value > 0 && value <= MUTATION_MASK_LIMIT ? value : 0;
}

/**
 * The composed look for a bare signature (billboard tiers and legacy callers).
 *
 * A billboard draws a whole plant as one disc, so it uses the foliage look when
 * there is one and the woody look otherwise: leaves are what a distant plant
 * reads as.
 */
export function signatureStack(signature: number): MutationLookStack {
  if (!signature) return NEUTRAL_STACK;
  const style = stylesByOrdinal.get(signature);
  if (!style) return NEUTRAL_STACK;
  return lookFromMutations([{ id: style.id, visualSignature: signature }]);
}

/**
 * Backwards-compatible single look for a signature: the foliage composite when
 * the style paints leaves, otherwise the woody one. An ordinal with no style is
 * neutral - never a look with a made-up signature.
 */
export function signatureStyle(signature: number): MutationLook {
  const stack = signatureStack(signature);
  const foliage = stack.looks.foliage;
  if (!lookIsNeutral(foliage)) return foliage;
  const woody = stack.looks.woody;
  if (!lookIsNeutral(woody)) return woody;
  return NEUTRAL_LOOK;
}

/** Does this look paint the given organ? */
export function lookAppliesTo(look: MutationLook, organ: string): boolean {
  if (look.signature === 0) return false;
  const family = organFamily(organ);
  if (look.tint[0] !== 1 || look.tint[1] !== 1 || look.tint[2] !== 1) return true;
  if (look.variegation > 0 || look.glow > 0) return true;
  if (look.barkScale > 1 || look.spines > 0) return family === 'woody';
  return false;
}
