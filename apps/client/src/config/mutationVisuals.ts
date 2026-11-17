/**
 * `config/mutation_visuals.json` — the appearance table every renderer paints.
 *
 * Appearance is data (RULE_3): the server serves the same file the config
 * validator checks, and nothing here invents a colour. This module owns the
 * parse so it can be tested against the shipped file in isolation; the client
 * installs the result with `configureMutationVisuals`.
 */
import type { MutationVisualCaps, MutationVisualStyle } from '../renderers/plant/mutations.ts';

export interface MutationVisualsConfigFile {
  styles: MutationVisualStyle[];
  caps: Partial<MutationVisualCaps>;
}

const MUTATION_TARGETS = ['foliage', 'woody', 'seed', 'bloom', 'whole'] as const;
const MUTATION_PATTERNS = ['none', 'mottle', 'spots', 'stripes', 'veins', 'sheen', 'glow'] as const;

function visualTriple(
  value: unknown,
  fallback: [number, number, number],
): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  return [
    Number(value[0]) || fallback[0],
    Number(value[1]) || fallback[1],
    Number(value[2]) || fallback[2],
  ];
}

/**
 * Turn the served `/config/mutation_visuals` document into renderer styles.
 *
 * Pure so it can be tested against the shipped file: a field rename in config
 * that this parser did not follow would silently paint every plant neutral.
 */
export function parseMutationVisuals(data: Record<string, unknown>): MutationVisualsConfigFile {
  const rawStyles = (data.styles ?? {}) as Record<string, unknown>;
  const rawCaps = (data.caps ?? {}) as Record<string, unknown>;
  const styles: MutationVisualStyle[] = [];
  let ordinal = 0;
  for (const [id, value] of Object.entries(rawStyles)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const target = MUTATION_TARGETS.includes(record.target as (typeof MUTATION_TARGETS)[number])
      ? (record.target as (typeof MUTATION_TARGETS)[number])
      : 'whole';
    const pattern = MUTATION_PATTERNS.includes(record.pattern as (typeof MUTATION_PATTERNS)[number])
      ? (record.pattern as (typeof MUTATION_PATTERNS)[number])
      : 'none';
    ordinal += 1;
    styles.push({
      id,
      ordinal,
      target,
      pattern,
      patternScale: Number(record.pattern_scale ?? 1) || 1,
      tint: visualTriple(record.tint, [1, 1, 1]),
      tintStrength: Number(record.tint_strength ?? 0) || 0,
      variegation: Number(record.variegation ?? 0) || 0,
      variegationColor: visualTriple(record.variegation_color, [1, 1, 1]),
      glow: Number(record.glow ?? 0) || 0,
      glowColor: visualTriple(record.glow_color, [0.2, 0.75, 0.45]),
      barkThickness: Number(record.bark_thickness ?? 1) || 1,
      barkDarken: Number(record.bark_darken ?? 0) || 0,
      spines: Number(record.spines ?? 0) || 0,
    });
  }
  return {
    styles,
    caps: {
      minTint: Number(rawCaps.min_tint ?? 0.55),
      maxTint: Number(rawCaps.max_tint ?? 1.35),
      maxTintStrength: Number(rawCaps.max_tint_strength ?? 0.9),
      maxVariegation: Number(rawCaps.max_variegation ?? 0.8),
      maxGlow: Number(rawCaps.max_glow ?? 0.95),
      maxBarkThickness: Number(rawCaps.max_bark_thickness ?? 1.6),
      maxBarkDarken: Number(rawCaps.max_bark_darken ?? 0.45),
      maxSpines: Number(rawCaps.max_spines ?? 1),
      levelVisualGain: Number(rawCaps.level_visual_gain ?? 0.35),
    },
  };
}

/**
 * Reads the style table every renderer paints from.
 *
 * A failed fetch returns an empty table and the look builder falls back to the
 * compact wire params, so the game still draws a mutated plant - just at lower
 * fidelity.
 */
export async function loadMutationVisualsConfig(
  serverOrigin: string,
): Promise<MutationVisualsConfigFile> {
  const empty: MutationVisualsConfigFile = { styles: [], caps: {} };
  try {
    const response = await fetch(`${serverOrigin}/config/mutation_visuals`, { cache: 'no-store' });
    if (!response.ok) return empty;
    const data = (await response.json()) as Record<string, unknown>;
    return parseMutationVisuals(data);
  } catch {
    return empty;
  }
}
