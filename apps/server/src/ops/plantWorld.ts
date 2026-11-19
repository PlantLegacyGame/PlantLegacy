import type {
  GrowthConfig,
  GrowthIntent,
  GrowthOptionsResult,
  GrowthResult,
  NodeType,
  NodeTypeDefinition,
  Plant,
  PlantNode,
} from '@plant-legacy/shared/growth';
import {
  applyMutationShapeBias,
  canCrossLayer,
  clampChildSegmentLength,
  clampGrowthDirectionByGene,
  getAvailableGrowthTypes,
  getLayerForNodeType,
  getNodeTypeDefinition,
  growthTargetMass,
  healthPhotosynthesisMultiplier,
  nodeHealth,
  nodeRenderRadius,
  placeSegment,
  plantHealth,
  resolveAttachFraction,
  tissueMassQuota,
} from '@plant-legacy/shared/growth';
import { newId } from '@plant-legacy/shared/ids';
import { isCleanRepair, repairPlantGraph } from '@plant-legacy/shared/plantGraphRepair';
import { validatePlantGraph } from '@plant-legacy/shared/plantGraphValidator';
import { eventBus, GAME_EVENTS } from './eventBus.ts';
import { NodeSpatialIndex } from './growth/nodeSpatialIndex.ts';
import { buildGrowthOptions } from './growth/options.ts';
import {
  attachmentPart,
  canGrow,
  computeGrowthCostQuote,
  computeNodeRadii,
  type GrowthChargeScale,
  getGrowthSpeed,
  growthDrawPerSecond,
  isUsableDirection,
  maxCotyledonsForPlant,
  nodeName,
  normalizeDirection,
  validateGrowthDirection,
  validateIntentDirection,
} from './growth/rules.ts';
import {
  applyLevelUp as applyLevelUpRule,
  buildLevelOffers,
  checkLevelUp,
  decayPlantPressure,
  dominantSignature,
  mutationEffects,
  mutationLevel,
  mutationMaintenance,
  type ResolvedMutationEffects,
  recordInvestment,
  rollMutation,
  type ShedResult,
  shedMutation as shedMutationRule,
} from './mutations/service.ts';
import type {
  MutationDefinition,
  MutationEnvironment,
  MutationsConfig,
} from './mutations/types.ts';
import { computePlantCapacity } from './plantCapacity.ts';
import {
  createPlantTierConfigs,
  createPlantTierStateMachine,
  type PlantTierStateMachine,
  plantTierStateMachineGetPlantsByTier,
  plantTierStateMachineGetTierStats,
  plantTierStateMachineUpdate,
} from './plantTierStateMachine.ts';
import type { ResourcesConfig, TileResources } from './resourceWorld.ts';

// Re-exported from the rules module so existing callers keep one import site.
export { computeGrowthCostQuote, type GrowthCostQuote } from './growth/rules.ts';

/**
 * Every pure rule this class used to carry now lives in ./growth/rules.ts and
 * ./growth/options.ts; the class keeps storage, ticking and broadcasting.
 */

export type PlantDeathCause =
  | 'starvation'
  | 'damage'
  | 'germination_failed'
  | 'removed'
  | 'reconnect_timeout'
  /**
   * Legacy only: mutation upkeep no longer kills, but old saves and old death
   * reports can still name it, so the cause stays in the union.
   */
  | 'mutation_upkeep'
  /** The season ended: the calamity takes every plant still standing. */
  | 'calamity';

export interface ResourceSink {
  takeResources(
    worldX: number,
    worldZ: number,
    waterDemand: number,
    mineralDemand: number,
    /** Deep roots may also draw from the groundwater cavity. */
    allowGroundwater?: boolean,
  ): { water: number; minerals: number };
}

export interface PlantDeathRecord {
  id: string;
  ownerId: string;
  worldId: string;
  nodes: Map<string, PlantNode>;
  totalBiomass: number;
  totalUpkeep: number;
  rootNodeId: string | null;
  cause: PlantDeathCause;
  /**
   * What actually did it, when the cause is too coarse to say. 'tool' means
   * another player's tool, 'weather' means the storm, 'uprooted' means it was
   * torn free and bled out, 'thirst'/'minerals'/'no_energy' split starvation
   * into the store that ran dry. Clients show this next to the cause instead of
   * reporting every loss as "damage".
   */
  killedBy?: string;
}

