import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Plant, PlantNode } from '@plant-legacy/shared/growth';
import {
  applyLevelUp,
  buildLevelOffers,
  checkLevelUp,
  decayPlantPressure,
  dominantSignature,
  levelCardsFor,
  levelUpCost,
  mutationAffectedMass,
  mutationEffects,
  mutationMaintenance,
  recordInvestment,
  rollMutation,
  shedMutation,
} from './service.ts';
import type { MutationDefinition, MutationsConfig } from './types.ts';

function definition(id: string, overrides: Partial<MutationDefinition> = {}): MutationDefinition {
  return {
    id,
    name: id,
    kind: 'cosmetic',
    geneTags: ['Foliage'],
    visualSignature: 1,
    visualParams: [0.5, 1, 0],
    visualTarget: 'whole',
    visualStyle: {
      id,
      ordinal: 1,
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
    },
    triggers: { growthChanceWeight: 1 },
    maintenance: { energyPerSecond: 0.1, biomassPerSecond: 0 },
    effects: {},
    movement: { rerootSpeed: 1, translocate: false, parts: [], drift: 0 },
    shed: { cooldownS: 10, biomassPenaltyFraction: 0.1 },
    ...overrides,
  };
}

function config(overrides: Partial<MutationsConfig> = {}): MutationsConfig {
  return {
    chancePerGrowth: 1,
    adaptivePressureEnabled: true,
    decayHalfLifeTicks: 1000,
    maxPressureMultiplier: 4,
    defaultShedCooldownS: 30,
    maintenanceScale: 1,
    upkeepNodeScale: 0,
    upkeepBiomassScale: 0,
    upkeepMaxMultiplier: 10,
    upkeepBiomassFloor: 8,
    oversizeWiltPerS: 0.02,
    oversizeLeakPerS: 0.05,
    levelUp: {
      maxLevel: 3,
      cardsPerOffer: 3,
      baseEnergyCost: 10,
      energyCostPerLevel: 10,
      energyCostPerBiomass: 1,
      energyCostPerBiomassPerLevel: 1,
      baseBiomassFraction: 0.05,
      biomassFractionPerLevel: 0.05,
      minBiomassCost: 1,
      upkeepPerLevel: 0.15,
      cardSteps: {
        sizeMultiplier: 1.15,
        energyUpkeepMultiplier: 0.92,
        waterCapacityMultiplier: 1.15,
      },
      cardLabels: { sizeMultiplier: 'Larger form', energyUpkeepMultiplier: 'Leaner upkeep' },
    },
    definitions: [definition('leafy'), definition('barky', { visualSignature: 2 })],
    categoryForNodeType: { leaf: 'leaf', stem: 'stem', 'stem->storage': 'storage' },
    categoryToTags: { leaf: ['Foliage'], stem: ['Structure'] },
    ...overrides,
  };
}

function plant(): Plant {
  return {
    id: 'p_1',
    ownerId: 'a_1',
    worldId: 'w_1',
    nodes: new Map(),
    rootNodeId: null,
    totalBiomass: 20,
    totalEnergy: 10,
    totalUpkeep: 0,
    storedWater: 0,
    storedMinerals: 0,
    lastGrowthTick: 0,
    growthCooldownUntil: 0,
    growthSeq: 0,
  };
}

const environment = {
  light: 50,
  moisture: 50,
  minerals: 50,
  weather: 'clear',
  timeOfDay: 'day' as const,
};

