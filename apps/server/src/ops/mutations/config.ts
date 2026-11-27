/**
 * T04 — load `config/mutations.json`.
 *
 * Mutations are object entries (`mutation_<id>`), so adding one is a config
 * edit and nothing else (DESIGN T04: "Mutations config-only to add"). The
 * loader validates the parts the simulation depends on and throws at startup
 * rather than letting a half-formed mutation reach the growth loop.
 */
import type { ConfigFile } from '@plant-legacy/shared/config';
import { readBoolean, readNumber, readObject } from '@plant-legacy/shared/config';
import {
  MULTIPLIER_EFFECT_KEYS,
  MUTATION_CATEGORIES,
  MUTATION_VISUAL_PATTERNS,
  MUTATION_VISUAL_TARGETS,
  type MultiplierEffectKey,
  type MutationCategory,
  type MutationDefinition,
  type MutationEffects,
  type MutationKind,
  type MutationLevelRules,
  type MutationsConfig,
  type MutationTriggers,
  type MutationVisualCaps,
  type MutationVisualPattern,
  type MutationVisualStyle,
  type MutationVisualTarget,
  type MutationWireVisualTarget,
} from './types.ts';

const KINDS: MutationKind[] = ['cosmetic', 'structural', 'expressive', 'ability', 'stat'];
const WIRE_TARGETS: Record<MutationVisualTarget, MutationWireVisualTarget> = {
  foliage: 'foliage',
  woody: 'woody',
  seed: 'seed',
  bloom: 'bloom',
  whole: 'whole',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function normalizeEffects(raw: unknown): MutationEffects {
  const record = asRecord(raw);
  const effects: MutationEffects = {};
  const photo = optNum(record.photosynthesis_multiplier);
  if (photo !== undefined) effects.photosynthesisMultiplier = photo;
  const upkeep = optNum(record.energy_upkeep_multiplier);
  if (upkeep !== undefined) effects.energyUpkeepMultiplier = upkeep;
  const growth = optNum(record.growth_cost_multiplier);
  if (growth !== undefined) effects.growthCostMultiplier = growth;
  const reroot = optNum(record.reroot_speed_multiplier);
  if (reroot !== undefined) effects.rerootSpeedMultiplier = reroot;
  const growthSpeed = optNum(record.growth_speed_multiplier);
  if (growthSpeed !== undefined) effects.growthSpeedMultiplier = growthSpeed;
  const size = optNum(record.size_multiplier);
  if (size !== undefined) effects.sizeMultiplier = size;
  const rootSize = optNum(record.root_size_multiplier);
  if (rootSize !== undefined) effects.rootSizeMultiplier = rootSize;
  const unlocked = strArray(record.unlock_node_types);
  if (unlocked.length > 0) effects.unlockNodeTypes = unlocked;
  const petals = optNum(record.petal_count);
  if (petals !== undefined) effects.petalCount = Math.round(petals);
  const leafScale = optNum(record.leaf_scale_multiplier);
  if (leafScale !== undefined) effects.leafScaleMultiplier = leafScale;
  const seedScale = optNum(record.seed_scale_multiplier);
  if (seedScale !== undefined) effects.seedScaleMultiplier = seedScale;
  const waterCap = optNum(record.water_capacity_multiplier);
  if (waterCap !== undefined) effects.waterCapacityMultiplier = waterCap;
  const mineralCap = optNum(record.mineral_capacity_multiplier);
  if (mineralCap !== undefined) effects.mineralCapacityMultiplier = mineralCap;
  const sharing = optNum(record.stored_resource_sharing);
  if (sharing !== undefined) effects.storedResourceSharing = Math.min(0.9, Math.max(0, sharing));
  const vertical = optNum(record.vertical_bias);
  if (vertical !== undefined) effects.verticalBias = Math.min(1, Math.max(0, vertical));
  const drooping = optNum(record.drooping_bias);
  if (drooping !== undefined) effects.droopingBias = Math.min(1, Math.max(0, drooping));
  return effects;
}

function normalizeTriggers(raw: unknown): MutationTriggers {
  const record = asRecord(raw);
  const triggers: MutationTriggers = {
    growthChanceWeight: Math.max(0, num(record.growth_chance_weight, 1)),
  };
  const minLight = optNum(record.min_light);
  if (minLight !== undefined) triggers.minLight = minLight;
  const maxLight = optNum(record.max_light);
  if (maxLight !== undefined) triggers.maxLight = maxLight;
  const minMoisture = optNum(record.min_moisture);
  if (minMoisture !== undefined) triggers.minMoisture = minMoisture;
  const maxMoisture = optNum(record.max_moisture);
  if (maxMoisture !== undefined) triggers.maxMoisture = maxMoisture;
  const minMinerals = optNum(record.min_minerals);
  if (minMinerals !== undefined) triggers.minMinerals = minMinerals;
  const weather = strArray(record.weather);
  if (weather.length > 0) triggers.weather = weather;
  if (record.time_of_day === 'day' || record.time_of_day === 'night') {
    triggers.timeOfDay = record.time_of_day;
  }
  return triggers;
}

function normalizeDefinition(key: string, raw: Record<string, unknown>): MutationDefinition {
  const id = str(raw.id, key.replace(/^mutation_/, ''));
  const kindRaw = str(raw.kind, 'cosmetic');
  const kind = (KINDS as string[]).includes(kindRaw) ? (kindRaw as MutationKind) : 'cosmetic';
  const movement = asRecord(raw.movement);
  const shed = asRecord(raw.shed);
  const maintenance = asRecord(raw.maintenance);

  return {
    id,
    name: str(raw.name, id),
    kind,
    geneTags: strArray(raw.gene_tags),
    // Appearance is resolved from config/mutation_visuals.json once every
    // definition is known; until then the style is a neutral placeholder.
    visualSignature: 0,
    visualParams: [0, 0, 0],
    visualTarget: 'whole',
    visualStyle: neutralStyle(id),
    triggers: normalizeTriggers(raw.triggers),
    maintenance: {
      energyPerSecond: Math.max(0, num(maintenance.energy_per_second, 0)),
      biomassPerSecond: Math.max(0, num(maintenance.biomass_per_second, 0)),
    },
    effects: normalizeEffects(raw.effects),
    movement: {
      rerootSpeed: Math.max(0, num(movement.reroot_speed, 1)),
      translocate: movement.translocate === true,
      parts: strArray(movement.parts),
      drift: num(movement.drift, 0),
    },
    shed: {
      cooldownS: Math.max(0, num(shed.cooldown_s, 0)),
      biomassPenaltyFraction: Math.max(0, num(shed.biomass_penalty_fraction, 0)),
    },
    starter: raw.starter === true,
  };
}

function normalizeCategoryMap(raw: unknown): Record<string, MutationCategory> {
  const record = asRecord(raw);
  const map: Record<string, MutationCategory> = {};
  for (const [nodeType, value] of Object.entries(record)) {
    if (typeof value !== 'string') continue;
    if ((MUTATION_CATEGORIES as readonly string[]).includes(value)) {
      map[nodeType] = value as MutationCategory;
    }
  }
  return map;
}

function normalizeTagMap(raw: unknown): Record<string, string[]> {
  const record = asRecord(raw);
  const map: Record<string, string[]> = {};
  for (const [category, value] of Object.entries(record)) {
    if (!(MUTATION_CATEGORIES as readonly string[]).includes(category)) continue;
    map[category] = strArray(value);
  }
  return map;
}

/** Fallback card wording, used when config omits a label. */
const STEP_LABELS: Record<MultiplierEffectKey, string> = {
  photosynthesisMultiplier: 'More photosynthesis',
  energyUpkeepMultiplier: 'Leaner upkeep',
  growthCostMultiplier: 'Cheaper growth',
  rerootSpeedMultiplier: 'Faster reroot',
  growthSpeedMultiplier: 'Faster growth',
  sizeMultiplier: 'Larger form',
  rootSizeMultiplier: 'Larger roots',
  leafScaleMultiplier: 'Broader leaves',
  seedScaleMultiplier: 'Fatter seed',
  waterCapacityMultiplier: 'More water store',
  mineralCapacityMultiplier: 'More mineral store',
};

/** `size_multiplier` -> `sizeMultiplier`; config speaks effect-key names. */
function effectKeyFromSnake(key: string): MultiplierEffectKey | null {
  const camel = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return (MULTIPLIER_EFFECT_KEYS as readonly string[]).includes(camel)
    ? (camel as MultiplierEffectKey)
    : null;
}

function normalizeLevelRules(raw: Record<string, unknown>): MutationLevelRules {
  const steps = asRecord(raw.card_steps);
  const labels = asRecord(raw.card_labels);
  const cardSteps: Partial<Record<MultiplierEffectKey, number>> = {};
  const cardLabels: Partial<Record<MultiplierEffectKey, string>> = {};
  for (const [snake, value] of Object.entries(steps)) {
    const key = effectKeyFromSnake(snake);
    if (!key) {
      throw new Error(`mutations.level_up.card_steps.${snake} is not a multiplier effect`);
    }
    const step = num(value, 0);
    if (!(step > 0)) {
      throw new Error(`mutations.level_up.card_steps.${snake} must be a positive number`);
    }
    cardSteps[key] = step;
    const label = labels[snake];
    cardLabels[key] = typeof label === 'string' && label.length > 0 ? label : STEP_LABELS[key];
  }
  return {
    maxLevel: Math.max(1, Math.round(num(raw.max_level, 3))),
    cardsPerOffer: Math.max(1, Math.round(num(raw.cards_per_offer, 3))),
    baseEnergyCost: Math.max(0, num(raw.base_energy_cost, 0)),
    energyCostPerLevel: Math.max(0, num(raw.energy_cost_per_level, 0)),
    energyCostPerBiomass: Math.max(0, num(raw.energy_cost_per_biomass, 0)),
    energyCostPerBiomassPerLevel: Math.max(0, num(raw.energy_cost_per_biomass_per_level, 0)),
    baseBiomassFraction: Math.min(0.9, Math.max(0, num(raw.base_biomass_fraction, 0))),
    biomassFractionPerLevel: Math.min(0.9, Math.max(0, num(raw.biomass_fraction_per_level, 0))),
    minBiomassCost: Math.max(1, num(raw.min_biomass_cost, 1)),
    maxEnergyShareOfCapacity: Math.min(
      1,
      Math.max(0.1, num(raw.max_energy_share_of_capacity, 0.8)),
    ),
    upkeepPerLevel: Math.max(0, num(raw.upkeep_per_level, 0)),
    cardSteps,
    cardLabels,
  };
}

/** A style with nothing on it, used before the visuals file is applied. */
function neutralStyle(id: string): MutationVisualStyle {
  return {
    id,
    ordinal: 0,
    target: 'whole',
    pattern: 'none',
    patternScale: 1,
    tint: [1, 1, 1],
    tintStrength: 0,
    variegation: 0,
    variegationColor: [1, 1, 1],
    glow: 0,
    glowColor: [0.2, 0.75, 0.45],
    barkThickness: 1,
    barkDarken: 0,
    spines: 0,
  };
}

function numericTriple(
  value: unknown,
  fallback: [number, number, number],
): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const red = typeof value[0] === 'number' && Number.isFinite(value[0]) ? value[0] : fallback[0];
  const green = typeof value[1] === 'number' && Number.isFinite(value[1]) ? value[1] : fallback[1];
  const blue = typeof value[2] === 'number' && Number.isFinite(value[2]) ? value[2] : fallback[2];
  return [red, green, blue];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Resolve `config/mutation_visuals.json` into per-mutation styles.
 *
 * Every definition must have a style and every style must name a definition, so
 * a mutation can never ship as an invisible one. Ordinals come from declaration
 * order, which is what the wire carries and what a rival plant is drawn from.
 */
function loadVisuals(
  configs: Map<string, ConfigFile>,
  definitions: MutationDefinition[],
): {
  caps: MutationVisualCaps;
  targets: Record<string, string[]>;
  styles: Record<string, MutationVisualStyle>;
} {
  const file = configs.get('mutation_visuals');
  if (!file) {
    throw new Error(
      'config/mutation_visuals.json is required by T04 and was not loaded: every mutation needs a style',
    );
  }
  // A `styles` entry is an object, not a typed value, so read the raw map.
  const capsRaw = asRecord((file.values.caps as { value?: unknown } | undefined)?.value);
  const targetsRaw = asRecord((file.values.targets as { value?: unknown } | undefined)?.value);
  const stylesRaw = asRecord((file.values.styles as { value?: unknown } | undefined)?.value);

  const caps: MutationVisualCaps = {
    minTint: Math.max(0, num(capsRaw.min_tint, 0.55)),
    maxTint: Math.max(1, num(capsRaw.max_tint, 1.35)),
    maxTintStrength: clamp01(num(capsRaw.max_tint_strength, 0.9)),
    maxVariegation: clamp01(num(capsRaw.max_variegation, 0.8)),
    maxGlow: clamp01(num(capsRaw.max_glow, 0.95)),
    maxBarkThickness: Math.max(1, num(capsRaw.max_bark_thickness, 1.6)),
    maxBarkDarken: Math.min(0.9, Math.max(0, num(capsRaw.max_bark_darken, 0.45))),
    maxSpines: clamp01(num(capsRaw.max_spines, 1)),
    levelVisualGain: Math.max(0, num(capsRaw.level_visual_gain, 0.35)),
  };
  if (caps.minTint > caps.maxTint) {
    throw new Error('mutation_visuals.caps.min_tint must not exceed max_tint');
  }

  const targets: Record<string, string[]> = {};
  for (const [family, organs] of Object.entries(targetsRaw)) {
    if (!(MUTATION_VISUAL_TARGETS as readonly string[]).includes(family)) {
      throw new Error(`mutation_visuals.targets.${family} is not an organ family`);
    }
    targets[family] = strArray(organs);
  }
  for (const family of MUTATION_VISUAL_TARGETS) {
    if (!(family in targets)) {
      throw new Error(`mutation_visuals.targets is missing the ${family} family`);
    }
  }

  const styles: Record<string, MutationVisualStyle> = {};
  let ordinal = 0;
  for (const definition of definitions) {
    const raw = asRecord(stylesRaw[definition.id]);
    if (Object.keys(raw).length === 0) {
      throw new Error(
        `mutation_visuals.styles has no entry for mutation "${definition.id}": every mutation must say how it looks`,
      );
    }
    ordinal += 1;
    const targetRaw = str(raw.target, 'whole');
    if (!(MUTATION_VISUAL_TARGETS as readonly string[]).includes(targetRaw)) {
      throw new Error(
        `mutation_visuals.styles.${definition.id}.target must be one of ${MUTATION_VISUAL_TARGETS.join(', ')}`,
      );
    }
    const patternRaw = str(raw.pattern, 'none');
    if (!(MUTATION_VISUAL_PATTERNS as readonly string[]).includes(patternRaw)) {
      throw new Error(
        `mutation_visuals.styles.${definition.id}.pattern must be one of ${MUTATION_VISUAL_PATTERNS.join(', ')}`,
      );
    }
    styles[definition.id] = {
      id: definition.id,
      ordinal,
      target: targetRaw as MutationVisualTarget,
      pattern: patternRaw as MutationVisualPattern,
      patternScale: Math.max(0.1, num(raw.pattern_scale, 1)),
      tint: numericTriple(raw.tint, [1, 1, 1]),
      tintStrength: clamp01(num(raw.tint_strength, 0)),
      variegation: clamp01(num(raw.variegation, 0)),
      variegationColor: numericTriple(raw.variegation_color, [1, 1, 1]),
      glow: clamp01(num(raw.glow, 0)),
      glowColor: numericTriple(raw.glow_color, [0.2, 0.75, 0.45]),
      barkThickness: Math.max(1, num(raw.bark_thickness, 1)),
      barkDarken: clamp01(num(raw.bark_darken, 0)),
      spines: clamp01(num(raw.spines, 0)),
    };
  }

  for (const id of Object.keys(stylesRaw)) {
    if (!(id in styles)) {
      throw new Error(`mutation_visuals.styles.${id} names no mutation definition`);
    }
  }

  for (const definition of definitions) {
    const style = styles[definition.id];
    definition.visualStyle = style;
    definition.visualSignature = style.ordinal;
    definition.visualParams = [style.variegation, style.tintStrength, style.glow];
    definition.visualTarget = WIRE_TARGETS[style.target];
  }

  return { caps, targets, styles };
}

export function loadMutationsConfig(configs: Map<string, ConfigFile>): MutationsConfig {
  const file = configs.get('mutations');
  if (!file) {
    throw new Error('config/mutations.json is required by T04 and was not loaded');
  }

  const definitions: MutationDefinition[] = [];
  for (const [key, entry] of Object.entries(file.values)) {
    if (!key.startsWith('mutation_')) continue;
    // Tunables share the `mutation_` prefix (chance, half-life, ...), so only an
    // object entry is a definition. A definition must name itself.
    const record = entry as { type?: string; value?: unknown };
    if (record.type !== 'object') continue;
    const value = asRecord(record.value);
    if (typeof value.id !== 'string') {
      throw new Error(`mutations.${key} is missing an "id"`);
    }
    definitions.push(normalizeDefinition(key, value));
  }
  if (definitions.length === 0) {
    throw new Error('config/mutations.json declares no mutation_* definitions');
  }

  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new Error(`mutations: duplicate mutation id "${definition.id}"`);
    }
    ids.add(definition.id);
  }

  const categoryForNodeType = normalizeCategoryMap(
    readObject(configs, 'mutations', 'node_type_to_category'),
  );
  const categoryToTags = normalizeTagMap(readObject(configs, 'mutations', 'category_to_tag_map'));
  const oversize = readObject<{ wilt_per_s?: unknown }>(configs, 'mutations', 'oversize_decay');
  const levelUp = normalizeLevelRules(
    readObject<Record<string, unknown>>(configs, 'mutations', 'level_up'),
  );
  const visuals = loadVisuals(configs, definitions);

  return {
    chancePerGrowth: readNumber(configs, 'mutations', 'mutation_chance_per_growth'),
    adaptivePressureEnabled: readBoolean(configs, 'mutations', 'adaptive_pressure_enabled'),
    decayHalfLifeTicks: readNumber(configs, 'mutations', 'decay_half_life_ticks'),
    maxPressureMultiplier: readNumber(configs, 'mutations', 'max_pressure_multiplier'),
    maxSizeMultiplier: readNumber(configs, 'mutations', 'max_size_multiplier'),
    defaultShedCooldownS: readNumber(configs, 'mutations', 'shed_cooldown_s'),
    maintenanceScale: readNumber(configs, 'mutations', 'mutation_maintenance_scale'),
    upkeepNodeScale: readNumber(configs, 'mutations', 'mutation_upkeep_node_scale'),
    upkeepBiomassScale: readNumber(configs, 'mutations', 'mutation_upkeep_biomass_scale'),
    upkeepMaxMultiplier: readNumber(configs, 'mutations', 'mutation_upkeep_max_multiplier'),
    upkeepBiomassFloor: readNumber(configs, 'mutations', 'upkeep_biomass_floor'),
    oversizeWiltPerS: Math.max(0, num(oversize.wilt_per_s, 0.02)),
    levelUp,
    visualCaps: visuals.caps,
    visualTargets: visuals.targets,
    visualStyles: visuals.styles,
    definitions,
    categoryForNodeType,
    categoryToTags,
  };
}