export class PlantWorld {
  private plants = new Map<string, Plant>();
  private plantByOwner = new Map<string, Set<string>>();
  private readonly nodeSpatialIndex = new NodeSpatialIndex();
  private pendingDeaths: PlantDeathRecord[] = [];
  private pendingTierTransitions: Array<{
    plantId: string;
    oldTier: 'active' | 'near' | 'dormant';
    newTier: 'active' | 'near' | 'dormant';
  }> = [];
  private pendingGrowthResults: GrowthResult[] = [];
  private readonly config: GrowthConfig;
  private readonly worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minY: number;
    maxY: number;
  };

  private resourceProvider: ((x: number, z: number) => TileResources) | null = null;
  private resourceSink: ResourceSink | null = null;
  private growthResistanceProvider: ((x: number, y: number, z: number) => number) | null = null;
  /**
   * Photosynthesis for one plant over a span of seconds.
   *
   * Near and dormant plants are stepped here rather than in the online loop, so
   * without this hook an offline plant paid upkeep and never fixed carbon: it
   * starved in the dark even at noon. The world supplies the routine, keeping the
   * light/moisture formula in one place.
   */
  private photosynthesisHook: ((plant: Plant, seconds: number) => void) | null = null;

  private activeTickRateHz: number;
  /** Elapsed wall time banked for a tier that runs below the active rate. */
  private nearAccumulatorMs = 0;
  private dormantAccumulatorMs = 0;

  private tierMachine: PlantTierStateMachine;

  private readonly tickBudgetActiveShare: number;
  private readonly tickBudgetWarnThresholdMs: number;
  private readonly resourceConfig: ResourcesConfig;
  private nearTickRateHz: number;
  private dormantTickRateHz: number;

  /** T04 mutation rules; null until the world supplies its config. */
  private mutationConfig: MutationsConfig | null = null;
  /**
   * T06: may a plant torn out of the soil still grow new parts?
   *
   * False by default and set from `uproot.detached_growth_enabled` at boot. A
   * detached plant has no roots to supply a shoot, so the only way forward is
   * the reroot crawl. The flag lives here rather than in `canGrow` so the menu
   * and the charge read the same value (INV-GR-13).
   */
  private detachedGrowthEnabled = false;
  private mutationEnvironmentProvider: ((x: number, z: number) => MutationEnvironment) | null =
    null;
  /** Injectable so mutation rolls are deterministic under test. */
  private mutationRandom: () => number = Math.random;
  /**
   * Cards laid out for a pending level-up, per plant. Transient by design: a
   * reconnect drops the deal and the player can ask again, which is cheaper
   * than persisting a choice nobody made.
   */
  private mutationLevelOffers = new Map<
    string,
    {
      mutationId: string;
      level: number;
      offers: Array<{ id: string; label: string; step: number }>;
    }
  >();

  constructor(
    config: GrowthConfig,
    worldBounds: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      minY: number;
      maxY: number;
    },
    tierConfig?: {
      activeTickRateHz?: number;
      nearTickRateHz?: number;
      dormantStepIntervalSec?: number;
      tickBudgetActiveShare?: number;
      tickBudgetWarnThresholdMs?: number;
      nearDistance?: number;
    },
    resourceConfig?: ResourcesConfig,
  ) {
    this.config = config;
    this.resourceConfig = resourceConfig ?? {
      tileSize: 1,
      gridWidth: 100,
      gridHeight: 100,
      tileLightBase: 100,
      dayNightCurve: [0, 0.5, 1, 0.5, 0],
      tileMoistureBase: 50,
      rainGainPerS: 5,
      evaporationPerS: 1,
      temperatureBase: 20,
      temperatureAmplitude: 10,
      temperatureSunFactor: 5,
      transpirationFactor: 1,
      photosynthesisTempOptimum: 22,
      photosynthesisTempRange: 10,
      tileMineralsBase: 100,
      absorptionPerS: 2,
      absorptionRadius: 2,
      deadRootDeposit: 10,
      deadPlantDeposit: 25,
      dungDeposit: 20,
      fertilizerDeposit: 50,
      photosynthesisRate: 1,
      photosynthesisEnergyPerSecond: 1,
      photosynthesisWaterPerEnergy: 0.03,
      photosynthesisMineralPerEnergy: 0.006,
      waterStatusFullFraction: 0.25,
      mineralStatusFullFraction: 0.25,
      nightTranspirationMultiplier: 0.15,
      lightFactorCurve: [
        [0, 0],
        [1, 1],
      ],
      moistureFactorCurve: [
        [0, 0],
        [1, 1],
      ],
      mineralFactorCurve: [
        [0, 0],
        [1, 1],
      ],
      diffusionRate: 0.1,
      lightDirtyThreshold: 0.05,
      resourceDirtyThreshold: 0.1,
      maxAbsorptionPerTick: 10,
      groundwaterBase: 0,
      groundwaterCapacity: 400,
      groundwaterRechargeFraction: 0.5,
      groundwaterInfiltrationFraction: 0.55,
      groundwaterPercolationRate: 0.04,
      groundwaterCapillaryRisePerS: 0.15,
      groundwaterRootUptakeFraction: 0.25,
      groundwaterRootReserveFraction: 0.05,
      canopyShadeReduction: 0.2,
      maxLight: 100,
      maxMoisture: 100,
      maxMinerals: 100,
    };
    this.worldBounds = worldBounds;
    this.activeTickRateHz = tierConfig?.activeTickRateHz ?? 20;
    this.nearTickRateHz = tierConfig?.nearTickRateHz ?? 5;
    const dormantStepIntervalSec = tierConfig?.dormantStepIntervalSec ?? 30;
    this.dormantTickRateHz = 1 / dormantStepIntervalSec;
    this.tickBudgetActiveShare = tierConfig?.tickBudgetActiveShare ?? 0.7;
    this.tickBudgetWarnThresholdMs = tierConfig?.tickBudgetWarnThresholdMs ?? 40;

    const tierConfigs = createPlantTierConfigs(
      this.activeTickRateHz,
      this.nearTickRateHz,
      this.dormantTickRateHz,
    );
    this.tierMachine = createPlantTierStateMachine(
      {
        nearDistance: tierConfig?.nearDistance ?? 50,
      },
      tierConfigs,
    );
  }

  getConfig(): GrowthConfig {
    return this.config;
  }

  setGerminationGate(enabled: boolean): void {
    this.config.germinationGate = enabled;
  }

  setGerminationFailureKillsSeed(enabled: boolean): void {
    this.config.germinationFailureKillsSeed = enabled;
  }

  getGrowthCooldown(): number {
    return this.config.growthCooldown;
  }

  getMaxNodesPerPlant(): number {
    return this.config.maxNodesPerPlant;
  }

  /**
   * Share of photosynthesis the plant keeps at its current health (T04).
   *
   * One reader for every photosynthesis path: the online loop and the offline
   * catch-up both go through `World.photosynthesizePlant`, so a wilting plant
   * fixes less carbon whether or not anybody is watching.
   */
  getPhotosynthesisHealthMultiplier(plant: Plant): number {
    return healthPhotosynthesisMultiplier(plantHealth(plant, this.config), this.config);
  }

  setResourceProvider(provider: (x: number, z: number) => TileResources): void {
    this.resourceProvider = provider;
  }

  /**
   * Wire soil strength into growth. Compact, dry, deep soil costs more energy
   * and takes longer to push a root through; the return value is a multiplier
   * already clamped by the terrain config.
   */
  setGrowthResistanceProvider(provider: (x: number, y: number, z: number) => number): void {
    this.growthResistanceProvider = provider;
  }

  /**
   * Wire the world's tile store so uptake debits the tile as well as crediting
   * the plant. Without it, absorption is free and resources are infinite.
   */
  setResourceSink(sink: ResourceSink): void {
    this.resourceSink = sink;
  }

  /** Wire photosynthesis so near and dormant tiers are fed by the sun too. */
  setPhotosynthesis(hook: (plant: Plant, seconds: number) => void): void {
    this.photosynthesisHook = hook;
  }

  /**
   * Everything the world adds to a growth quote before it charges it.
   *
   * The menu and `tryGrow` read this one function, so the price on a card is
   * the price the server takes. It is measured at the part the growth leaves
   * from, not at the new part's target: the menu cannot know the direction, and
   * a lateral root's resistance is about the soil around the parent anyway.
   */
  growthChargeScale(
    plant: Plant,
    node: PlantNode,
    targetLayer: 'root' | 'canopy',
  ): GrowthChargeScale {
    const effects = this.getMutationEffects(plant);
    const resistance =
      targetLayer === 'root'
        ? Math.max(0.25, this.growthResistanceProvider?.(node.x, node.y, node.z) ?? 1)
        : 1;
    return {
      resistance,
      energyMultiplier: resistance * Math.max(0.01, effects.growthCostMultiplier),
      timeMultiplier: resistance / Math.max(0.1, effects.growthSpeedMultiplier),
    };
  }

  getGrowthOptions(plantId: string, nodeId: string): GrowthOptionsResult | null {
    const plant = this.plants.get(plantId);
    if (!plant) return null;

    const node = plant.nodes.get(nodeId);
    if (!node) return null;

    const tile = this.resourceProvider ? this.resourceProvider(node.x, node.z) : undefined;
    const effects = this.getMutationEffects(plant);
    const unlocked = effects.unlockNodeTypes as NodeType[];
    const scales = this.mutationSizeScales(plant);
    const massScale = node.layer === 'root' ? scales.root : scales.canopy;
    // Only root tissue draws on the clonal network's shared reserves.
    const sharing = node.layer === 'root' ? effects.storedResourceSharing : 0;
    const result = buildGrowthOptions(
      this.config,
      plant,
      node,
      tile,
      unlocked,
      sharing,
      massScale,
      (targetType) => this.growthChargeScale(plant, node, getLayerForNodeType(targetType)),
    );
    if (plant.uproot && !this.detachedGrowthEnabled) {
      // Say so on every option instead of hiding them: "no options" reads as a
      // bug, "reroot first" reads as the rule it is.
      result.options = result.options.map((option) => ({
        ...option,
        available: false,
        reason: 'Detached: reroot before growing',
      }));
    }
    return result;
  }

  /** T06: `uproot.detached_growth_enabled`, read once at boot. */
  setDetachedGrowthEnabled(enabled: boolean): void {
    this.detachedGrowthEnabled = enabled;
  }

  isDetachedGrowthEnabled(): boolean {
    return this.detachedGrowthEnabled;
  }

  setMutations(config: MutationsConfig): void {
    this.mutationConfig = config;
  }

  getMutationConfig(): MutationsConfig | null {
    return this.mutationConfig;
  }

  /** The world supplies light/moisture/weather for the growth a roll happened in. */
  setMutationEnvironmentProvider(provider: (x: number, z: number) => MutationEnvironment): void {
    this.mutationEnvironmentProvider = provider;
  }

  setMutationRandom(random: () => number): void {
    this.mutationRandom = random;
  }

  /** Stat multipliers every held mutation contributes (1 when none). */
  getMutationEffects(plant: Plant): ResolvedMutationEffects {
    if (!this.mutationConfig) {
      return {
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
    }
    return mutationEffects(plant, this.mutationConfig);
  }

  /** Capacity with mutation storage multipliers applied (T04). */
  private capacityFor(plant: Plant): { energy: number; water: number; minerals: number } {
    const base = computePlantCapacity(plant, this.config);
    const effects = this.getMutationEffects(plant);
    return {
      energy: base.energy,
      water: base.water * effects.waterCapacityMultiplier,
      minerals: base.minerals * effects.mineralCapacityMultiplier,
    };
  }

  /** The single place a plant's look parameters are assembled. */
  private appearanceOf(plant: Plant): {
    petalCount: number;
    leafScale: number;
    seedScale: number;
  } {
    const effects = this.getMutationEffects(plant);
    return {
      petalCount: effects.petalCount,
      leafScale: effects.leafScaleMultiplier,
      seedScale: effects.seedScaleMultiplier,
    };
  }

  /**
   * The dominant mutation's own visual parameters, for rivals in sync payloads.
   * The client turns these into a look, so a rival is drawn with its pigment
   * instead of the neutral default.
   */
  getPlantPigment(plantId: string): {
    visualSignature: number;
    visualParams: [number, number, number];
    visualTarget: MutationDefinition['visualTarget'];
  } | null {
    const plant = this.plants.get(plantId);
    const config = this.mutationConfig;
    if (!plant || !config) return null;
    let best: MutationDefinition | null = null;
    for (const held of plant.mutations ?? []) {
      const definition = config.definitions.find((entry) => entry.id === held.id);
      if (definition && (!best || definition.visualSignature > best.visualSignature)) {
        best = definition;
      }
    }
    if (!best) return null;
    return {
      visualSignature: best.visualSignature,
      visualParams: [...best.visualParams] as [number, number, number],
      visualTarget: best.visualTarget,
    };
  }

  /** T04 look parameters for any plant (own or rival) in sync payloads. */
  getPlantAppearance(
    plantId: string,
  ): { petalCount: number; leafScale: number; seedScale: number } | null {
    const plant = this.plants.get(plantId);
    return plant ? this.appearanceOf(plant) : null;
  }

  /** Public capacity (mutation storage multipliers included) for payloads. */
  getPlantCapacity(plantId: string): { energy: number; water: number; minerals: number } | null {
    const plant = this.plants.get(plantId);
    if (!plant) return null;
    return this.capacityFor(plant);
  }

  /** Clamp stored resources to the mutated capacity, not the base one. */
  private clampStorage(plant: Plant): void {
    const capacity = this.capacityFor(plant);
    plant.totalEnergy = Math.min(plant.totalEnergy, capacity.energy);
    plant.storedWater = Math.min(plant.storedWater, capacity.water);
    plant.storedMinerals = Math.min(plant.storedMinerals, capacity.minerals);
  }

  /**
   * Drawn radius for a part, honouring the widest form it was built under. Every
   * path that changes biomass goes through here so a part never switches
   * between two radius rules mid-life.
   */
  private refreshRadius(node: PlantNode): void {
    node.radius = nodeRenderRadius(node.type, node.biomass, Math.max(1, node.massScale ?? 1));
  }

  /**
   * Size mutations are tissue, not a shader scale.
   *
   * A node holds `quota × scale³` mass under a size mutation, and
   * `nodeRenderRadius` turns mass into a radius, so a 1.25× form holds 1.95× the
   * mass and is drawn 1.25× as wide. Radii therefore always come from biomass
   * alone - the same table damage, drought and repair already use - and a plant
   * is never drawn at a size its tissue does not back up.
   *
   * `grant` is true when the mutation set grew (acquire, level-up, dev grant,
   * load): tissue the new form can hold appears at once, but only in parts that
   * are already at their base quota, so a reload can never heal damage. Shedding
   * never passes `grant`: the excess drains through `absorbOversizeMass`, which
   * is what keeps the plant from snapping back to its old size.
   */
  private syncMutationMass(plant: Plant, options: { grant: boolean }): void {
    const scales = this.mutationSizeScales(plant);
    let total = 0;
    for (const node of plant.nodes.values()) {
      const target = this.nodeTargetMass(node, scales);
      if (options.grant && target > 0) {
        const base = tissueMassQuota(node, this.config);
        const scale = node.layer === 'root' ? scales.root : scales.canopy;
        // The form the part is built under widens how wide it may be drawn; it
        // only ever grows so a shed cannot shrink the body in one step.
        if (scale > 1) node.massScale = Math.max(node.massScale ?? 1, scale);
        // A damaged or still-extending part keeps the mass it has: the bonus
        // belongs to tissue that is actually there.
        if (!node.isSeed && node.biomass >= base - 1e-6 && node.biomass < target) {
          node.biomass = target;
        }
      }
      this.refreshRadius(node);
      total += node.biomass;
    }
    plant.totalBiomass = total;
  }

  /** Linear size factor the current mutation set grants each layer. */
  private mutationSizeScales(plant: Plant): { canopy: number; root: number } {
    const effects = this.getMutationEffects(plant);
    return {
      canopy: Math.max(0.1, effects.sizeMultiplier),
      root: Math.max(0.1, effects.rootSizeMultiplier),
    };
  }

  /** Mass a part holds at its current quota and the mutations it grows under. */
  private nodeTargetMass(node: PlantNode, scales: { canopy: number; root: number }): number {
    if (node.isSeed) return node.biomass;
    const scale = node.layer === 'root' ? scales.root : scales.canopy;
    return tissueMassQuota(node, this.config) * scale ** 3;
  }

  /**
   * Tissue the current form no longer supports drains away slowly.
   *
   * Shedding a size mutation leaves the plant heavier than its form allows. It
   * does not snap down: the excess is lost at `oversize_wilt_per_s` of itself per
   * second, each part thinning as its own mass falls, so the body shrinks
   * continuously back to the size the remaining mutation set can carry. Stored
   * water, minerals and energy above the new capacity leak at
   * `oversize_leak_per_s` for the same reason - the loss has to be visible over
   * time, not a number that jumps.
   */
  private absorbOversizeMass(plant: Plant, dt: number): void {
    const config = this.mutationConfig;
    if (!config || dt <= 0) return;
    const scales = this.mutationSizeScales(plant);
    const wilt = Math.min(1, Math.max(0, config.oversizeWiltPerS) * dt);
    let lost = 0;
    for (const node of plant.nodes.values()) {
      if (node.isSeed) continue;
      const target = this.nodeTargetMass(node, scales);
      const excess = node.biomass - target;
      if (excess <= 1e-6) continue;
      const take = excess * wilt;
      if (take <= 0) continue;
      node.biomass = Math.max(0, node.biomass - take);
      this.refreshRadius(node);
      lost += take;
    }
    if (lost > 0) plant.totalBiomass = Math.max(0, plant.totalBiomass - lost);

    const capacity = this.capacityFor(plant);
    const leak = Math.min(1, Math.max(0, config.oversizeLeakPerS) * dt);
    const leakDown = (stored: number, cap: number): number =>
      stored > cap ? stored - (stored - cap) * leak : stored;
    plant.totalEnergy = leakDown(plant.totalEnergy, capacity.energy);
    plant.storedWater = leakDown(plant.storedWater, capacity.water);
    plant.storedMinerals = leakDown(plant.storedMinerals, capacity.minerals);
  }

  /**
   * The mutation set, upkeep and pressure this plant carries, for MUTATION_STATE.
   * Presentation only: the server never lets a client write these values.
   */
  getMutationState(
    plantId: string,
    currentTick: number,
  ): {
    plantId: string;
    mutations: Array<{
      id: string;
      name: string;
      kind: MutationDefinition['kind'];
      visualSignature: number;
      visualParams: [number, number, number];
      visualTarget: MutationDefinition['visualTarget'];
      energyPerSecond: number;
      biomassPerSecond: number;
      level: number;
      maxLevel: number;
      /** Cost of the next level; the client shows it before asking. */
      levelCostEnergy: number;
      levelCostBiomass: number;
      /** Why the next level is refused right now, when it is. */
      levelBlocked?: string;
    }>;
    totalUpkeepEnergyPerSecond: number;
    /** Plant-wide look parameters the client renderer consumes. */
    appearance: { petalCount: number; leafScale: number; seedScale: number };
    pressure: Record<string, number>;
    signature: number;
    shedCooldownRemainingS: number;
    /** The cards currently laid out for a level-up, if the player asked. */
    levelOffer: {
      mutationId: string;
      level: number;
      cards: Array<{ id: string; label: string; step: number }>;
    } | null;
  } | null {
    const plant = this.plants.get(plantId);
    const config = this.mutationConfig;
    if (!plant || !config) return null;

    const mutations: Array<{
      id: string;
      name: string;
      kind: MutationDefinition['kind'];
      visualSignature: number;
      visualParams: [number, number, number];
      visualTarget: MutationDefinition['visualTarget'];
      energyPerSecond: number;
      biomassPerSecond: number;
      level: number;
      maxLevel: number;
      levelCostEnergy: number;
      levelCostBiomass: number;
      levelBlocked?: string;
    }> = [];
    for (const held of plant.mutations ?? []) {
      const definition = config.definitions.find((entry) => entry.id === held.id);
      if (!definition) continue;
      const check = checkLevelUp(plant, config, definition.id);
      const level = mutationLevel(held);
      const levelScale = 1 + config.levelUp.upkeepPerLevel * (level - 1);
      mutations.push({
        id: definition.id,
        name: definition.name,
        kind: definition.kind,
        visualSignature: definition.visualSignature,
        visualParams: [...definition.visualParams] as [number, number, number],
        visualTarget: definition.visualTarget,
        // Report the billed upkeep, not the raw config number: the client shows
        // this beside the total, and total already includes maintenance_scale.
        energyPerSecond:
          definition.maintenance.energyPerSecond * config.maintenanceScale * levelScale,
        biomassPerSecond: definition.maintenance.biomassPerSecond * levelScale,
        level,
        maxLevel: config.levelUp.maxLevel,
        levelCostEnergy: check.cost.energy,
        levelCostBiomass: check.cost.biomass,
        levelBlocked: check.ok ? undefined : check.reason,
      });
    }
    const maintenance = mutationMaintenance(plant, config);
    const cooldownUntil = plant.mutationShedCooldownUntil ?? 0;
    const pending = this.mutationLevelOffers.get(plantId);
    return {
      plantId,
      mutations,
      totalUpkeepEnergyPerSecond: maintenance.energyPerSecond,
      appearance: this.appearanceOf(plant),
      pressure: { ...(plant.mutationPressure ?? {}) },
      signature: plant.mutationSignature ?? dominantSignature(plant, config),
      shedCooldownRemainingS: Math.max(
        0,
        (cooldownUntil - currentTick) / Math.max(1, this.activeTickRateHz),
      ),
      levelOffer: pending
        ? { mutationId: pending.mutationId, level: pending.level, cards: pending.offers }
        : null,
    };
  }

  /** Mutation definitions in config order, for dev tooling and sync labels. */
  getMutationDefinitions(): Array<{ id: string; name: string }> {
    return (this.mutationConfig?.definitions ?? []).map((definition) => ({
      id: definition.id,
      name: definition.name,
    }));
  }

  /**
   * Dev showcase: one fully grown plant per mutation, laid out in rows.
   *
   * Comparing mutation art used to mean growing a plant, waiting for a roll,
   * and hoping for the one you wanted to see. This builds a garden instead: a
   * row per handful of mutations, one plant each, every plant carrying exactly
   * its own mutation, spaced far enough apart that their canopies do not
   * overlap.
   *
   * The body matters as much as the mutation. A seven-node seedling showed a
   * tint and nothing else: a bark mutation had no trunk to thicken, a spine
   * mutation had no length of stem to bristle along, a culm or trunk unlock had
   * no such part at all, and a size mutation was outgrown before it could be
   * seen. Each plant is therefore grown to a mature body that includes the
   * organs its mutation talks about, granted the mutation *before* growing so
   * its unlocks are legal organs, and then filled to its own mutated quota, so
   * what stands in the row is the mutation at full size.
   */
  buildMutationGallery(
    worldId: string,
    columns = 6,
    spacingM = 12,
    origin: { x: number; z: number } = { x: 0, z: 0 },
  ): { plants: number; rows: number; rejected: string[] } {
    // Rebuilding the gallery replaces the previous one instead of stacking a
    // second garden on top of it.
    for (const existing of Array.from(this.plants.values())) {
      if (existing.ownerId.startsWith('gallery:')) this.removePlant(existing.id);
    }
    const definitions = this.mutationConfig?.definitions ?? [];
    if (definitions.length === 0) return { plants: 0, rows: 0, rejected: [] };
    // Growth can refuse an organ (a direction the gene sector forbids, a node
    // budget, a missing unlock). Reporting that instead of silently drawing a
    // thinner plant is what makes "my gallery plant is a stick" diagnosable.
    const rejected: string[] = [];

    const cols = Math.max(1, Math.min(columns, definitions.length));
    const rows = Math.ceil(definitions.length / cols);
    // Gallery ticks only need to be monotonic for cooldowns; they are not the
    // live simulation tick and never move it.
    const tickBase = 100_000 + this.plants.size * 1_000;

    const fillStores = (plant: Plant): void => {
      plant.storedWater = 1e6;
      plant.storedMinerals = 1e6;
      plant.totalEnergy = 1e6;
    };

    let created = 0;
    definitions.forEach((definition, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = origin.x + (col - (cols - 1) / 2) * spacingM;
      // Rows run away from the viewer so every label has a clear line of sight.
      const z = origin.z - row * spacingM - spacingM;
      const plant = this.createPlant(`gallery:${definition.id}`, worldId, x, z);
      fillStores(plant);

      // The mutation comes first: its unlocked organs have to be legal growth
      // targets for the body built below, and its size has to shape the tissue
      // that grows into it. Granting it afterwards left every unlock with
      // nothing to grow from and every size mutation as a quota nobody filled.
      const mutationId = definition.id;
      const granted = this.grantMutation(plant.id, definition.id, tickBase + 50);
      if (!granted.ok) {
        this.removePlant(plant.id);
        return;
      }

      const seedId = plant.rootNodeId ?? Array.from(plant.nodes.keys())[0];
      let step = 1;
      const grow = (
        nodeId: string | null,
        direction: { x: number; y: number; z: number },
        nodeType: NodeType,
      ): string | null => {
        if (!nodeId) return null;
        fillStores(plant);
        const tick = tickBase + step * 100;
        step += 1;
        const result = this.tryGrow({ plantId: plant.id, nodeId, direction, nodeType, tick }, tick);
        if (result.success && result.newNode) return result.newNode.id;
        if (rejected.length < 40) {
          rejected.push(`${mutationId}:${nodeType}:${result.reason ?? 'unknown'}`);
        }
        return null;
      };
      const unlocked = this.getMutationEffects(plant).unlockNodeTypes;
      const has = (type: NodeType): boolean => unlocked.includes(type);
      // Every row used to be grown from the same numbers, so forty-five mutations
      // produced forty-five copies of one silhouette and the differences between
      // them were only in the shading. A deterministic per-mutation seed turns
      // the same body plan into a differently built plant: each gallery body gets
      // its own azimuth, its own lean, its own height and its own branching
      // habit, and the same mutation always grows the same plant because the
      // seed comes from the id.
      let variationSeed = 2166136261;
      for (let i = 0; i < mutationId.length; i += 1) {
        variationSeed ^= mutationId.charCodeAt(i);
        variationSeed = Math.imul(variationSeed, 16777619) >>> 0;
      }
      const rand = (): number => {
        variationSeed = (Math.imul(variationSeed, 1664525) + 1013904223) >>> 0;
        return variationSeed / 0xffffffff;
      };
      const spin = rand() * Math.PI * 2;
      const spinCos = Math.cos(spin);
      const spinSin = Math.sin(spin);
      // Rotate a horizontal direction into this plant's own azimuth and give it a
      // little scatter, so leaf and branch bearings never repeat row to row.
      const dir = (x: number, y: number, z: number): { x: number; y: number; z: number } => {
        const scatter = 0.78 + rand() * 0.44;
        return {
          x: (x * spinCos - z * spinSin) * scatter,
          y,
          z: (x * spinSin + z * spinCos) * scatter,
        };
      };
      // A trunk or a culm is the woody body of this plant: grow the column out
      // of the organ the mutation unlocked instead of a generic stem, so the row
      // shows what the name promises. Only those two may extend themselves -
      // the base growth rules let a stem raise branches, not more stem - so a
      // plain plant is grown as a stem with a canopy instead of a stick that
      // stopped after one segment.
      const woodyType: NodeType | null = has('trunk') ? 'trunk' : has('culm') ? 'culm' : null;
      // The base growth rules let a seed raise a stem, not a trunk: the woody
      // column is what the shoot becomes above its first internode, which is
      // also where a real trunk sits.
      const columnExtends = woodyType !== null;
      // A bloom mutation has to have a bloom on the plant to change: the petal
      // and colour mutations do not unlock the flower organ themselves, only
      // flowering_primordia does, so the gallery grows one either way.
      const wantsBloom = definition.visualTarget === 'bloom' || has('flower') || has('spore_sac');

      // --- roots ---------------------------------------------------------
      let rootTip = grow(seedId, { x: 0, y: -1, z: 0 }, 'radicle');
      for (const [kx, kz] of [
        [0.75, 0.2],
        [-0.5, 0.7],
        [0.1, -0.85],
      ] as Array<[number, number]>) {
        rootTip = grow(rootTip, dir(kx, -0.8, kz), 'lateral_root') ?? rootTip;
      }
      // Root-layer unlocks grow off the deepest root, where their own rules put
      // them: a rhizome and its tubers, a stolon, a pneumatophore.
      if (has('rhizome') || has('tuber') || has('stolon')) {
        const rhizome = grow(rootTip, dir(0.9, -0.25, 0.2), 'rhizome');
        if (has('tuber')) grow(rhizome, dir(0.6, -0.5, 0.5), 'tuber');
        if (has('stolon')) grow(rhizome, dir(0.9, -0.15, -0.3), 'stolon');
      }
      if (has('pneumatophore')) {
        // A breathing root rises out of the waterlogged layer: its sector is
        // upward, not down.
        grow(rootTip, dir(-0.7, 0.35, 0.5), 'pneumatophore');
      }

      // --- shoot ---------------------------------------------------------
      grow(seedId, dir(0.3, 0.95, 0), 'cotyledon');
      grow(seedId, dir(-0.3, 0.95, 0), 'cotyledon');
      let column = grow(seedId, { x: 0.05, y: 1, z: 0 }, 'stem');
      // Some bodies fork at the base instead of standing on one leg.
      if (rand() > 0.6) {
        const fork = dir(-0.35, 0.9, 0.3);
        const second = grow(seedId, { x: fork.x, y: fork.y, z: fork.z }, 'stem');
        grow(second, dir(0.45, 0.5, 0.2), 'leaf');
      }
      if (column && woodyType) {
        // The trunk (or culm) starts at the base of the stem and continues up.
        column = grow(column, { x: 0.05, y: 1, z: 0 }, woodyType) ?? column;
      }
      // A stem is one 35 cm internode, so a body only reads as a plant after a
      // handful of them. The count varies per mutation so the row has a range of
      // heights instead of a parade of identical bricks.
      const internodes = columnExtends ? 5 + Math.floor(rand() * 3) : 4 + Math.floor(rand() * 5);
      for (let internode = 0; internode < internodes && column; internode += 1) {
        const side = internode % 2 === 0 ? 1 : -1;
        // Leaves alternate sides so the foliage look is visible all the way up.
        // The direction is steep enough that a drooping-fronds bias (which pulls
        // foliage down) still lands inside the leaf's gene sector.
        grow(column, dir(0.7 * side, 0.55, 0.2 * side), 'leaf');
        if (has('thorn')) {
          grow(column, dir(0.5 * side, 0.1, 0.8), 'thorn');
        }
        // Shallow enough to survive a columnar habit's upward bias.
        const branch = grow(column, dir(0.7 * side, 0.35, 0.2), 'branch');
        grow(branch, dir(0.5 * side, 0.55, -0.3), 'leaf');
        grow(branch, dir(0.4 * side, 0.3, 0.7), 'leaf');
        if (has('vine')) {
          grow(branch, dir(-0.6, 0.6, -0.5), 'vine');
        }
        if (wantsBloom) {
          // A flower sits on a branch tip, where the growth rules put one.
          grow(
            branch,
            has('spore_sac') ? dir(0.5 * side, 0.45, -0.35) : dir(0.2 * side, 0.95, 0.3),
            has('spore_sac') ? 'spore_sac' : 'flower',
          );
        }
        if (columnExtends) {
          column = grow(column, dir(0.12 * side, 0.99, 0.08), woodyType ?? 'stem');
        } else {
          // A plain plant climbs by stacking internodes: one stem above the last.
          // The alternative - a single leader branch - left every plant in the
          // row a one-metre stump with a fan of leaves on top.
          column = grow(column, dir(0.1 * side, 0.97, 0.06), 'stem');
        }
      }
      // A floating pad belongs at the top of the shoot, over water.
      if (has('floating_leaf') && column) {
        grow(column, { x: 0.75, y: 0.05, z: 0.5 }, 'floating_leaf');
      }

      // Every part fully grown, then filled to the mutated quota so a size
      // mutation is shown at the size it actually gives the plant.
      for (const node of plant.nodes.values()) {
        node.growthProgress = 1;
        node.age = Math.max(node.age, 1);
      }
      fillStores(plant);
      this.fillPlantTissue(plant.id);
      created += 1;
    });

    return { plants: created, rows, rejected };
  }

  /**
   * Dev/testing helper: grant one mutation by id without a roll, so a mutation
   * can be inspected or measured without waiting for a chance event. Goes
   * through the same signature/size/event path as an acquired mutation.
   */
  grantMutation(plantId: string, mutationId: string, currentTick: number): ShedResult {
    const plant = this.plants.get(plantId);
    if (!plant) return { ok: false, reason: 'plant_not_found' };
    const config = this.mutationConfig;
    if (!config) return { ok: false, reason: 'mutations_disabled' };
    const definition = config.definitions.find((entry) => entry.id === mutationId);
    if (!definition) return { ok: false, reason: 'unknown_mutation' };
    if ((plant.mutations ?? []).some((held) => held.id === mutationId)) {
      return { ok: false, reason: 'already_held' };
    }
    if (!plant.mutations) plant.mutations = [];
    plant.mutations.push({ id: mutationId, acquiredTick: currentTick, nodeId: null, level: 1 });
    this.applyMutationSignature(plant);
    this.syncMutationMass(plant, { grant: true });
    eventBus.publishSync(GAME_EVENTS.MUTATION_ACQUIRED, {
      plantId: plant.id,
      ownerId: plant.ownerId,
      mutationId: definition.id,
      name: definition.name,
      kind: definition.kind,
      visualSignature: definition.visualSignature,
      tick: currentTick,
      granted: true,
    });
    return { ok: true, mutationId: definition.id };
  }

  /** Dev/testing: remove every mutation without a cooldown. Returns the count. */
  clearMutations(plantId: string, currentTick: number): number {
    const plant = this.plants.get(plantId);
    if (!plant) return 0;
    const count = plant.mutations?.length ?? 0;
    plant.mutations = [];
    plant.mutationShedCooldownUntil = currentTick;
    this.applyMutationSignature(plant);
    // No instant shrink: the form the plant can carry is smaller now, so the
    // excess tissue wilts away over the next minutes.
    this.syncMutationMass(plant, { grant: false });
    return count;
  }

  /** Player-initiated shed. Refused while the previous shed still cools down. */
  shedMutation(plantId: string, mutationId: string, currentTick: number): ShedResult {
    const plant = this.plants.get(plantId);
    if (!plant) return { ok: false, reason: 'plant_not_found' };
    const config = this.mutationConfig;
    if (!config) return { ok: false, reason: 'mutations_disabled' };
    const result = shedMutationRule(plant, config, mutationId, currentTick, this.activeTickRateHz);
    if (result.ok) {
      this.applyMutationSignature(plant);
      eventBus.publishSync(GAME_EVENTS.MUTATION_SHED, {
        plantId: plant.id,
        mutationId: result.mutationId,
        penaltyBiomass: result.penaltyBiomass ?? 0,
        tick: currentTick,
      });
    }
    return result;
  }

  /**
   * Deal the cards for raising one held mutation.
   *
   * The deal is the server's, kept here so a choice can only be made from cards
   * the player was actually shown. Nothing is charged until the pick.
   */
  offerMutationLevel(
    plantId: string,
    mutationId: string,
  ): {
    ok: boolean;
    reason?: string;
    level?: number;
    cost?: { energy: number; biomass: number };
    cards?: Array<{ id: string; label: string; step: number }>;
  } {
    const plant = this.plants.get(plantId);
    const config = this.mutationConfig;
    if (!plant) return { ok: false, reason: 'plant_not_found' };
    if (!config) return { ok: false, reason: 'mutations_disabled' };
    const check = checkLevelUp(plant, config, mutationId);
    if (!check.ok) {
      this.mutationLevelOffers.delete(plantId);
      return { ok: false, reason: check.reason };
    }
    const cards = buildLevelOffers(config, mutationId, this.mutationRandom);
    if (!cards || cards.length === 0) {
      this.mutationLevelOffers.delete(plantId);
      return { ok: false, reason: 'no_cards' };
    }
    this.mutationLevelOffers.set(plantId, { mutationId, level: check.level, offers: cards });
    return { ok: true, level: check.level, cost: check.cost, cards };
  }

  /**
   * Take one of the dealt cards and raise the mutation a level.
   *
   * A choice with no deal behind it (after a reconnect, say) deals one now and
   * accepts the card only if it is in that fresh deal, so a client can never
   * name an upgrade the server did not offer.
   */
  chooseMutationLevel(
    plantId: string,
    mutationId: string,
    cardId: string,
    currentTick: number,
  ): {
    ok: boolean;
    reason?: string;
    mutationId?: string;
    cardId?: string;
    level?: number;
    cost?: { energy: number; biomass: number };
  } {
    const plant = this.plants.get(plantId);
    const config = this.mutationConfig;
    if (!plant) return { ok: false, reason: 'plant_not_found' };
    if (!config) return { ok: false, reason: 'mutations_disabled' };

    const pending = this.mutationLevelOffers.get(plantId);
    const check = checkLevelUp(plant, config, mutationId);
    if (!check.ok) return { ok: false, reason: check.reason };
    let offers = pending?.mutationId === mutationId ? pending.offers : null;
    if (!offers) {
      const dealt = this.offerMutationLevel(plantId, mutationId);
      if (!dealt.ok) return { ok: false, reason: dealt.reason };
      offers = dealt.cards ?? [];
    }

    const result = applyLevelUpRule(plant, config, mutationId, cardId, offers);
    this.mutationLevelOffers.delete(plantId);
    if (!result.ok) return { ok: false, reason: result.reason };

    // The cost is paid in flesh as well as energy: biomass leaves the body, not
    // just the counter, and never below the upkeep floor.
    const biomassCost = result.cost?.biomass ?? 0;
    if (biomassCost > 0) {
      const affordable = Math.max(0, plant.totalBiomass - config.upkeepBiomassFloor);
      const spent = this.shedTissueMass(plant, Math.min(affordable, biomassCost), 'proportional');
      if (spent > 0) plant.totalBiomass = Math.max(0, plant.totalBiomass - spent);
    }
    this.applyMutationSignature(plant);
    // A bigger form is real tissue: the new allowance fills at once, exactly as
    // a fresh size mutation does.
    this.syncMutationMass(plant, { grant: true });
    const definition = config.definitions.find((entry) => entry.id === mutationId);
    eventBus.publishSync(GAME_EVENTS.MUTATION_LEVELED, {
      plantId: plant.id,
      ownerId: plant.ownerId,
      mutationId,
      name: definition?.name ?? mutationId,
      cardId,
      level: result.level ?? 1,
      tick: currentTick,
    });
    return { ok: true, mutationId, cardId, level: result.level, cost: result.cost };
  }

  /**
   * Dev/testing: fill every part to the mass its form holds and resync the
   * total.
   *
   * The old dev action wrote a huge `totalBiomass` onto the counter and left the
   * nodes untouched. Upkeep is charged per unit of that counter, so the next tick
   * zeroed the plant's energy and drained every part: "fill biomass" killed the
   * plant it was meant to feed. Tissue is the nodes, so fill the nodes.
   */
  fillPlantTissue(plantId: string): number {
    const plant = this.plants.get(plantId);
    if (!plant) return 0;
    const scales = this.mutationSizeScales(plant);
    let total = 0;
    for (const node of plant.nodes.values()) {
      const target = this.nodeTargetMass(node, scales);
      if (target > node.biomass) node.biomass = target;
      this.refreshRadius(node);
      total += node.biomass;
    }
    plant.totalBiomass = total;
    return total;
  }

  /** Level and next-level cost for one held mutation, or null. */
  getMutationLevelCost(
    plantId: string,
    mutationId: string,
  ): { level: number; maxLevel: number; energy: number; biomass: number } | null {
    const plant = this.plants.get(plantId);
    const config = this.mutationConfig;
    if (!plant || !config) return null;
    const check = checkLevelUp(plant, config, mutationId);
    return { level: check.level, maxLevel: check.maxLevel, ...check.cost };
  }

  /**
   * T04 acquisition: chance per completed growth event, biased by pressure and
   * gated by the environment the growth happened in.
   */
  private maybeAcquireMutation(plant: Plant, currentTick: number): void {
    const config = this.mutationConfig;
    if (!config) return;
    const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    const environment: MutationEnvironment = this.mutationEnvironmentProvider?.(
      root?.x ?? 0,
      root?.z ?? 0,
    ) ?? { light: 50, moisture: 50, minerals: 50, weather: 'clear', timeOfDay: 'day' };
    const acquired = rollMutation(plant, config, {
      tick: currentTick,
      nodeType: 'growth',
      biomass: 0,
      environment,
      random: this.mutationRandom,
    });
    if (!acquired) return;
    this.applyMutationSignature(plant);
    // A size mutation that arrives by roll must express itself exactly like a
    // granted one, or the body never grows into the form it just acquired.
    this.syncMutationMass(plant, { grant: true });
    eventBus.publishSync(GAME_EVENTS.MUTATION_ACQUIRED, {
      plantId: plant.id,
      ownerId: plant.ownerId,
      mutationId: acquired.id,
      name: acquired.name,
      kind: acquired.kind,
      visualSignature: acquired.visualSignature,
      tick: currentTick,
    });
  }

  /**
   * Mutations are organism-level, but the renderers read a per-node signature.
   * Stamping every node keeps GROWTH_EVENT, PLANT_SYNC and WELCOME consistent
   * without teaching each payload builder about mutations.
   */
  private applyMutationSignature(plant: Plant): void {
    const signature = this.mutationConfig ? dominantSignature(plant, this.mutationConfig) : 0;
    plant.mutationSignature = signature;
    for (const node of plant.nodes.values()) {
      node.mutationFlags = signature;
    }
  }

  /**
   * Mutation maintenance is a separate bill from respiration. It never removes
   * a mutation and it never kills the plant.
   *
   * The bill is paid out of energy first, then biomass, and biomass stops at
   * `upkeepBiomassFloor`. A plant that cannot pay stalls at the floor until it
   * earns again: mutations are a commitment the owner holds, and the only way
   * one leaves a plant is the player shedding it (`shedMutation`). Automatic
   * shedding used to strip a mutation the player never chose to lose, and the
   * older rule before that ground young plants to zero, so both are gone.
   */
  private chargeMutationMaintenance(plant: Plant, dt: number): void {
    const config = this.mutationConfig;
    if (!config || (plant.mutations?.length ?? 0) === 0) return;
    const cost = mutationMaintenance(plant, config);
    const energyCost = cost.energyPerSecond * dt;
    const biomassCost = cost.biomassPerSecond * dt;
    const paid = Math.min(plant.totalEnergy, energyCost);
    plant.totalEnergy = Math.max(0, plant.totalEnergy - paid);
    const unpaid = energyCost - paid;
    const biomassLoss = biomassCost + unpaid;
    if (biomassLoss <= 0) return;

    // Take only what the plant holds above the floor.
    const affordance = Math.max(0, plant.totalBiomass - config.upkeepBiomassFloor);
    plant.totalBiomass = Math.max(0, plant.totalBiomass - Math.min(affordance, biomassLoss));
  }

  createPlant(ownerId: string, worldId: string, startX: number, startZ: number): Plant {
    // INV-ID-09: an empty owner is not a legal plant. `ownerId` is how reclaim
    // finds the plant again, so a row written with '' can never be claimed by
    // anyone, and every caller already has an identity to supply: an account, a
    // connection id, or a gallery id. Refusing here keeps that row from existing.
    if (!ownerId) {
      throw new Error('createPlant needs a non-empty ownerId (INV-ID-09)');
    }
    if (!worldId) {
      throw new Error('createPlant needs a non-empty worldId (INV-ID-09)');
    }
    const plantId = newId('plant');
    const seedNodeId = nodeName(plantId, null, 'seed', () => false);

    const seedDef = this.config.seedNode;
    const seedNode: PlantNode = {
      id: seedNodeId,
      plantId,
      type: 'seed',
      layer: 'root',
      x: startX,
      y: 0,
      z: startZ,
      biomass: seedDef.biomass_cost,
      age: 0,
      parentId: null,
      children: [],
      statModifiers: { ...seedDef.stat_modifiers },
      resourceDrawWater: seedDef.resource_draw_water,
      resourceDrawNutrients: seedDef.resource_draw_nutrients,
      resourceDrawMinerals: seedDef.resource_draw_minerals ?? 0,
      upkeepBiomassPerSecond: seedDef.upkeep_biomass_per_second,
      growthDirectionBias: seedDef.growth_direction_bias,
      lastGrowthTick: 0,
      growthProgress: 1.0,
      isSeed: true,
    };

    const initialBiomass = seedDef.biomass_cost;

    const plant: Plant = {
      id: plantId,
      ownerId,
      worldId,
      nodes: new Map([[seedNodeId, seedNode]]),
      rootNodeId: seedNodeId,
      totalBiomass: initialBiomass,
      totalEnergy: 0,
      totalUpkeep: seedDef.upkeep_biomass_per_second,
      storedWater: 0,
      storedMinerals: 0,
      lastGrowthTick: 0,
      growthCooldownUntil: 0,
      growthSeq: 0,
    };

    this.plants.set(plantId, plant);
    if (!this.plantByOwner.has(ownerId)) {
      this.plantByOwner.set(ownerId, new Set());
    }
    this.plantByOwner.get(ownerId)?.add(plantId);
    this.nodeSpatialIndex.add(seedNode);

    // Compute initial Murray's law radii for the seed
    computeNodeRadii(plant);

    // A seed germinates with its water and mineral reserves full (biomass and
    // energy are not stocked: those are what growing has to produce). Capacity
    // comes from the seed's own root biomass, never from a literal.
    const initialCapacity = computePlantCapacity(plant, this.config);
    plant.storedWater = initialCapacity.water;
    plant.storedMinerals = initialCapacity.minerals;

    // Starting energy is a fraction of what this plant itself can hold.
    plant.totalEnergy =
      computePlantCapacity(plant, this.config).energy * this.config.initialEnergyFraction;

    return plant;
  }

  getPlant(plantId: string): Plant | undefined {
    return this.plants.get(plantId);
  }

  /** Active simulation rate, for converting seconds to ticks at the edge. */
  getTickRateHz(): number {
    return this.activeTickRateHz;
  }

  /**
   * D01: retune the tier rates at runtime.
   *
   * The rates were read only into readonly fields at construction, so the dev
   * panel's tick-rate controls were silently no-ops. Rebuilding the tier config
   * and clearing the accumulators makes a retune take effect on the next step
   * instead of half a second later under the old rate.
   */
  setTierRates(rates: {
    activeTickRateHz?: number;
    nearTickRateHz?: number;
    dormantStepIntervalSec?: number;
  }): void {
    const positive = (value: number | undefined, fallback: number): number =>
      value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

    this.activeTickRateHz = positive(rates.activeTickRateHz, this.activeTickRateHz);
    this.nearTickRateHz = positive(rates.nearTickRateHz, this.nearTickRateHz);
    const dormantIntervalSec = positive(rates.dormantStepIntervalSec, 1 / this.dormantTickRateHz);
    this.dormantTickRateHz = 1 / dormantIntervalSec;

    this.tierMachine.tierConfigs = createPlantTierConfigs(
      this.activeTickRateHz,
      this.nearTickRateHz,
      this.dormantTickRateHz,
    );
    this.nearAccumulatorMs = 0;
    this.dormantAccumulatorMs = 0;
  }

  getPlantsByOwner(ownerId: string): Plant[] {
    const ids = this.plantByOwner.get(ownerId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.plants.get(id))
      .filter((p): p is Plant => p !== undefined);
  }

  /**
   * Move a plant to another owner (guest -> account adoption).
   *
   * The owner index, not the field, is what `getPlantsByOwner` and the
   * one-plant-per-owner rule read, so the two must change together. Moving the
   * field alone leaves the plant invisible to its new owner and still listed
   * under the old one.
   */
  reassignOwner(plantId: string, ownerId: string): boolean {
    const plant = this.plants.get(plantId);
    if (!plant || plant.ownerId === ownerId) return false;
    this.plantByOwner.get(plant.ownerId)?.delete(plantId);
    if (!this.plantByOwner.has(ownerId)) this.plantByOwner.set(ownerId, new Set());
    this.plantByOwner.get(ownerId)?.add(plantId);
    plant.ownerId = ownerId;
    return true;
  }

  /** Growth produced outside the intent queue (dev auto-growth), for broadcasting. */
  drainGrowthResults(): GrowthResult[] {
    const results = this.pendingGrowthResults;
    this.pendingGrowthResults = [];
    return results;
  }

  /** Tier changes since the last drain, for the per-plant event log. */
  drainTierTransitions(): Array<{
    plantId: string;
    oldTier: 'active' | 'near' | 'dormant';
    newTier: 'active' | 'near' | 'dormant';
  }> {
    const transitions = this.pendingTierTransitions;
    this.pendingTierTransitions = [];
    return transitions;
  }

  getAllPlants(): Plant[] {
    return Array.from(this.plants.values());
  }

  getPlantsByTier(tier: 'active' | 'near' | 'dormant'): Plant[] {
    return plantTierStateMachineGetPlantsByTier(this.tierMachine, tier, this.plants) as Plant[];
  }

  getTierStats(): { active: number; near: number; dormant: number } {
    return plantTierStateMachineGetTierStats(this.tierMachine);
  }

  /**
   * Root uptake: living root tissue captures water and minerals from the tile it
   * sits in and adds them to the plant's own stores. Trust is not assumed — the
   * sink reports what the tile actually held, so a dry tile yields nothing and a
   * busy tile is contested. The seed counts as absorbing tissue: imbibition is
   * how a seed takes up the water it needs before it has any roots, and growth
   * (including germination) is gated on stored water and minerals.
   */
  absorbResourcesFromTiles(
    dt: number,
    resourceProvider: (x: number, z: number) => TileResources,
  ): void {
    for (const plant of this.plants.values()) {
      if (!plant.rootNodeId) continue;

      let gainedWater = 0;
      let gainedMinerals = 0;

      for (const node of plant.nodes.values()) {
        if (node.layer !== 'root') continue;

        const waterDemand = Math.min(
          this.resourceConfig.maxAbsorptionPerTick,
          this.resourceConfig.absorptionPerS * node.resourceDrawWater * dt,
        );
        const mineralDemand = Math.min(
          this.resourceConfig.maxAbsorptionPerTick,
          this.resourceConfig.absorptionPerS * node.resourceDrawMinerals * dt,
        );
        if (waterDemand <= 0 && mineralDemand <= 0) continue;

        const tile = resourceProvider(node.x, node.z);
        // Only roots below the surface layer reach the water table. Surface
        // roots keep using the moisture in the root zone, while a deep root can
        // keep the plant alive from a storm-filled cavity.
        const allowGroundwater = node.y < -0.05;
        const availableWater = Math.min(
          waterDemand,
          Math.max(0, tile?.moisture ?? 0) +
            (allowGroundwater ? Math.max(0, tile?.groundwater ?? 0) : 0),
        );
        const availableMinerals = Math.min(mineralDemand, Math.max(0, tile?.minerals ?? 0));
        if (availableWater <= 0 && availableMinerals <= 0) continue;

        const taken = this.resourceSink
          ? this.resourceSink.takeResources(
              node.x,
              node.z,
              availableWater,
              availableMinerals,
              allowGroundwater,
            )
          : { water: availableWater, minerals: availableMinerals };
        gainedWater += taken.water;
        gainedMinerals += taken.minerals;
      }

      if (gainedWater > 0) plant.storedWater += gainedWater;
      if (gainedMinerals > 0) plant.storedMinerals += gainedMinerals;
      if (gainedWater > 0 || gainedMinerals > 0) {
        this.clampStorage(plant);
      }
    }
  }

  step(
    dt: number,
    onlinePlantIds: Set<string>,
    currentTick: number,
  ): { activeMs: number; nearMs: number; dormantMs: number; totalMs: number } {
    const startTime = performance.now();

    const transitions = plantTierStateMachineUpdate(
      this.tierMachine,
      this.plants as Map<
        string,
        {
          rootNodeId?: string;
          nodes: Map<string, { x: number; z: number }>;
          tier?: 'active' | 'near' | 'dormant';
        }
      >,
      onlinePlantIds,
      currentTick,
    );

    for (const t of transitions) {
      this.pendingTierTransitions.push(t);
      eventBus.publishSync(GAME_EVENTS.PLANT_TIER_CHANGE, {
        plantId: t.plantId,
        oldTier: t.oldTier,
        newTier: t.newTier,
        tick: currentTick,
      });
    }

    const activeStart = performance.now();
    this.processTier('active', dt, currentTick);
    const activeMs = performance.now() - activeStart;

    // Slower tiers are scheduled, not rescaled. Multiplying dt by the rate ratio
    // every tick (the old behaviour) ran near plants at 4x upkeep and 4x growth,
    // and would have run dormant plants 600x. Banking elapsed time and stepping
    // the tier once per interval keeps every rate at exactly what config says.
    const nearIntervalMs = 1000 / this.nearTickRateHz;
    const nearStart = performance.now();
    this.nearAccumulatorMs += dt * 1000;
    if (this.nearAccumulatorMs >= nearIntervalMs) {
      this.processTier('near', this.nearAccumulatorMs / 1000, currentTick);
      this.nearAccumulatorMs = 0;
    }
    const nearMs = performance.now() - nearStart;

    const dormantIntervalMs = 1000 / this.dormantTickRateHz;
    const dormantStart = performance.now();
    this.dormantAccumulatorMs += dt * 1000;
    if (this.dormantAccumulatorMs >= dormantIntervalMs) {
      this.processTier('dormant', this.dormantAccumulatorMs / 1000, currentTick);
      this.dormantAccumulatorMs = 0;
    }
    const dormantMs = performance.now() - dormantStart;

    const totalMs = performance.now() - startTime;

    this.checkTickBudget(activeMs, totalMs, currentTick);

    return { activeMs, nearMs, dormantMs, totalMs };
  }

  private processTier(tier: 'active' | 'near' | 'dormant', dt: number, currentTick: number): void {
    const plants = plantTierStateMachineGetPlantsByTier(
      this.tierMachine,
      tier,
      this.plants,
    ) as Plant[];

    for (const plant of plants) {
      // A plant can be killed by root competition while this loop is running;
      // skip it rather than mutating a removed plant.
      if (!this.plants.has(plant.id)) continue;
      if (tier === 'dormant') {
        this.processDormantPlant(plant, dt, currentTick);
      } else {
        this.processPlantUpkeep(plant, dt);
        // Sunlight follows the plant, not the player: a near plant integrates at
        // its own cadence and must earn the energy it spends. Active plants are
        // excluded on purpose - the online loop credits them with the resource
        // view it already built, and crediting here as well would double-count
        // every plant whose owner is logged in.
        if (tier === 'near') this.photosynthesisHook?.(plant, dt);
        // Growth only ever advances nodes a player already committed to:
        // `processGrowthProgress` finishes in-flight parts (including while the
        // owner is offline) and nothing here starts new growth on its own. A
        // plant left overnight finishes exactly the node it was told to grow and
        // gains nothing else.
        this.processGrowthProgress(plant, dt);
        // Mark the time this plant has been simulated up to, so the dormant
        // catch-up below charges only the time it actually skipped instead of
        // the whole session (or, when the mark is missing, nothing at all).
        plant.lastTick = currentTick;
      }
    }
  }

  /**
   * Structural biomass is the sum of the parts, not a separate counter that can
   * silently lose them. A saved or resumed plant used to come back with
   * totalBiomass 0 while its seed and leaves were still alive; upkeep then cost
   * nothing, so it could neither grow nor die and the HUD was correct about a
   * number that meant nothing. Recover the accumulator from the surviving parts
   * when it has been zeroed, and keep upkeep in step with the graph as well.
   */
  private reconcileStructuralMass(plant: Plant): void {
    let nodeBiomass = 0;
    let nodeUpkeep = 0;
    for (const node of plant.nodes.values()) {
      nodeBiomass += Math.max(0, node.biomass ?? 0);
      nodeUpkeep += node.upkeepBiomassPerSecond;
    }
    plant.totalUpkeep = nodeUpkeep;
    if ((!Number.isFinite(plant.totalBiomass) || plant.totalBiomass <= 0) && nodeBiomass > 0) {
      plant.totalBiomass = nodeBiomass;
    }
  }

  private processDormantPlant(plant: Plant, _dt: number, currentTick: number): void {
    this.reconcileStructuralMass(plant);
    // A plant that has never been simulated has no backlog to settle; record
    // the mark and let the next dormant step measure from here.
    if (plant.lastTick === undefined || plant.lastTick === null) {
      plant.lastTick = currentTick;
      return;
    }
    const ticksSinceLastUpdate = currentTick - plant.lastTick;
    if (ticksSinceLastUpdate <= 0) {
      // The mark can sit ahead of the counter after a restart that reloaded a
      // saved tick. Returning without re-anchoring left the plant exempt from
      // upkeep (and from forgetting the stale mark) until ticks caught up, which
      // could take days.
      plant.lastTick = currentTick;
      return;
    }

    const elapsedSeconds = ticksSinceLastUpdate / this.activeTickRateHz;

    let nodeUpkeep = 0;
    for (const node of plant.nodes.values()) {
      nodeUpkeep += node.upkeepBiomassPerSecond;
    }
    plant.totalUpkeep = nodeUpkeep;

    // Income before expense. The span being settled is time the plant spent in
    // the sun, so the carbon it fixed over that span is available to pay the
    // upkeep for the same span. Charging upkeep first used a plant's energy at
    // the start of the span, which killed a dormant plant at 0 energy even when
    // the sunlight over that same span would have covered it.
    this.photosynthesisHook?.(plant, elapsedSeconds);

    const rootNode = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    // A plant with no canopy cannot photosynthesise, so once its seed reserve is
    // spent respiration would shed structure every tick with no way to earn it
    // back: growing a root before any cotyledon became a guaranteed death
    // spiral ("I grow a node, take damage and it dies straight away"). A
    // leafless plant still pays its water and mineral bills - it simply is not
    // dismantled for energy it can never repay.
    const hasCanopy = Array.from(plant.nodes.values()).some(
      (node) => node.layer === 'canopy' && !node.isSeed,
    );
    const leafless = !hasCanopy;
    const isDormantSeed =
      rootNode?.type === 'seed' && rootNode.isSeed === true && plant.nodes.size <= 1;
    if (rootNode && !isDormantSeed) {
      const effects = this.getMutationEffects(plant);
      const energyUpkeepCost =
        plant.totalBiomass *
        this.config.energyUpkeepPerBiomass *
        elapsedSeconds *
        effects.energyUpkeepMultiplier;
      const canPayUpkeep = plant.totalEnergy >= energyUpkeepCost;
      plant.totalEnergy = Math.max(0, plant.totalEnergy - energyUpkeepCost);
      if (!canPayUpkeep && !leafless) {
        this.shedTissueMass(plant, energyUpkeepCost, 'canopy');
        if (plant.totalBiomass <= 0) {
          this.killPlant(plant.id, 'starvation', 'no_energy');
          return;
        }
      }
      this.applyUnhealedStemDamage(plant, elapsedSeconds);
      // An offline plant pays the same mutation bill an online one does.
      this.chargeMutationMaintenance(plant, elapsedSeconds);
      // Shed size now wilts gradually instead of snapping the body smaller.
      this.absorbOversizeMass(plant, elapsedSeconds);
      this.applyTissueUpkeep(plant, elapsedSeconds);
      if (!this.plants.has(plant.id)) return;
    }
    if (this.mutationConfig) {
      decayPlantPressure(plant, this.mutationConfig, elapsedSeconds, this.activeTickRateHz);
    }

    // Offline plants still finish a node the player had already started: growth
    // progress is purely time-based, and skipping it here froze every in-flight
    // part until the owner came back, so a dormant plant could never complete
    // the growth it was told to do. This only advances growth already committed
    // to; processGrowthProgress never starts a new part.
    this.processGrowthProgress(plant, elapsedSeconds);

    plant.lastTick = currentTick;
  }

  private checkTickBudget(activeMs: number, totalMs: number, currentTick: number): void {
    const activeShare = totalMs > 0 ? activeMs / totalMs : 0;
    if (activeShare > this.tickBudgetActiveShare) {
      eventBus.publishSync(GAME_EVENTS.TICK_BUDGET_WARNING, {
        activeShare,
        threshold: this.tickBudgetActiveShare,
        activeMs,
        totalMs,
        tick: currentTick,
      });
    }
    if (activeMs > this.tickBudgetWarnThresholdMs) {
      eventBus.publishSync(GAME_EVENTS.TICK_BUDGET_WARNING, {
        activeMs,
        threshold: this.tickBudgetWarnThresholdMs,
        totalMs,
        tick: currentTick,
      });
    }
  }

  /**
   * Tissue lost to upkeep, thirst or hunger, batched per plant per tick.
   *
   * A drought that touches six leaves used to be completely silent: clients saw
   * a plant shrink with no hit and no number, because only the damage pipeline
   * ever broadcast PLANT_DAMAGE. Splitting this per shed call would flood the
   * wire, so the losses accumulate here and the tick drains one entry per plant.
   */
  private readonly shedDamageQueue = new Map<string, { amount: number; totalBiomass: number }>();

  /** Take this tick's batched shed losses. One entry per plant. */
  public drainShedDamage(): Array<{ plantId: string; amount: number; totalBiomass: number }> {
    if (this.shedDamageQueue.size === 0) return [];
    const drained = Array.from(this.shedDamageQueue, ([plantId, entry]) => ({
      plantId,
      amount: entry.amount,
      totalBiomass: entry.totalBiomass,
    }));
    this.shedDamageQueue.clear();
    return drained;
  }

  private processPlantUpkeep(plant: Plant, dt: number): void {
    this.reconcileStructuralMass(plant);
    this.applyUnhealedStemDamage(plant, dt);
    if (this.mutationConfig) {
      decayPlantPressure(plant, this.mutationConfig, dt, this.activeTickRateHz);
    }
    // First, shed cotyledons if threshold reached
    let trueLeafCount = 0;
    for (const node of plant.nodes.values()) {
      if (node.layer !== 'canopy' || node.type !== 'leaf') continue;
      trueLeafCount++;
    }

    if (trueLeafCount >= this.config.cotyledonShedLeafCount) {
      for (const [nodeId, node] of plant.nodes.entries()) {
        if (node.type === 'cotyledon') {
          plant.totalBiomass -= node.biomass;
          plant.nodes.delete(nodeId);
          this.nodeSpatialIndex.remove(node);
          if (node.parentId) {
            const parent = plant.nodes.get(node.parentId);
            if (parent) {
              const idx = parent.children.indexOf(nodeId);
              if (idx >= 0) parent.children.splice(idx, 1);
            }
          }
        }
      }
    }

    // Now calculate upkeep after shedding
    let nodeUpkeep = 0;
    for (const node of plant.nodes.values()) {
      nodeUpkeep += node.upkeepBiomassPerSecond;
    }
    plant.totalUpkeep = nodeUpkeep;

    // Respiration burns stored energy, not structure. A plant only loses
    // structural mass once it has no energy left to maintain it, which is what
    // makes "withered" mean something instead of a slow invisible shrink.
    // Only a lone, ungerminated seed is exempt from respiration. As soon as it
    // has any tissue, the seedling respires like every other living plant.
    const rootNode = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    // A plant with no canopy cannot photosynthesise, so once its seed reserve is
    // spent respiration would shed structure every tick with no way to earn it
    // back: growing a root before any cotyledon became a guaranteed death
    // spiral ("I grow a node, take damage and it dies straight away"). A
    // leafless plant still pays its water and mineral bills - it simply is not
    // dismantled for energy it can never repay.
    const hasCanopy = Array.from(plant.nodes.values()).some(
      (node) => node.layer === 'canopy' && !node.isSeed,
    );
    const leafless = !hasCanopy;
    const isDormantSeed =
      rootNode?.type === 'seed' && rootNode.isSeed === true && plant.nodes.size <= 1;
    if (rootNode && !isDormantSeed) {
      const effects = this.getMutationEffects(plant);
      const energyUpkeepCost =
        plant.totalBiomass *
        this.config.energyUpkeepPerBiomass *
        dt *
        effects.energyUpkeepMultiplier;
      const canPayUpkeep = plant.totalEnergy >= energyUpkeepCost;
      plant.totalEnergy = Math.max(0, plant.totalEnergy - energyUpkeepCost);

      if (!canPayUpkeep && !leafless) {
        this.shedTissueMass(plant, energyUpkeepCost, 'canopy');
        if (plant.totalBiomass <= 0) {
          this.killPlant(plant.id, 'starvation', 'no_energy');
          return;
        }
      }
      // Mutation upkeep is its own bill: DESIGN T04 makes a mutation set a
      // commitment, not a free upgrade. It stalls the plant, never sheds or kills.
      this.chargeMutationMaintenance(plant, dt);
      // Oversize tissue (a shed size mutation, or a bigger form that shrank)
      // wilts away gradually rather than vanishing on the tick it was shed.
      this.absorbOversizeMass(plant, dt);
      this.applyTissueUpkeep(plant, dt);
    }
  }

  /**
   * Respiration beyond energy: living tissue also spends water and minerals.
   *
   * Upkeep used to cost energy only, so a plant could sit at full water and
   * minerals forever while its roots pulled in more every tick. Transpiration
   * and the mineral cost of maintaining cell walls are real drains, and making
   * them real is what gives stored water a reason to matter after germination.
   * A shortfall is not silently forgiven: it is paid for out of structural mass,
   * which is what wilting is. Rates are per unit biomass per second and come
   * from growth.json, so the numbers are tunable rather than invented here.
   */
  private applyTissueUpkeep(plant: Plant, dt: number): void {
    if (plant.totalBiomass <= 0 || dt <= 0) return;
    const waterRate = this.config.upkeepWaterPerBiomass ?? 0;
    const mineralRate = this.config.upkeepMineralPerBiomass ?? 0;
    let starved = false;
    // Which store ran dry, so the client can say more than "starvation".
    let starvedBy: string | null = null;

    if (waterRate > 0) {
      const need = plant.totalBiomass * waterRate * dt;
      const paid = Math.min(plant.storedWater, need);
      plant.storedWater = Math.max(0, plant.storedWater - paid);
      const deficit = need - paid;
      if (deficit > 0) {
        starved = true;
        starvedBy = 'thirst';
        this.shedTissueMass(plant, deficit * (this.config.waterDeficitBiomassLoss ?? 0), 'canopy');
      }
    }

    if (mineralRate > 0) {
      const need = plant.totalBiomass * mineralRate * dt;
      const paid = Math.min(plant.storedMinerals, need);
      plant.storedMinerals = Math.max(0, plant.storedMinerals - paid);
      const deficit = need - paid;
      if (deficit > 0) {
        starved = true;
        starvedBy = starvedBy ?? 'minerals';
        this.shedTissueMass(plant, deficit * (this.config.mineralDeficitBiomassLoss ?? 0));
      }
    }

    if (plant.totalBiomass <= 0) {
      this.killPlant(plant.id, 'starvation', starvedBy ?? 'malnutrition');
      return;
    }
    // A fed plant slowly rebuilds tissue it lost to an earlier shortfall, which
    // is what lets health recover instead of ratcheting down for the rest of
    // the plant's life.
    if (!starved) this.repairTissue(plant, dt);
  }

  /**
   * Take shed mass out of the parts themselves, not out of a running total.
   *
   * `canopy` is used whenever water, minerals or energy are short: leaves are
   * abandoned first, then canopy stems, and the roots are drained only after
   * the canopy is gone. That is the botanical order that keeps a root alive to
   * regrow when the drought breaks, and it is what makes a drought visible:
   * foliage thins while the root crown stays.
   *
   * Every part's radius is recomputed after it loses mass, so the renderer
   * actually draws the decline instead of keeping the old thickness.
   */
  private shedTissueMass(
    plant: Plant,
    mass: number,
    preference: 'proportional' | 'canopy' = 'proportional',
  ): number {
    const wanted = Math.min(Math.max(0, mass), plant.totalBiomass);
    if (wanted <= 0) return 0;

    let shed = 0;
    const drain = (node: PlantNode, amount: number): void => {
      const take = Math.min(Math.max(0, node.biomass), amount);
      if (take <= 0) return;
      node.biomass = Math.max(0, node.biomass - take);
      this.refreshRadius(node);
      shed += take;
      if (node.biomass <= 1e-6 && !node.isSeed) {
        node.biomass = 0;
        this.detachNode(plant, node);
      }
    };

    if (preference === 'canopy') {
      // Tiers, not one pool: all leaves thin before any stem is touched.
      const tiers: PlantNode[][] = [[], [], []];
      for (const node of plant.nodes.values()) {
        if (node.isSeed || node.biomass <= 0) continue;
        if (node.layer !== 'canopy') continue;
        const type = node.type;
        const tier =
          type === 'leaf' || type === 'cotyledon' || type === 'flower' || type === 'spore_sac'
            ? 0
            : type === 'stem' || type === 'branch' || type === 'trunk' || type === 'vine'
              ? 1
              : 2;
        tiers[tier].push(node);
      }
      for (const tier of tiers) {
        if (shed >= wanted || tier.length === 0) continue;
        const held = tier.reduce((sum, node) => sum + Math.max(0, node.biomass), 0);
        if (held <= 0) continue;
        const share = Math.min(wanted - shed, held) / held;
        for (const node of tier) drain(node, node.biomass * share);
      }
    }

    if (shed < wanted) {
      // Fall back to the whole body, seed last: the root crown is the plant's
      // last reserve and is never the first thing a deficit consumes.
      const remaining = wanted - shed;
      const candidates = Array.from(plant.nodes.values()).filter((node) => !node.isSeed);
      const held = candidates.reduce((sum, node) => sum + Math.max(0, node.biomass), 0);
      if (held > 0) {
        const share = Math.min(remaining, held) / held;
        for (const node of candidates) drain(node, node.biomass * share);
      } else {
        const seed = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
        if (seed) drain(seed, remaining);
      }
    }

    plant.totalBiomass = Math.max(0, plant.totalBiomass - shed);
    if (shed > 0) {
      const queued = this.shedDamageQueue.get(plant.id);
      this.shedDamageQueue.set(plant.id, {
        amount: (queued?.amount ?? 0) + shed,
        totalBiomass: plant.totalBiomass,
      });
    }
    return shed;
  }

  /**
   * Damage that is not repaired becomes visible decay.
   *
   * A stem below its own tissue quota is carrying unhealed damage. For the
   * first `stem_damage_wither_delay_s` it is only marked; after that the part
   * loses a small fraction of its quota each second until repair catches up or
   * the stem is gone. Leaves do not need this path: the canopy-first drought
   * shed already abandons them first when water or energy is short.
   */
  private applyUnhealedStemDamage(plant: Plant, dt: number): void {
    const delay = this.config.stemDamageWitherDelayS ?? 0;
    const rate = this.config.stemDamageWitherPerS ?? 0;
    if (delay < 0 || rate <= 0 || dt <= 0) return;
    for (const node of Array.from(plant.nodes.values())) {
      if (node.type !== 'stem' && node.type !== 'branch' && node.type !== 'trunk') continue;
      if (node.isSeed || (node.growthProgress ?? 1) < 1) {
        node.damageStressSeconds = 0;
        continue;
      }
      const quota = tissueMassQuota(node, this.config);
      if (quota <= 0) continue;
      if (node.biomass >= quota * 0.98) {
        node.damageStressSeconds = 0;
        continue;
      }
      node.damageStressSeconds = (node.damageStressSeconds ?? 0) + dt;
      if (node.damageStressSeconds < delay) continue;
      const loss = Math.min(node.biomass, quota * rate * dt);
      if (loss <= 0) continue;
      node.biomass = Math.max(0, node.biomass - loss);
      this.refreshRadius(node);
      plant.totalBiomass = Math.max(0, plant.totalBiomass - loss);
      if (node.biomass <= 1e-6) {
        node.biomass = 0;
        this.detachNode(plant, node);
      }
    }
  }

  /** Regrow missing tissue while the plant is fed and has energy to spend. */
  private repairTissue(plant: Plant, dt: number): void {
    const rate = this.config.tissueRepairPerSecond ?? 0;
    const energyPerBiomass = this.config.tissueRepairEnergyPerBiomass ?? 0;
    if (rate <= 0 || energyPerBiomass <= 0 || plant.totalEnergy <= 0) return;
    let budget = Math.min(rate * dt, plant.totalEnergy / energyPerBiomass);
    if (budget <= 0) return;
    // Repair refills a part to the mass its current form holds, not to the
    // unmutated quota: otherwise one hit would permanently erase the tissue a
    // size mutation granted, because repair would stop at the base quota.
    const scales = this.mutationSizeScales(plant);
    let repaired = 0;
    for (const node of plant.nodes.values()) {
      if (budget <= 0) break;
      if (node.isSeed) continue;
      const missing = this.nodeTargetMass(node, scales) - (node.biomass ?? 0);
      if (missing <= 1e-6) continue;
      const add = Math.min(missing, budget);
      node.biomass += add;
      this.refreshRadius(node);
      budget -= add;
      repaired += add;
    }
    if (repaired <= 0) return;
    plant.totalBiomass += repaired;
    plant.totalEnergy = Math.max(0, plant.totalEnergy - repaired * energyPerBiomass);
  }

  /**
   * Re-place any node that does not sit exactly one segment from its parent.
   *
   * Placement is constructive: `tryGrow` and `handleGermination` build every
   * node with `placeSegment`, and nothing in the simulation moves a stored
   * position afterwards - growth is a render-time scale from 0 to 1, not a walk
   * across the world. The one boundary that can still hand this process a node
   * from outside is a saved payload, so the repair runs on load instead of on
   * every tick: a legacy save (whose shoots were placed from the seed base
   * rather than its coat) or a hand-edited node is snapped onto its step once,
   * and the live simulation never silently moves a node the client has already
   * been told about.
   *
   * Returns the number of nodes that needed repair.
   */
  private repairSegmentLengths(plant: Plant): number {
    let repaired = 0;
    for (const node of plant.nodes.values()) {
      if (!node.parentId) continue;
      const parent = plant.nodes.get(node.parentId);
      if (!parent) continue;

      const nodeDef = getNodeTypeDefinition(this.config, node.type);
      const limit = nodeDef.segment_length;
      // A seed is an anchor, not a step; without a configured length the node
      // keeps whatever the save gave it.
      if (!limit || limit <= 0 || node.type === 'seed') continue;

      // Repair with the fraction the node was grown with: a branch grown from
      // part-way along its parent must be measured from the same point.
      const placement = placeSegment(
        attachmentPart(parent),
        { x: node.x - parent.x, y: node.y - parent.y, z: node.z - parent.z },
        limit,
        node.attachFraction ?? 1,
      );
      const step = Math.hypot(
        node.x - placement.start.x,
        node.y - placement.start.y,
        node.z - placement.start.z,
      );
      // A correct node sits exactly on its step, so loading a healthy save never
      // rewrites a coordinate.
      if (Math.abs(step - limit) <= limit * 1e-6) continue;

      this.nodeSpatialIndex.remove(node);
      node.x = placement.end.x;
      node.y = placement.end.y;
      node.z = placement.end.z;
      // Keep the drawn segment in step with the repaired position: the renderer
      // draws start + (target - start) * progress.
      node.growthStartX = placement.start.x;
      node.growthStartY = placement.start.y;
      node.growthStartZ = placement.start.z;
      node.targetX = placement.end.x;
      node.targetY = placement.end.y;
      node.targetZ = placement.end.z;
      node.parentAttachX = placement.start.x;
      node.parentAttachY = placement.start.y;
      node.parentAttachZ = placement.start.z;
      this.nodeSpatialIndex.add(node);
      repaired += 1;
    }
    return repaired;
  }

  private processGrowthProgress(plant: Plant, dt: number): void {
    const scales = this.mutationSizeScales(plant);
    for (const node of plant.nodes.values()) {
      if (
        node.growthProgress >= 1.0 ||
        node.growthTimeRemaining === undefined ||
        node.growthTimeRemaining <= 0
      ) {
        continue;
      }

      const nodeDef = getNodeTypeDefinition(this.config, node.type);
      // The quoted duration, not the shrinking remainder: dividing by the
      // remainder accelerates as the node nears completion, so a 14 s stem used
      // to finish in ~8.8 s and spend ~63% of its quoted water. A node restored
      // from a save that predates growth_time_seconds falls back to its
      // remainder, which is the best estimate available.
      const growthTimeSeconds = node.growthTimeSeconds ?? node.growthTimeRemaining;
      const progressPerSecond = 1.0 / growthTimeSeconds;
      const progressThisTick = progressPerSecond * dt;

      // Accrue biomass proportionally as the node grows so totalBiomass reflects
      // live growth progress instead of flatlining until completion. Upkeep still
      // drains in processUpkeep, so net biomass = growth accrual minus upkeep.
      // The final mass is the quoted (yield-limited) gain, not the raw carbon
      // budget: mass may never exceed what the part is actually drawn as. A
      // size mutation raises that quoted mass, which is why a mutated part
      // grows materially bigger for the same build cost.
      // Quoted once, on the first tick of growth, and then frozen: a mutation
      // gained mid-growth must not re-price a part that is already half built.
      const massScale = node.layer === 'root' ? scales.root : scales.canopy;
      const targetMass = growthTargetMass(
        node,
        computeGrowthCostQuote(this.config, nodeDef, massScale).biomassGain,
      );
      const biomassThisTick = targetMass * progressThisTick;
      plant.totalBiomass += biomassThisTick;
      node.biomass = (node.biomass ?? 0) + biomassThisTick;

      // One draw helper, so the minerals a part takes include the nutrient
      // share the menu quotes instead of only the structural share.
      const drawPerSecond = growthDrawPerSecond(this.config, nodeDef.biomass_cost);
      const waterCost = Math.min(plant.storedWater, drawPerSecond.water * dt);
      const mineralCost = Math.min(plant.storedMinerals, drawPerSecond.minerals * dt);
      node.growthWaterConsumed = (node.growthWaterConsumed ?? 0) + waterCost;
      node.growthMineralsConsumed = (node.growthMineralsConsumed ?? 0) + mineralCost;
      plant.storedWater = Math.max(0, plant.storedWater - waterCost);
      plant.storedMinerals = Math.max(0, plant.storedMinerals - mineralCost);

      // Positions are final the moment a node is created: the skeleton is fixed
      // geometry (parent + direction * segment_length), exactly like the lab
      // generator. Growth is a render-time scale from 0 to 1, not a simulation
      // that walks the node across the world - animating the stored position
      // here is what let nodes overshoot, drift away from their parent and end
      // up as poles floating in the air.
      node.growthProgress = Math.min(1.0, node.growthProgress + progressThisTick);
      node.growthTimeRemaining = Math.max(0, (node.growthTimeRemaining ?? 0) - dt);

      if (node.growthProgress >= 1.0) {
        // Snap to exact final biomass to prevent accumulation drift beyond cost
        const overage = Math.max(0, node.biomass - targetMass);
        plant.totalBiomass -= overage;
        // Never restore mass a drought took: completion trims the overage but
        // does not refill the part at the plant's expense.
        node.biomass = Math.min(node.biomass, targetMass);
        node.upkeepBiomassPerSecond = nodeDef.upkeep_biomass_per_second;
        plant.totalUpkeep += nodeDef.upkeep_biomass_per_second;
        node.targetX = node.targetY = node.targetZ = undefined;
        node.growthTimeRemaining = 0;
      }

      // Radius follows the part's own biomass so a growing segment thickens in
      // step with the drawn geometry (one shared table, no client clamps).
      this.refreshRadius(node);
    }
  }

  /** Per-part health, 0..1, measured against its own tissue quota. */
  getNodeHealth(plantId: string, nodeId: string): number {
    const node = this.plants.get(plantId)?.nodes.get(nodeId);
    return node ? nodeHealth(node, this.config) : 0;
  }

  addPhotosynthesisEnergy(plantId: string, energyGain: number): void {
    const plant = this.plants.get(plantId);
    if (!plant) return;
    plant.totalEnergy += energyGain;
    this.clampStorage(plant);
  }

  tryGrow(intent: GrowthIntent, currentTick: number): GrowthResult {
    const plant = this.plants.get(intent.plantId);
    if (!plant) return { success: false, reason: 'plant_not_found' };
    if (currentTick < plant.growthCooldownUntil) {
      return { success: false, reason: 'growth_on_cooldown' };
    }
    if (plant.uproot && !this.detachedGrowthEnabled) {
      return { success: false, reason: 'uprooted_cannot_grow' };
    }

    const parentNode = plant.nodes.get(intent.nodeId);
    if (!parentNode) return { success: false, reason: 'parent_node_not_found' };

    const targetType = intent.nodeType;
    const targetLayer = getLayerForNodeType(targetType);

    // A stem/canopy part must come from the crown, never from a buried root.
    // A stolon is the exception: it is a runner that travels along under the
    // surface, so it leaves a rhizome (or the crown) and roots at its own nodes.
    if (
      targetLayer === 'canopy' &&
      targetType !== 'stolon' &&
      parentNode.layer === 'root' &&
      parentNode.id !== plant.rootNodeId
    ) {
      return { success: false, reason: 'canopy_from_crown_only' };
    }

    const isSeedCrown = parentNode.type === 'seed' && parentNode.isSeed;
    if (targetType === 'cotyledon') {
      // A cotyledon sprouts from the seed crown, and after germination the crown
      // is the plant's root node (the seed's isSeed flag is cleared). Requiring
      // `isSeed` here rejected every cotyledon after the radicle, which stalled
      // growth at two nodes forever; the later validation already accepts the
      // root crown, so this early check must agree with it.
      const isCrown = isSeedCrown || parentNode.id === plant.rootNodeId;
      if (!isCrown) return { success: false, reason: 'invalid_parent_for_cotyledon' };
      const hasRadicle = parentNode.children.some((id) => {
        const c = plant.nodes.get(id);
        return c && (c.type === 'radicle' || c.type === 'root');
      });
      if (!hasRadicle) return { success: false, reason: 'radicle_required_before_cotyledon' };
    } else if (targetType === 'radicle') {
      if (!isSeedCrown) return { success: false, reason: 'radicle_only_from_seed' };
    } else if (targetType === 'stem' && parentNode.type === 'seed') {
      // Allow stem from established seed crown (post-cotyledons).
      const hasRadicle = parentNode.children.some((id) => {
        const c = plant.nodes.get(id);
        return c && (c.type === 'radicle' || c.type === 'root');
      });
      const cotyledonCount = parentNode.children.filter(
        (id) => plant.nodes.get(id)?.type === 'cotyledon',
      ).length;
      if (!hasRadicle || cotyledonCount < maxCotyledonsForPlant(this.config))
        return { success: false, reason: 'establish_seed_before_stem' };
    } else if (!canCrossLayer(parentNode.type, targetType)) {
      return { success: false, reason: 'cannot_cross_layer' };
    } else if (!(targetType === 'stem' && parentNode.type === 'seed')) {
      const availableTypes = getAvailableGrowthTypes(parentNode.type, this.config);
      // A mutation may unlock a menu entry the base rules refuse (T04).
      const unlockedTypes = this.getMutationEffects(plant).unlockNodeTypes;
      if (!availableTypes.includes(targetType) && !unlockedTypes.includes(targetType)) {
        return { success: false, reason: 'cannot_cross_layer' };
      }
    }

    // INV-GR-03: the direction the player aimed is the direction we grow in -
    // it is never taken from the parent. What it must be is a real vector.
    // `normalizeDirection` turned a zero vector into "grow straight down" and
    // let NaN through arithmetic, so a bad intent either grew the wrong way or
    // placed a node at NaN coordinates. Refuse it and say why; everything else
    // continues through the gene clamp and the node-type sector below.
    const intentDirection = validateIntentDirection(intent.direction);
    if (!intentDirection.ok) {
      return { success: false, reason: 'invalid_direction' };
    }

    // A mutation whose name promises a shape (columnar habit, drooping fronds)
    // bends the direction first and is then clamped by the same gene sector as
    // any other intent, so the shape is real and still legal.
    const shapeEffects = this.getMutationEffects(plant);
    const clampedDir = applyMutationShapeBias(
      targetType,
      clampGrowthDirectionByGene(targetType, intent.direction),
      { vertical: shapeEffects.verticalBias, droop: shapeEffects.droopingBias },
      targetLayer === 'root' ? 'root' : 'canopy',
    );
    const dir = normalizeDirection(clampedDir);
    // Backstop for the invariant, not a second policy: every caller is validated
    // above, so reaching this with a non-finite vector is a programming error.
    if (!isUsableDirection(dir)) {
      throw new Error(`growNode received a non-finite direction for ${targetType} (INV-GR-03)`);
    }
    // Calculate energy cost - stepwise germination: radicle/cotyledon are separate actions (INV-GR-13).
    let nodeDef: NodeTypeDefinition;
    if (parentNode.type === 'seed' && parentNode.isSeed && targetType === 'radicle') {
      nodeDef = this.config.radicleNode;
    } else if (targetType === 'cotyledon') {
      nodeDef = this.config.cotyledonNode;
    } else {
      nodeDef = getNodeTypeDefinition(this.config, targetType);
    }
    // One growth action moves the new node by the type's own segment length, not
    // the layer speed (a cotyledon is a seed leaf, not a 95 cm canopy branch).
    const sizeEffects = this.getMutationEffects(plant);
    const sizeScale =
      targetLayer === 'root' ? sizeEffects.rootSizeMultiplier : sizeEffects.sizeMultiplier;
    // A size mutation scales the new part, and nothing used to bound it: with two
    // size mutations the new internode could be several times the length of the
    // trunk it left. Proportion is part of looking like a plant, so the segment is
    // capped against the part it grows out of (config: max_child_length_ratio).
    const baseLength = nodeDef.segment_length ?? getGrowthSpeed(this.config, targetLayer);
    const parentLength = getNodeTypeDefinition(this.config, parentNode.type).segment_length ?? 0;
    const speed = clampChildSegmentLength(
      baseLength * sizeScale,
      parentLength,
      this.config.maxChildLengthRatio,
    );
    // Lateral roots, branches and vines are buds on an existing organ, so they
    // leave the parent part-way along its segment; everything else continues
    // from its end. An intent may override the fraction explicitly.
    const attachFraction = resolveAttachFraction(targetType, intent.attachFraction);
    // A seed's stored position is its ground contact point, but the drawn seed
    // body sits above it. `placeSegment` starts the step on the coat so the
    // skeleton the server sends is the skeleton the renderer draws.
    const placement = placeSegment(attachmentPart(parentNode), dir, speed, attachFraction);
    const attach = placement.start;
    const { x: newX, y: newY, z: newZ } = placement.end;

    // Bounds check first
    if (!this.isInBounds(newX, newY, newZ)) {
      return { success: false, reason: 'out_of_bounds' };
    }

    // Validate the drawn direction against realistic growth rules (lenient)
    const directionValidation = validateGrowthDirection(parentNode, targetType, dir, this.config);
    if (!directionValidation.ok) {
      return { success: false, reason: directionValidation.reason ?? 'invalid_direction' };
    }

    // A floating pad is a water-surface organ: it needs standing water under the
    // point it would occupy. Before this gate a pad grew in dry air as soon as
    // the `floating_pads` mutation was held, so the mutation promised an aquatic
    // habit the simulation never checked.
    if (targetType === 'floating_leaf') {
      const tile = this.resourceProvider?.(newX, newZ);
      const groundwater = tile?.groundwater ?? 0;
      const needed = this.config.floatingLeafMinGroundwater ?? 0;
      if (groundwater < needed) {
        return { success: false, reason: 'floating_leaf_needs_water' };
      }
    }

    const costs = computeGrowthCostQuote(this.config, nodeDef);
    // Roots pay for the soil they open; canopy growth is in air. The menu quotes
    // with this same scale, so a card can never offer growth this refuses.
    const chargeScale = this.growthChargeScale(plant, parentNode, targetLayer);
    const mutationEffectsNow = this.getMutationEffects(plant);
    const energyCost = costs.energyCost * chargeScale.energyMultiplier;
    // Growth-speed mutations divide the quoted time; never below a tenth of it,
    // so a stack cannot make a node appear in the same tick.
    const growthTimeSeconds = Math.max(0.1, costs.growthTimeSeconds * chargeScale.timeMultiplier);

    if (plant.totalEnergy < energyCost) {
      return { success: false, reason: 'insufficient_energy' };
    }

    // Establishment runs on seed reserves (plus the soil moisture gate inside
    // handleGermination). Everything after that must be paid for from the
    // plant's own captured water and minerals, not merely from its energy.
    const isEstablishment = targetType === 'radicle' || targetType === 'cotyledon';
    if (!isEstablishment) {
      const storedGate = canGrow(
        plant,
        this.config,
        parentNode.layer === 'root' ? mutationEffectsNow.storedResourceSharing : 0,
      );
      if (!storedGate.ok) {
        return { success: false, reason: 'insufficient_stored_resources' };
      }
    }

    if (parentNode.type === 'seed' && parentNode.isSeed && targetType === 'radicle') {
      return this.handleGermination(plant, parentNode, intent, dir, energyCost, currentTick);
    }
    if (targetType === 'cotyledon') {
      const cotyledonCount = Array.from(plant.nodes.values()).filter(
        (n) => n.type === 'cotyledon',
      ).length;
      const maxCotyledons = maxCotyledonsForPlant(this.config);
      if (cotyledonCount >= maxCotyledons) {
        return { success: false, reason: 'max_cotyledons_reached' };
      }
      // Allow cotyledon from seed (legacy/early) or from the post-radicle root crown.
      if (
        !(parentNode.type === 'seed' && parentNode.isSeed) &&
        parentNode.id !== plant.rootNodeId
      ) {
        return { success: false, reason: 'invalid_parent_for_cotyledon' };
      }
    }

    if (plant.nodes.size + 1 > this.config.maxNodesPerPlant) {
      return { success: false, reason: 'max_nodes_reached' };
    }

    const newNodeId = nodeName(plant.id, parentNode, targetType, (id) => plant.nodes.has(id));
    const newNode: PlantNode = {
      id: newNodeId,
      plantId: plant.id,
      type: targetType,
      layer: targetLayer,
      // Final position immediately: the segment is one step of its own length
      // from the parent, and it never moves again.
      x: newX,
      y: newY,
      z: newZ,
      biomass: 0,
      age: 0,
      parentId: intent.nodeId,
      children: [],
      statModifiers: { ...nodeDef.stat_modifiers },
      resourceDrawWater: nodeDef.resource_draw_water,
      resourceDrawNutrients: nodeDef.resource_draw_nutrients,
      resourceDrawMinerals: nodeDef.resource_draw_minerals ?? 0,
      upkeepBiomassPerSecond: 0,
      growthDirectionBias: nodeDef.growth_direction_bias,
      lastGrowthTick: currentTick,
      growthProgress: 0,
      targetX: newX,
      targetY: newY,
      targetZ: newZ,
      // The segment is drawn as start + (target - start) * progress. Storing
      // the start keeps that exact; recomputing it from the current position
      // drifted once progress approached 1.
      growthStartX: attach.x,
      growthStartY: attach.y,
      growthStartZ: attach.z,
      growthTimeRemaining: growthTimeSeconds,
      growthWaterConsumed: 0,
      growthNutrientsConsumed: 0,
      growthMineralsConsumed: 0,
      isSeed: false,
      growthTimeSeconds,
      growthStartTick: currentTick,
      // Parent attachment position for client sync
      parentAttachX: attach.x,
      parentAttachY: attach.y,
      parentAttachZ: attach.z,
      attachFraction,
    };

    plant.nodes.set(newNodeId, newNode);
    // T04: a part built under a size mutation is drawn thick from the start, so
    // its radius ceiling widens with the form it is growing into.
    if (mutationEffectsNow.sizeMultiplier > 1 && targetLayer !== 'root') {
      newNode.massScale = mutationEffectsNow.sizeMultiplier;
    } else if (mutationEffectsNow.rootSizeMultiplier > 1 && targetLayer === 'root') {
      newNode.massScale = mutationEffectsNow.rootSizeMultiplier;
    }
    plant.totalEnergy -= energyCost;
    plant.lastGrowthTick = currentTick;
    plant.growthCooldownUntil =
      currentTick + Math.ceil(this.config.growthCooldown * this.activeTickRateHz);

    parentNode.children.push(newNodeId);
    this.nodeSpatialIndex.add(newNode);

    // T04: the growth that just happened is both the investment adaptive
    // pressure remembers and the event a mutation can roll on.
    if (this.mutationConfig) {
      recordInvestment(plant, this.mutationConfig, newNode.type, nodeDef.biomass_cost);
      this.maybeAcquireMutation(plant, currentTick);
    }
    // A node grown while mutations are held must carry the current signature,
    // or the newest part of the plant draws unmutated (and the payload sends 0).
    if ((plant.mutations?.length ?? 0) > 0) this.applyMutationSignature(plant);

    // Recompute Murray's law radii for the whole plant after structure change
    computeNodeRadii(plant);

    plant.growthSeq++;

    if (parentNode.type === 'seed' && parentNode.isSeed) {
      const cotyledonCount = parentNode.children.filter(
        (id) => plant.nodes.get(id)?.type === 'cotyledon',
      ).length;
      const established: PlantNode = {
        ...parentNode,
        isSeed: cotyledonCount < maxCotyledonsForPlant(this.config),
      };
      plant.nodes.set(parentNode.id, established);
      if (!plant.rootNodeId) plant.rootNodeId = parentNode.id;
      plant.growthSeq++;
      // Recompute radii after parent update
      computeNodeRadii(plant);
      return {
        success: true,
        newNode,
        updatedParentNode: established,
        reason: `Cotyledon ${cotyledonCount}/2 started.`,
      };
    }

    return {
      success: true,
      newNode,
      reason: `Growth started - will complete in ${growthTimeSeconds}s`,
    };
  }

  private handleGermination(
    plant: Plant,
    seedNode: PlantNode,
    _intent: GrowthIntent,
    dir: { x: number; y: number; z: number },
    energyCost: number,
    currentTick: number,
  ): GrowthResult {
    // Stepwise germination (ADR/T01 UX): only the radicle is created here, in the
    // dragged direction, with normal growth-time animation. Cotyledons are separate
    // directed actions from the seed/root crown. The seed becomes the root crown
    // immediately so growth options remain available (avoids post-sprout lockout).
    const resources = this.resourceProvider
      ? this.resourceProvider(seedNode.x, seedNode.z)
      : { light: 100, moisture: 100, minerals: 100 };
    const moistureOk =
      this.config.germinationGate === false ||
      (resources.moisture ?? 0) >= this.config.germinationMinMoisture;
    const lightOk =
      this.config.germinationGate === false ||
      (resources.light ?? 0) >= this.config.germinationMinLight;
    if (!moistureOk || !lightOk) {
      if (this.config.germinationFailureKillsSeed) {
        this.killPlant(plant.id, 'germination_failed');
        return { success: false, reason: 'germination_failed_conditions', plantDied: true };
      }
      return { success: false, reason: 'germination_conditions_not_met' };
    }
    if (plant.totalEnergy < energyCost) {
      return { success: false, reason: 'insufficient_energy_for_germination' };
    }
    if (plant.nodes.size + 1 > this.config.maxNodesPerPlant) {
      return { success: false, reason: 'max_nodes_reached' };
    }

    const radicleDef = this.config.radicleNode;
    const normDir = normalizeDirection(dir);
    const radicleSpeed = radicleDef.segment_length ?? getGrowthSpeed(this.config, 'root');
    // The radicle is the seed's first continuation, not a bud: it leaves the
    // coat whole, so the attach fraction is always 1 here.
    const placement = placeSegment(seedNode, normDir, radicleSpeed, 1);
    const attach = placement.start;
    const { x: targetX, y: targetY, z: targetZ } = placement.end;
    const growthTimeSeconds =
      radicleDef.growth_time_seconds ?? this.config.defaultGrowthTimeSeconds;
    const radicleId = nodeName(plant.id, seedNode, 'radicle', (id) => plant.nodes.has(id));
    const radicleNode: PlantNode = {
      id: radicleId,
      plantId: plant.id,
      type: 'radicle',
      layer: 'root',
      x: targetX,
      y: targetY,
      z: targetZ,
      biomass: 0,
      age: 0,
      parentId: seedNode.id,
      children: [],
      statModifiers: { ...radicleDef.stat_modifiers },
      resourceDrawWater: radicleDef.resource_draw_water,
      resourceDrawNutrients: radicleDef.resource_draw_nutrients,
      resourceDrawMinerals: radicleDef.resource_draw_minerals ?? 0,
      upkeepBiomassPerSecond: 0,
      growthDirectionBias: radicleDef.growth_direction_bias,
      lastGrowthTick: currentTick,
      growthProgress: 0,
      targetX,
      targetY,
      targetZ,
      growthStartX: attach.x,
      growthStartY: attach.y,
      growthStartZ: attach.z,
      growthTimeRemaining: growthTimeSeconds,
      growthWaterConsumed: 0,
      growthNutrientsConsumed: 0,
      growthMineralsConsumed: 0,
      isSeed: false,
      growthTimeSeconds,
      growthStartTick: currentTick,
      // Parent attachment position for client sync (seed coat)
      parentAttachX: attach.x,
      parentAttachY: attach.y,
      parentAttachZ: attach.z,
      attachFraction: 1,
    };

    // Stepwise germination: keep the node as a seed/root-crown (isSeed) so the
    // player can add cotyledons one at a time with direction. The seed crown is
    // the structural root; it becomes an established (non-seed) crown once
    // cotyledons are placed so normal growth options unlock.
    const seedCrown: PlantNode = {
      ...seedNode,
      type: 'seed',
      layer: 'root',
      isSeed: true,
      parentId: null,
      children: [...seedNode.children, radicleId],
      growthProgress: 1.0,
      lastGrowthTick: currentTick,
      growthTimeRemaining: 0,
    };
    plant.nodes.set(seedCrown.id, seedCrown);
    plant.nodes.set(radicleId, radicleNode);
    plant.rootNodeId = seedCrown.id;
    plant.totalEnergy -= energyCost;
    plant.lastGrowthTick = currentTick;
    plant.growthCooldownUntil =
      currentTick + Math.ceil(this.config.growthCooldown * this.activeTickRateHz);
    this.nodeSpatialIndex.add(radicleNode);

    // The automatic germination radicle is a growth event too: it feeds adaptive
    // pressure and can roll a mutation like any other added node.
    if (this.mutationConfig) {
      recordInvestment(plant, this.mutationConfig, radicleNode.type, radicleDef.biomass_cost);
      this.maybeAcquireMutation(plant, currentTick);
    }
    if ((plant.mutations?.length ?? 0) > 0) this.applyMutationSignature(plant);

    // Recompute Murray's law radii for the whole plant after structure change
    computeNodeRadii(plant);

    plant.growthSeq++;
    return {
      success: true,
      newNode: radicleNode,
      updatedParentNode: seedCrown,
      reason: `Radicle growth started (${growthTimeSeconds}s). Select the seed to add cotyledons.`,
    };
  }

  private isInBounds(x: number, y: number, z: number): boolean {
    return (
      x >= this.worldBounds.minX &&
      x <= this.worldBounds.maxX &&
      y >= this.worldBounds.minY &&
      y <= this.worldBounds.maxY &&
      z >= this.worldBounds.minZ &&
      z <= this.worldBounds.maxZ
    );
  }

  /** D01: Dev action - create random plant for stress testing */
  createRandomPlant(): string {
    // Dev stress plants belong to the same world as everything else; a literal
    // here used to write these plants to a different world id than the server.
    const worldId = this.plants.values().next().value?.worldId ?? 'world_0';
    const ownerId = `dev_stress_${Math.random().toString(36).slice(2, 8)}`;
    const x = (Math.random() - 0.5) * (this.worldBounds.maxX - this.worldBounds.minX) * 0.8;
    const z = (Math.random() - 0.5) * (this.worldBounds.maxZ - this.worldBounds.minZ) * 0.8;
    const plant = this.createPlant(ownerId, worldId, x, z);
    return plant.id;
  }

  killPlant(plantId: string, cause: PlantDeathCause, killedBy?: string): PlantDeathRecord | null {
    const plant = this.plants.get(plantId);
    if (!plant) return null;

    for (const node of plant.nodes.values()) {
      this.nodeSpatialIndex.remove(node);
    }

    this.plants.delete(plantId);
    const ownerPlants = this.plantByOwner.get(plant.ownerId);
    if (ownerPlants) {
      ownerPlants.delete(plantId);
      if (ownerPlants.size === 0) {
        this.plantByOwner.delete(plant.ownerId);
      }
    }

    eventBus.publishSync(GAME_EVENTS.PLANT_DEATH, {
      plantId: plant.id,
      ownerId: plant.ownerId,
      cause,
      timestamp: Date.now(),
    });

    const death: PlantDeathRecord = {
      id: plant.id,
      ownerId: plant.ownerId,
      worldId: plant.worldId,
      nodes: plant.nodes,
      totalBiomass: plant.totalBiomass,
      totalUpkeep: plant.totalUpkeep,
      rootNodeId: plant.rootNodeId,
      cause,
      killedBy,
    };
    // The simulation queues deaths and drains them after `step()` so callers
    // broadcast PLANT_REMOVED and deposit minerals exactly once.
    this.pendingDeaths.push(death);
    return death;
  }

  /** Removes a plant from the world (for dev actions). */
  removePlant(plantId: string): void {
    this.killPlant(plantId, 'removed');
  }

  /**
   * Apply structural damage to one part (T06).
   *
   * The part loses biomass and is detached once its mass is gone. A seed is
   * never detached: it is the node every other part hangs from, so it is left at
   * zero mass instead and the caller decides whether the plant has died.
   */
  applyNodeDamage(
    plantId: string,
    nodeId: string,
    amount: number,
  ): { biomassLost: number; destroyed: boolean; node: PlantNode | null } {
    const plant = this.plants.get(plantId);
    const node = plant?.nodes.get(nodeId);
    if (!plant || !node) return { biomassLost: 0, destroyed: false, node: null };
    const lost = Math.min(Math.max(0, node.biomass), Math.max(0, amount));
    node.biomass -= lost;
    this.refreshRadius(node);
    plant.totalBiomass = Math.max(0, plant.totalBiomass - lost);
    let destroyed = false;
    if (node.biomass <= 1e-6) {
      node.biomass = 0;
      if (!node.isSeed) {
        this.detachNode(plant, node);
        destroyed = true;
      }
    }
    return { biomassLost: lost, destroyed, node };
  }

  /**
   * Bleed structural mass during an uproot (T06). Unlike damage this records no
   * source and no kill credit: the plant is starving, it is not being eaten.
   */
  drainStructuralMass(plantId: string, amount: number): { lost: number; destroyed: PlantNode[] } {
    const plant = this.plants.get(plantId);
    if (!plant || !(amount > 0) || !(plant.totalBiomass > 0)) {
      return { lost: 0, destroyed: [] };
    }
    const share = Math.min(1, amount / plant.totalBiomass);
    const destroyed: PlantNode[] = [];
    let lost = 0;
    for (const node of Array.from(plant.nodes.values())) {
      if (node.isSeed) continue;
      const nodeLoss = node.biomass * share;
      node.biomass -= nodeLoss;
      this.refreshRadius(node);
      lost += nodeLoss;
      if (node.biomass <= 1e-6) {
        node.biomass = 0;
        this.detachNode(plant, node);
        destroyed.push(node);
      }
    }
    // With nothing but the seed left there is no tissue to thin, so the seed
    // itself is what starves. This is the state a failed reroot ends in.
    if (lost <= 0) {
      const seed = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      if (seed) {
        const seedLoss = Math.min(seed.biomass, amount);
        seed.biomass -= seedLoss;
        this.refreshRadius(seed);
        lost = seedLoss;
      }
    }
    plant.totalBiomass = Math.max(0, plant.totalBiomass - lost);
    return { lost, destroyed };
  }

  /** Detach and re-parent, keeping the graph connected under the removed part. */
  private detachNode(plant: Plant, node: PlantNode): void {
    plant.nodes.delete(node.id);
    this.nodeSpatialIndex.remove(node);
    const parent = node.parentId ? plant.nodes.get(node.parentId) : undefined;
    if (parent) {
      const index = parent.children.indexOf(node.id);
      if (index >= 0) parent.children.splice(index, 1);
    }
    for (const childId of node.children) {
      const child = plant.nodes.get(childId);
      if (!child) continue;
      child.parentId = parent ? parent.id : null;
      if (parent) parent.children.push(childId);
    }
    let upkeep = 0;
    for (const part of plant.nodes.values()) upkeep += part.upkeepBiomassPerSecond;
    plant.totalUpkeep = upkeep;
  }

  /** Returns deaths queued since the last call and clears the queue. */
  drainDeaths(): PlantDeathRecord[] {
    if (this.pendingDeaths.length === 0) return [];
    const deaths = this.pendingDeaths;
    this.pendingDeaths = [];
    return deaths;
  }

  loadPlant(plant: Plant): void {
    // INV-GR-02/04/05: repair what the data itself determines before deciding
    // whether the plant is corrupt. `parentId` is the authority, so a drifted
    // child list, a node carrying another plant's id, or a subtree hanging off
    // a missing parent is fixed here; validation below still refuses anything
    // the data cannot settle (two roots, non-finite positions). Before this, a
    // drifted child list was enough to lose a player's plant at boot.
    const repair = repairPlantGraph(plant);
    if (!isCleanRepair(repair)) {
      console.debug(
        `[plant-load] repaired ${plant.id}: ${repair.plantIdFixed} id, ${repair.childListsRebuilt} child list, ${repair.danglingChildrenDropped} dangling, ${repair.orphansDropped} orphan, ${repair.rootNodeAdopted} root`,
      );
    }
    if (plant.totalEnergy === undefined || plant.totalEnergy === null) {
      plant.totalEnergy =
        computePlantCapacity(plant, this.config).energy * this.config.initialEnergyFraction;
    }
    if (plant.storedWater === undefined || plant.storedWater === null) {
      plant.storedWater = 0;
    }
    if (plant.storedMinerals === undefined || plant.storedMinerals === null) {
      plant.storedMinerals = 0;
    }
    if (plant.growthSeq === undefined || plant.growthSeq === null) {
      plant.growthSeq = 0;
    }
    if (!Array.isArray(plant.mutations)) {
      plant.mutations = [];
    }
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
    this.applyMutationSignature(plant);
    for (const node of plant.nodes.values()) {
      if (node.growthProgress === undefined || node.growthProgress === null) {
        node.growthProgress = 1.0;
      }
      if (node.isSeed === undefined || node.isSeed === null) {
        node.isSeed = node.type === 'seed';
      }
    }
    // A resumed plant must not carry a zeroed structural total with intact
    // nodes: that made upkeep free and starved the death path of a cause.
    this.reconcileStructuralMass(plant);
    // Restored geometry is the one thing that can predate the current placement
    // rule, so it is repaired before it is validated or drawn.
    const repaired = this.repairSegmentLengths(plant);
    if (repaired > 0) {
      console.debug(`[plant-load] repaired ${repaired} segment step(s) on ${plant.id}`);
    }
    // Snapshots do not store radius; derive it from the shared table so a loaded
    // plant is drawn identically to the plant that produced the save, then let
    // any size mutation express the tissue its form can hold (idempotent: an
    // already-swollen part is left alone).
    computeNodeRadii(plant);
    this.syncMutationMass(plant, { grant: true });
    // Every loaded part keeps the widest form the current set can carry, so a
    // mutated plant is drawn to size after a reload too.
    for (const node of plant.nodes.values()) this.refreshRadius(node);
    const plantIssues = validatePlantGraph(plant, this.worldBounds);
    const loadErrors = plantIssues.issues.filter((issue) => issue.severity === 'error');
    if (loadErrors.length > 0) {
      throw new Error(
        `Refusing to load corrupt plant "${plant.id}": ${loadErrors
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    this.plants.set(plant.id, plant);
    if (!this.plantByOwner.has(plant.ownerId)) {
      this.plantByOwner.set(plant.ownerId, new Set());
    }
    this.plantByOwner.get(plant.ownerId)?.add(plant.id);
    for (const node of plant.nodes.values()) {
      this.nodeSpatialIndex.add(node);
    }
  }
}