describe('T04 mutation service', () => {
  it('acquires only when the configured chance passes', () => {
    const p = plant();
    const never = config({ chancePerGrowth: 0 });
    assert.equal(
      rollMutation(p, never, { tick: 1, nodeType: 'growth', biomass: 0, environment }),
      null,
    );
    assert.equal(p.mutations?.length ?? 0, 0);

    const always = config({ chancePerGrowth: 1 });
    const acquired = rollMutation(p, always, {
      tick: 2,
      nodeType: 'growth',
      biomass: 0,
      environment,
      random: () => 0,
    });
    assert.ok(acquired);
    assert.equal(p.mutations?.length, 1);
  });

  it('rolls only a starter mutation while the plant holds none', () => {
    const p = plant();
    p.mutations = [];
    const cfg = config({
      chancePerGrowth: 1,
      definitions: [
        definition('plain', { starter: true }),
        definition('fancy', { triggers: { growthChanceWeight: 100 } }),
      ],
    });
    const first = rollMutation(p, cfg, {
      tick: 1,
      nodeType: 'leaf',
      biomass: 1,
      environment,
      random: () => 0,
    });
    assert.equal(first?.id, 'plain');
  });

  it('never offers a mutation the plant already holds', () => {
    const p = plant();
    const always = config({ definitions: [definition('only')] });
    rollMutation(p, always, {
      tick: 1,
      nodeType: 'growth',
      biomass: 0,
      environment,
      random: () => 0,
    });
    const second = rollMutation(p, always, {
      tick: 2,
      nodeType: 'growth',
      biomass: 0,
      environment,
      random: () => 0,
    });
    assert.equal(second, null);
    assert.equal(p.mutations?.length, 1);
  });

  it('gates a mutation on the environment it can appear in', () => {
    const p = plant();
    const night = config({
      definitions: [
        definition('night_only', {
          triggers: { growthChanceWeight: 1, timeOfDay: 'night' },
        }),
      ],
    });
    const result = rollMutation(p, night, {
      tick: 1,
      nodeType: 'growth',
      biomass: 0,
      environment,
      random: () => 0,
    });
    assert.equal(result, null);
  });

  it('weights the pool by adaptive pressure and decays it', () => {
    const p = plant();
    const weighted = config({
      definitions: [definition('leafy'), definition('barky', { geneTags: ['Structure'] })],
      categoryForNodeType: { stem: 'stem' },
      categoryToTags: { stem: ['Structure'] },
    });
    for (let i = 0; i < 50; i++) recordInvestment(p, weighted, 'stem', 10);

    // First random picks the pool index; with pressure on Structure the barky
    // mutation must dominate. A deterministic 0.9 lands in the barky slice.
    const picked = rollMutation(p, weighted, {
      tick: 1,
      nodeType: 'growth',
      biomass: 0,
      environment,
      random: (() => {
        const values = [0, 0.9];
        let i = 0;
        return () => values[Math.min(i++, values.length - 1)];
      })(),
    });
    assert.equal(picked?.id, 'barky');

    const before = p.mutationPressure?.stem ?? 0;
    // 1000 ticks at 20 Hz is a 50 s half-life, so 50 s of decay halves it.
    decayPlantPressure(p, weighted, 50, 20);
    const after = p.mutationPressure?.stem ?? 0;
    assert.ok(after < before);
    assert.ok(after > before * 0.4 && after < before * 0.6);
  });

  it('charges every held mutation maintenance and can kill through it', () => {
    const p = plant();
    p.mutations = [
      { id: 'leafy', acquiredTick: 1, nodeId: null },
      { id: 'barky', acquiredTick: 2, nodeId: null },
    ];
    const cfg = config();
    const cost = mutationMaintenance(p, cfg);
    assert.equal(cost.energyPerSecond, 0.2);
    assert.equal(dominantSignature(p, cfg), 2);
  });

  it('applies held mutation stat multipliers', () => {
    const p = plant();
    p.mutations = [{ id: 'shady', acquiredTick: 1, nodeId: null }];
    const cfg = config({
      definitions: [
        definition('shady', {
          effects: { photosynthesisMultiplier: 1.2, growthCostMultiplier: 1.1 },
        }),
      ],
    });
    const effects = mutationEffects(p, cfg);
    assert.equal(effects.photosynthesisMultiplier, 1.2);
    assert.equal(effects.growthCostMultiplier, 1.1);
    assert.equal(effects.energyUpkeepMultiplier, 1);
  });

  it('aggregates size, growth speed and unlocked node types', () => {
    const p = plant();
    p.mutations = [
      { id: 'bulky', acquiredTick: 1, nodeId: null },
      { id: 'quick', acquiredTick: 2, nodeId: null },
    ];
    const cfg = config({
      definitions: [
        definition('bulky', {
          effects: { sizeMultiplier: 1.25, rootSizeMultiplier: 1.4 },
        }),
        definition('quick', {
          effects: { growthSpeedMultiplier: 1.3, unlockNodeTypes: ['flower'] },
        }),
      ],
    });
    const effects = mutationEffects(p, cfg);
    assert.equal(effects.sizeMultiplier, 1.25);
    assert.equal(effects.rootSizeMultiplier, 1.4);
    assert.equal(effects.growthSpeedMultiplier, 1.3);
    assert.deepEqual(effects.unlockNodeTypes, ['flower']);
  });

  it('caps the product of size multipliers at the configured ceiling', () => {
    // Size is a product: two size mutations, each levelled, multiplied past three
    // times a normal internode and a branch came out longer than the trunk it left.
    // The ceiling is config (max_size_multiplier); this test pins that it is
    // applied and that the value under it is left exactly as the mutations made it.
    const p = plant();
    p.mutations = [
      { id: 'bulky', acquiredTick: 1, nodeId: null },
      { id: 'bulkier', acquiredTick: 2, nodeId: null },
    ];
    const cfg = config({
      maxSizeMultiplier: 2,
      definitions: [
        definition('bulky', { effects: { sizeMultiplier: 1.25, rootSizeMultiplier: 1.4 } }),
        definition('bulkier', { effects: { sizeMultiplier: 1.3, rootSizeMultiplier: 1.3 } }),
        definition('bulkiest', { effects: { sizeMultiplier: 1.4, rootSizeMultiplier: 1.4 } }),
      ],
    });
    // 1.25 * 1.3 = 1.625 before any level card; the second mutation alone does not
    // reach the ceiling, so the ceiling is exercised with a third.
    const capped = mutationEffects(p, cfg);
    assert.equal(capped.sizeMultiplier, 1.625);
    assert.equal(Math.round(capped.rootSizeMultiplier * 1e6) / 1e6, 1.82);
    p.mutations = [
      { id: 'bulky', acquiredTick: 1, nodeId: null },
      { id: 'bulkier', acquiredTick: 2, nodeId: null },
      { id: 'bulkiest', acquiredTick: 3, nodeId: null },
    ];
    const over = mutationEffects(p, cfg);
    // 1.25 * 1.3 * 1.4 = 2.275 -> capped at 2, and the root product with it.
    assert.equal(over.sizeMultiplier, 2);
    assert.equal(over.rootSizeMultiplier, 2);
    // A plant under the ceiling keeps its real product.
    const single = plant();
    single.mutations = [{ id: 'bulky', acquiredTick: 1, nodeId: null }];
    assert.equal(mutationEffects(single, cfg).sizeMultiplier, 1.25);
    // A config that names no ceiling does not invent one.
    assert.ok(
      mutationEffects(p, config({ ...cfg, maxSizeMultiplier: undefined })).sizeMultiplier > 2,
    );
  });

  it('scales upkeep so a mutation costs more than holding none', () => {
    const p = plant();
    p.mutations = [{ id: 'leafy', acquiredTick: 1, nodeId: null }];
    const base = mutationMaintenance(p, config());
    const scaled = mutationMaintenance(p, config({ maintenanceScale: 1.5 }));
    assert.ok(scaled.energyPerSecond > base.energyPerSecond);
    assert.equal(scaled.energyPerSecond, base.energyPerSecond * 1.5);
  });

  it('scales upkeep with the number, size and kind of affected nodes', () => {
    const p = plant();
    const node = (id: string, layer: 'root' | 'canopy', biomass: number): PlantNode =>
      ({
        id,
        plantId: p.id,
        type: layer === 'root' ? 'root' : 'leaf',
        layer,
        x: 0,
        y: 0,
        z: 0,
        biomass,
        age: 0,
        parentId: null,
        children: [],
        statModifiers: { growthSpeed: 1, waterEfficiency: 1, nutrientEfficiency: 1 },
        resourceDrawWater: 0,
        resourceDrawNutrients: 0,
        resourceDrawMinerals: 0,
        upkeepBiomassPerSecond: 0,
        growthDirectionBias: { x: 0, y: 1, z: 0 },
        lastGrowthTick: 0,
        growthProgress: 1,
        isSeed: false,
      }) as unknown as PlantNode;
    p.nodes.set('l1', node('l1', 'canopy', 4));
    p.nodes.set('l2', node('l2', 'canopy', 6));
    p.nodes.set('r1', node('r1', 'root', 2));
    p.mutations = [{ id: 'leafy', acquiredTick: 1, nodeId: null }];
    const cfg = config({ upkeepNodeScale: 0.5, upkeepBiomassScale: 0.1 });
    const leafy = cfg.definitions.find((d) => d.id === 'leafy');
    assert(leafy);
    const affected = mutationAffectedMass(p, leafy);
    const cost = mutationMaintenance(p, cfg);
    const expected = 0.1 * (1 + 0.5 * affected.count + 0.1 * affected.biomass);
    assert.ok(Math.abs(cost.energyPerSecond - expected) < 1e-9);
    assert.equal(affected.count, 2, 'canopy billing counts canopy nodes only');
    assert.equal(affected.biomass, 10);

    // A root-shaped mutation bills the root system instead of the canopy.
    const rootDefinition = definition('rooty', { effects: { rootSizeMultiplier: 1.2 } });
    const rootMass = mutationAffectedMass(p, rootDefinition);
    assert.equal(rootMass.count, 1);
    assert.equal(rootMass.biomass, 2);
  });

  it('sheds with a penalty and refuses during cooldown', () => {
    const p = plant();
    p.mutations = [{ id: 'barky', acquiredTick: 1, nodeId: null }];
    const cfg = config();

    const first = shedMutation(p, cfg, 'barky', 10, 20);
    assert.equal(first.ok, true);
    assert.equal(p.mutations?.length, 0);
    assert.equal(p.totalBiomass, 18); // 10% of 20
    assert.equal(first.cooldownRemainingS, undefined);

    p.mutations = [{ id: 'leafy', acquiredTick: 2, nodeId: null }];
    const during = shedMutation(p, cfg, 'leafy', 11, 20);
    assert.equal(during.ok, false);
    assert.equal(during.reason, 'shed_cooldown');
    assert.ok((during.cooldownRemainingS ?? 0) > 0);
  });

  it('omits pressure bias when adaptive pressure is disabled', () => {
    const p = plant();
    const off = config({ adaptivePressureEnabled: false });
    recordInvestment(p, off, 'stem', 100);
    const picked = rollMutation(p, off, {
      tick: 1,
      nodeType: 'growth',
      biomass: 0,
      environment,
      random: (() => {
        const values = [0, 0.9];
        let i = 0;
        return () => values[Math.min(i++, values.length - 1)];
      })(),
    });
    // With pressure off the pool is even, so 0.9 lands in the second slot.
    assert.equal(picked?.id, 'barky');
  });
});

