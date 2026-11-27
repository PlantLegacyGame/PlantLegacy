/**
 * T04 mutation service — acquisition, upkeep, effects and shedding.
 *
 * The rules are pure functions over a Plant so they can be tested without a
 * world. `PlantWorld` calls them from the growth and upkeep paths.
 */
import type { Plant } from '@plant-legacy/shared/growth';
import { addPressure, decayPressure, type Pressure, pressureMultiplier } from './pressure.ts';
import {
  MUTATION_CATEGORIES,
  type MutationCategory,
  type MutationDefinition,
  type MutationEnvironment,
  type MutationsConfig,
} from './types.ts';

export interface MutateContext {
  tick: number;
  nodeType: string;
  biomass: number;
  environment: MutationEnvironment;
  /** Injectable for tests; production uses Math.random. */
  random?: () => number;
}

function ensurePressure(plant: Plant): Pressure {
  if (!plant.mutationPressure) {
    plant.mutationPressure = {
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
  for (const category of MUTATION_CATEGORIES) {
    if (typeof plant.mutationPressure[category] !== 'number') {
      plant.mutationPressure[category] = 0;
    }
  }
  return plant.mutationPressure as Pressure;
}

export function decayPlantPressure(
  plant: Plant,
  config: MutationsConfig,
  dtSeconds: number,
  tickRateHz: number,
): void {
  if (!config.adaptivePressureEnabled || dtSeconds <= 0) return;
  decayPressure(ensurePressure(plant), dtSeconds, config.decayHalfLifeTicks, tickRateHz);
}

/** Count one growth event against the category its node type belongs to. */
export function recordInvestment(
  plant: Plant,
  config: MutationsConfig,
  nodeType: string,
  biomass: number,
): void {
  const category = config.categoryForNodeType[nodeType];
  if (!category) return;
  addPressure(ensurePressure(plant), category, Math.max(0, biomass));
  // A stem or root that is holding reserves is also storage investment; this is
  // a config mapping, not a special case for one node type.
  const storageCategory = config.categoryForNodeType[`${nodeType}->storage`];
  if (storageCategory && storageCategory !== category) {
    addPressure(ensurePressure(plant), storageCategory, Math.max(0, biomass) * 0.5);
  }
}

function triggerAllows(definition: MutationDefinition, environment: MutationEnvironment): boolean {
  const t = definition.triggers;
  if (t.minLight !== undefined && environment.light < t.minLight) return false;
  if (t.maxLight !== undefined && environment.light > t.maxLight) return false;
  if (t.minMoisture !== undefined && environment.moisture < t.minMoisture) return false;
  if (t.maxMoisture !== undefined && environment.moisture > t.maxMoisture) return false;
  if (t.minMinerals !== undefined && environment.minerals < t.minMinerals) return false;
  if (t.weather && !t.weather.includes(environment.weather)) return false;
  if (t.timeOfDay && t.timeOfDay !== environment.timeOfDay) return false;
  return true;
}

export function eligibleMutations(
  plant: Plant,
  config: MutationsConfig,
  environment: MutationEnvironment,
): MutationDefinition[] {
  const held = new Set((plant.mutations ?? []).map((mutation) => mutation.id));
  return config.definitions.filter(
    (definition) =>
      !held.has(definition.id) &&
      definition.triggers.growthChanceWeight > 0 &&
      triggerAllows(definition, environment),
  );
}

/**
 * One acquisition roll. Returns the mutation added to the plant, or null.
 *
 * Chance is `mutation_chance_per_growth`; the pool is weighted by each
 * mutation's own weight and by adaptive pressure on its gene tags.
 */
export function rollMutation(
  plant: Plant,
  config: MutationsConfig,
  ctx: MutateContext,
): MutationDefinition | null {
  const random = ctx.random ?? Math.random;
  if (config.chancePerGrowth <= 0) return null;
  if (random() > config.chancePerGrowth) return null;

  let pool = eligibleMutations(plant, config, ctx.environment);
  // A plant's first mutation is always a simple starter: the verbs it unlocks
  // (petals, vines, movement) wait until the plant has grown into them.
  if ((plant.mutations?.length ?? 0) === 0) {
    const starters = pool.filter((definition) => definition.starter === true);
    if (starters.length > 0) pool = starters;
  }
  if (pool.length === 0) return null;

  const pressure = ensurePressure(plant);
  const weights = pool.map(
    (definition) =>
      definition.triggers.growthChanceWeight *
      pressureMultiplier(pressure, definition.geneTags, config),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return null;

  let pick = random() * total;
  let chosen = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    pick -= weights[i];
    if (pick <= 0) {
      chosen = pool[i];
      break;
    }
  }

  if (!plant.mutations) plant.mutations = [];
  plant.mutations.push({
    id: chosen.id,
    acquiredTick: ctx.tick,
    nodeId: null,
    level: 1,
  });
  plant.mutationSignature = dominantSignature(plant, config);
  return chosen;
}

/** Energy and biomass per second every held mutation costs, in total. */
/**
 * How much plant a mutation has to hold on to: the nodes it applies to.
 * Root-shaped mutations bill the root system, everything else the canopy, so
 * the kind of node matters and not only the plant's total size.
 */
export function mutationAffectedMass(
  plant: Plant,
  definition: MutationDefinition,
): { count: number; biomass: number } {
  const rootOnly = definition.effects.rootSizeMultiplier !== undefined;
  let count = 0;
  let biomass = 0;
  for (const node of plant.nodes.values()) {
    if (rootOnly && node.layer !== 'root') continue;
    if (!rootOnly && node.layer === 'root') continue;
    count += 1;
    biomass += node.biomass;
  }
  return { count, biomass };
}

export function mutationMaintenance(
  plant: Plant,
  config: MutationsConfig,
): { energyPerSecond: number; biomassPerSecond: number } {
  let energy = 0;
  let biomass = 0;
  for (const held of plant.mutations ?? []) {
    const definition = config.definitions.find((entry) => entry.id === held.id);
    if (!definition) continue;
    const affected = mutationAffectedMass(plant, definition);
    const scale = Math.min(
      config.upkeepMaxMultiplier,
      1 + config.upkeepNodeScale * affected.count + config.upkeepBiomassScale * affected.biomass,
    );
    // A level is a bigger commitment: the running bill climbs with every level.
    const levelScale = 1 + config.levelUp.upkeepPerLevel * (mutationLevel(held) - 1);
    energy += definition.maintenance.energyPerSecond * config.maintenanceScale * scale * levelScale;
    biomass += definition.maintenance.biomassPerSecond * scale * levelScale;
  }
  return { energyPerSecond: energy, biomassPerSecond: biomass };
}

export interface ResolvedMutationEffects {
  photosynthesisMultiplier: number;
  energyUpkeepMultiplier: number;
  growthCostMultiplier: number;
  rerootSpeedMultiplier: number;
  growthSpeedMultiplier: number;
  sizeMultiplier: number;
  rootSizeMultiplier: number;
  unlockNodeTypes: string[];
  petalCount: number;
  leafScaleMultiplier: number;
  seedScaleMultiplier: number;
  waterCapacityMultiplier: number;
  mineralCapacityMultiplier: number;
  /** Share of the stored-resource growth gate a clonal network covers. */
  storedResourceSharing: number;
  /** Columnar habit: how far canopy growth bends upright (0..1). */
  verticalBias: number;
  /** Drooping fronds: how far foliage bends downward (0..1). */
  droopingBias: number;
}

/**
 * Level a held mutation is at. Absent means 1, which is how old saves load.
 */
export function mutationLevel(held: { level?: number }): number {
  const level = Math.floor(held.level ?? 1);
  return Number.isFinite(level) && level >= 1 ? level : 1;
}

/**
 * Apply one card to the resolved effect set.
 *
 * Cards are effect keys with a multiplier, so a card composes exactly like a
 * mutation of its own: products multiply, and nothing else needs a special case.
 */
function applyCard(
  effects: ResolvedMutationEffects,
  cardId: string,
  config: MutationsConfig,
): void {
  const step = config.levelUp.cardSteps[cardId as keyof typeof config.levelUp.cardSteps];
  if (step === undefined || !(step > 0)) return;
  if (cardId === 'photosynthesisMultiplier') effects.photosynthesisMultiplier *= step;
  else if (cardId === 'energyUpkeepMultiplier') effects.energyUpkeepMultiplier *= step;
  else if (cardId === 'growthCostMultiplier') effects.growthCostMultiplier *= step;
  else if (cardId === 'rerootSpeedMultiplier') effects.rerootSpeedMultiplier *= step;
  else if (cardId === 'growthSpeedMultiplier') effects.growthSpeedMultiplier *= step;
  else if (cardId === 'sizeMultiplier') effects.sizeMultiplier *= step;
  else if (cardId === 'rootSizeMultiplier') effects.rootSizeMultiplier *= step;
  else if (cardId === 'leafScaleMultiplier') effects.leafScaleMultiplier *= step;
  else if (cardId === 'seedScaleMultiplier') effects.seedScaleMultiplier *= step;
  else if (cardId === 'waterCapacityMultiplier') effects.waterCapacityMultiplier *= step;
  else if (cardId === 'mineralCapacityMultiplier') effects.mineralCapacityMultiplier *= step;
}

/** Product of every held mutation's stat multipliers, with its level cards. */
export function mutationEffects(plant: Plant, config: MutationsConfig): ResolvedMutationEffects {
  const effects: ResolvedMutationEffects = {
    photosynthesisMultiplier: 1,
    energyUpkeepMultiplier: 1,
    growthCostMultiplier: 1,
    rerootSpeedMultiplier: 1,
    growthSpeedMultiplier: 1,
    sizeMultiplier: 1,
    rootSizeMultiplier: 1,
    unlockNodeTypes: [],
    petalCount: 6,
    leafScaleMultiplier: 1,
    seedScaleMultiplier: 1,
    waterCapacityMultiplier: 1,
    mineralCapacityMultiplier: 1,
    storedResourceSharing: 0,
    verticalBias: 0,
    droopingBias: 0,
  };
  for (const held of plant.mutations ?? []) {
    const definition = config.definitions.find((entry) => entry.id === held.id);
    if (!definition) continue;
    const e = definition.effects;
    effects.photosynthesisMultiplier *= e.photosynthesisMultiplier ?? 1;
    effects.energyUpkeepMultiplier *= e.energyUpkeepMultiplier ?? 1;
    effects.growthCostMultiplier *= e.growthCostMultiplier ?? 1;
    effects.rerootSpeedMultiplier *= e.rerootSpeedMultiplier ?? 1;
    effects.growthSpeedMultiplier *= e.growthSpeedMultiplier ?? 1;
    effects.sizeMultiplier *= e.sizeMultiplier ?? 1;
    effects.rootSizeMultiplier *= e.rootSizeMultiplier ?? 1;
    for (const nodeType of e.unlockNodeTypes ?? []) {
      if (!effects.unlockNodeTypes.includes(nodeType)) effects.unlockNodeTypes.push(nodeType);
    }
    effects.petalCount = Math.max(effects.petalCount, e.petalCount ?? 0);
    effects.leafScaleMultiplier *= e.leafScaleMultiplier ?? 1;
    effects.seedScaleMultiplier *= e.seedScaleMultiplier ?? 1;
    effects.waterCapacityMultiplier *= e.waterCapacityMultiplier ?? 1;
    effects.mineralCapacityMultiplier *= e.mineralCapacityMultiplier ?? 1;
    // Sharing is a capability, not a product: the widest network wins.
    effects.storedResourceSharing = Math.max(
      effects.storedResourceSharing,
      e.storedResourceSharing ?? 0,
    );
    // Shape biases are friendly only: take the strongest, never sum them.
    effects.verticalBias = Math.max(effects.verticalBias, e.verticalBias ?? 0);
    effects.droopingBias = Math.max(effects.droopingBias, e.droopingBias ?? 0);
    // Every level above the first is whatever card the player took to get there.
    for (const cardId of held.cards ?? []) applyCard(effects, cardId, config);
  }
  // Size is a product of every mutation and every level card, and nothing capped
  // it. Two size mutations at level three made a new internode twice the length of
  // the trunk it left, which is not a bigger plant - it is a pole. The ceiling is
  // one number in config so the ceiling and the tuning cannot disagree.
  const maxSize = config.maxSizeMultiplier;
  if (typeof maxSize === 'number' && Number.isFinite(maxSize) && maxSize > 0) {
    effects.sizeMultiplier = Math.min(maxSize, Math.max(1, effects.sizeMultiplier));
    effects.rootSizeMultiplier = Math.min(maxSize, Math.max(1, effects.rootSizeMultiplier));
  }
  return effects;
}

/** The strongest visual signature the plant carries (0 when none). */
export function dominantSignature(plant: Plant, config: MutationsConfig): number {
  let signature = 0;
  for (const held of plant.mutations ?? []) {
    const definition = config.definitions.find((entry) => entry.id === held.id);
    if (!definition) continue;
    signature = Math.max(signature, definition.visualSignature);
  }
  return signature;
}

export interface ShedResult {
  ok: boolean;
  reason?: string;
  mutationId?: string;
  /** Biomass lost to the short penalty, for the event payload. */
  penaltyBiomass?: number;
  cooldownRemainingS?: number;
}

/**
 * Shed one mutation for a short penalty. Refused while the previous shed is
 * still cooling down, so shedding is a decision rather than a free toggle.
 */
export function shedMutation(
  plant: Plant,
  config: MutationsConfig,
  mutationId: string,
  tick: number,
  tickRateHz: number,
): ShedResult {
  const cooldownUntil = plant.mutationShedCooldownUntil ?? 0;
  if (tick < cooldownUntil) {
    return {
      ok: false,
      reason: 'shed_cooldown',
      cooldownRemainingS: Math.max(0, (cooldownUntil - tick) / Math.max(1, tickRateHz)),
    };
  }
  const index = (plant.mutations ?? []).findIndex((mutation) => mutation.id === mutationId);
  if (index < 0) return { ok: false, reason: 'mutation_not_held' };

  const [removed] = plant.mutations?.splice(index, 1) ?? [];
  const definition = config.definitions.find((entry) => entry.id === mutationId);
  const cooldownS = definition?.shed.cooldownS ?? config.defaultShedCooldownS;
  plant.mutationShedCooldownUntil = tick + Math.ceil(cooldownS * Math.max(1, tickRateHz));

  const fraction = definition?.shed.biomassPenaltyFraction ?? 0;
  const penaltyBiomass = fraction > 0 ? plant.totalBiomass * fraction : 0;
  if (penaltyBiomass > 0) {
    plant.totalBiomass = Math.max(0, plant.totalBiomass - penaltyBiomass);
  }
  plant.mutationSignature = dominantSignature(plant, config);
  return { ok: true, mutationId: removed?.id ?? mutationId, penaltyBiomass };
}

/** Category a node type contributed to, for the pressure readout. */
export function categoryForNodeType(
  config: MutationsConfig,
  nodeType: string,
): MutationCategory | undefined {
  return config.categoryForNodeType[nodeType];
}

export interface MutationLevelCost {
  energy: number;
  biomass: number;
}

/**
 * What raising a mutation from `currentLevel` to the next level costs.
 *
 * Energy is a base, plus a step per level already gained, plus a part that
 * scales with the plant's stored biomass, so the same mutation is affordable to
 * a seedling and a real commitment to a mature plant. Biomass is a share of the
 * body, floored so a level always costs some tissue. When the plant's energy
 * capacity is known the energy part is capped at `maxEnergyShareOfCapacity` of it.
 */
export function levelUpCost(
  plant: Plant,
  config: MutationsConfig,
  currentLevel: number,
  energyCapacity?: number,
): MutationLevelCost {
  const steps = Math.max(0, currentLevel - 1);
  const rules = config.levelUp;
  const mass = Math.max(0, plant.totalBiomass);
  const uncapped =
    rules.baseEnergyCost +
    rules.energyCostPerLevel * steps +
    mass * (rules.energyCostPerBiomass + rules.energyCostPerBiomassPerLevel * steps);
  // The bill is never more than a share of what the plant can store, so a full
  // tank always pays for a level whatever the body's size (C11).
  const energy =
    energyCapacity === undefined
      ? uncapped
      : Math.min(uncapped, energyCapacity * rules.maxEnergyShareOfCapacity);
  const biomass = Math.max(
    rules.minBiomassCost,
    mass * (rules.baseBiomassFraction + rules.biomassFractionPerLevel * steps),
  );
  // Whole units: a cost the panel can show without a decimal tail.
  return { energy: Math.ceil(energy), biomass: Math.ceil(biomass) };
}

function heldMutation(plant: Plant, mutationId: string) {
  return (plant.mutations ?? []).find((mutation) => mutation.id === mutationId) ?? null;
}

/**
 * Cards a mutation can grow into: the multiplier effects it already has, plus
 * the one universal card (a leaner metabolism). A size mutation therefore
 * offers size cards, a root mutation root cards, and every mutation offers the
 * upkeep discount, so the choice is always about that mutation's own identity.
 */
export function levelCardsFor(
  config: MutationsConfig,
  definition: MutationDefinition,
): Array<{ id: string; label: string; step: number }> {
  const cards: Array<{ id: string; label: string; step: number }> = [];
  for (const [key, step] of Object.entries(config.levelUp.cardSteps)) {
    if (step === undefined) continue;
    // Two cards are universal: a leaner metabolism and faster extension. Any
    // mutation can grow into those, so every mutation always deals a choice.
    const universal = key === 'energyUpkeepMultiplier' || key === 'growthSpeedMultiplier';
    const own = universal ? 1 : (definition.effects as Record<string, unknown>)[key];
    if (typeof own !== 'number' || !(own > 0)) continue;
    cards.push({
      id: key,
      label: config.levelUp.cardLabels[key as keyof typeof config.levelUp.cardLabels] ?? key,
      step,
    });
  }
  // Keep the order stable: pool order is the config's card_steps order.
  return cards.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The cards laid out for one level-up, dealt from the mutation's own pool.
 * Only *which* cards are offered is random; taking one is the player's choice,
 * and the chosen card is what the level means from then on.
 */
export function buildLevelOffers(
  config: MutationsConfig,
  mutationId: string,
  random: () => number = Math.random,
): Array<{ id: string; label: string; step: number }> | null {
  const definition = config.definitions.find((entry) => entry.id === mutationId);
  if (!definition) return null;
  const pool = levelCardsFor(config, definition);
  if (pool.length === 0) return null;
  const wanted = Math.min(pool.length, config.levelUp.cardsPerOffer);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, wanted);
}

export interface LevelUpCheck {
  ok: boolean;
  reason?: string;
  level: number;
  maxLevel: number;
  cost: MutationLevelCost;
}

/** Whether the plant can raise this mutation right now. */
export function checkLevelUp(
  plant: Plant,
  config: MutationsConfig,
  mutationId: string,
  energyCapacity?: number,
): LevelUpCheck {
  const rules = config.levelUp;
  const held = heldMutation(plant, mutationId);
  const level = held ? mutationLevel(held) : 1;
  const cost = levelUpCost(plant, config, level, energyCapacity);
  const base = { level, maxLevel: rules.maxLevel, cost };
  if (!held) return { ok: false, reason: 'mutation_not_held', ...base };
  if (level >= rules.maxLevel) return { ok: false, reason: 'max_level', ...base };
  if (plant.totalEnergy < cost.energy) return { ok: false, reason: 'insufficient_energy', ...base };
  if (plant.totalBiomass - cost.biomass < config.upkeepBiomassFloor) {
    return { ok: false, reason: 'insufficient_biomass', ...base };
  }
  return { ok: true, ...base };
}

export interface LevelUpResult {
  ok: boolean;
  reason?: string;
  mutationId?: string;
  cardId?: string;
  level?: number;
  cost?: MutationLevelCost;
}

/**
 * Raise a held mutation one level with the card the player picked.
 *
 * The card must come from `offers` (the server's own deal), which is what makes
 * the choice meaningful without letting a client invent an upgrade. Returns the
 * biomass actually spent so the world can take it out of the body, not just the
 * counter.
 */
export function applyLevelUp(
  plant: Plant,
  config: MutationsConfig,
  mutationId: string,
  cardId: string,
  offers: Array<{ id: string }>,
  energyCapacity?: number,
): LevelUpResult {
  const check = checkLevelUp(plant, config, mutationId, energyCapacity);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (!offers.some((offer) => offer.id === cardId)) {
    return { ok: false, reason: 'card_not_offered' };
  }
  const held = heldMutation(plant, mutationId);
  if (!held) return { ok: false, reason: 'mutation_not_held' };
  held.level = check.level + 1;
  held.cards = [...(held.cards ?? []), cardId];
  plant.totalEnergy = Math.max(0, plant.totalEnergy - check.cost.energy);
  return {
    ok: true,
    mutationId,
    cardId,
    level: held.level,
    cost: check.cost,
  };
}