describe('T04 mutation levels', () => {
  it('costs more each level and refuses while unaffordable', () => {
    const cfg = config();
    const p = plant();
    p.mutations = [{ id: 'leafy', acquiredTick: 1, nodeId: null, level: 1 }];

    // 20 biomass: level 2 costs 10 + 20×(1) energy and 5% of the body.
    assert.deepEqual(levelUpCost(p, cfg, 1), { energy: 30, biomass: 1 });
    p.totalEnergy = 0;
    // Level 3 adds the per-level step to both parts.
    assert.deepEqual(levelUpCost(p, cfg, 2), { energy: 10 + 10 + 20 * (1 + 1), biomass: 2 });

    const poor = checkLevelUp(p, cfg, 'leafy');
    assert.equal(poor.ok, false);
    assert.equal(poor.reason, 'insufficient_energy');
    assert.equal(poor.level, 1);

    p.totalEnergy = 500;
    p.totalBiomass = 100;
    assert.equal(checkLevelUp(p, cfg, 'leafy').ok, true);
    // The bill never takes the plant below the upkeep floor.
    p.totalBiomass = cfg.upkeepBiomassFloor;
    assert.equal(checkLevelUp(p, cfg, 'leafy').reason, 'insufficient_biomass');

    assert.equal(checkLevelUp(p, cfg, 'not_held').reason, 'mutation_not_held');
  });

  it('deals only cards the mutation can grow into, and never repeats one', () => {
    const bulky = definition('bulky', {
      effects: { sizeMultiplier: 1.25, waterCapacityMultiplier: 1.2 },
    });
    const cfg = config({ definitions: [bulky] });
    const pool = levelCardsFor(cfg, bulky).map((card) => card.id);
    assert.deepEqual(
      pool,
      ['waterCapacityMultiplier', 'energyUpkeepMultiplier', 'sizeMultiplier'].sort(),
    );

    const p = plant();
    p.mutations = [{ id: 'bulky', acquiredTick: 1, nodeId: null, level: 1 }];
    p.totalEnergy = 500;
    p.totalBiomass = 100;
    const offers = buildLevelOffers(cfg, 'bulky', () => 0);
    assert.ok(offers);
    assert.equal(offers.length, 3);
    assert.equal(new Set(offers.map((card) => card.id)).size, offers.length);
    for (const card of offers) assert.ok(pool.includes(card.id), card.id);
  });

  it('applies the chosen card, compounds the effect and stops at the cap', () => {
    const bulky = definition('bulky', { effects: { sizeMultiplier: 1.25 } });
    const cfg = config({
      definitions: [bulky],
      ...{
        levelUp: { ...config().levelUp, maxLevel: 2 },
      },
    });
    const p = plant();
    p.mutations = [{ id: 'bulky', acquiredTick: 1, nodeId: null, level: 1 }];
    p.totalEnergy = 500;
    p.totalBiomass = 100;

    const offers = buildLevelOffers(cfg, 'bulky', () => 0);
    assert.ok(offers && offers.length > 0);
    const refused = applyLevelUp(p, cfg, 'bulky', 'photosynthesisMultiplier', offers);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'card_not_offered');

    const sizeCard = offers.find((card) => card.id === 'sizeMultiplier');
    assert.ok(sizeCard, 'a size mutation offers a size card');
    const result = applyLevelUp(p, cfg, 'bulky', 'sizeMultiplier', offers);
    assert.equal(result.ok, true);
    assert.equal(result.level, 2);
    assert.deepEqual(p.mutations?.[0].cards, ['sizeMultiplier']);
    assert.equal(p.totalEnergy, 500 - (result.cost?.energy ?? 0));

    // The card composes with the base effect: 1.25 × 1.15.
    assert.ok(Math.abs(mutationEffects(p, cfg).sizeMultiplier - 1.25 * 1.15) < 1e-9);
    // And the running bill climbs 15% a level.
    assert.ok(Math.abs(mutationMaintenance(p, cfg).energyPerSecond - 0.1 * 1.15) < 1e-9);

    p.totalEnergy = 500;
    assert.equal(checkLevelUp(p, cfg, 'bulky').reason, 'max_level');
  });
});
