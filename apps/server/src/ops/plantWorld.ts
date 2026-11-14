import type {
  GrowthConfig,
  GrowthIntent,
  GrowthOptionsResult,
  GrowthResult,
  NodeTypeDefinition,
  Plant,
  PlantNode,
} from '@plant-legacy/shared/growth';
import {
  canCrossLayer,
  clampGrowthDirectionByGene,
  getAvailableGrowthTypes,
  getLayerForNodeType,
  getNodeTypeDefinition,
  nodeRenderRadius,
  placeSegment,
  resolveAttachFraction,
} from '@plant-legacy/shared/growth';
import { newId } from '@plant-legacy/shared/ids';
import { validatePlantGraph } from '@plant-legacy/shared/plantGraphValidator';
import { eventBus, GAME_EVENTS } from './eventBus.ts';
import { NodeSpatialIndex } from './growth/nodeSpatialIndex.ts';
import { buildGrowthOptions } from './growth/options.ts';
import {
  attachmentPart,
  canGrow,
  computeGrowthCostQuote,
  computeNodeRadii,
  getGrowthSpeed,
  maxCotyledonsForPlant,
  nodeName,
  normalizeDirection,
  validateGrowthDirection,
} from './growth/rules.ts';
import { clampPlantStorage, computePlantCapacity } from './plantCapacity.ts';
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
}

export class PlantWorld {
  private plants = new Map<string, Plant>();
  private plantByOwner = new Map<string, Set<string>>();
  private readonly nodeSpatialIndex = new NodeSpatialIndex();
  private pendingDeaths: PlantDeathRecord[] = [];
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
      consumptionTriggerTileMineralThreshold: 10,
      consumptionTriggerDungItem: false,
      consumptionTriggerFertilizerItem: false,
      diffusionRate: 0.1,
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

  getGrowthOptions(plantId: string, nodeId: string): GrowthOptionsResult | null {
    const plant = this.plants.get(plantId);
    if (!plant) return null;

    const node = plant.nodes.get(nodeId);
    if (!node) return null;

    const tile = this.resourceProvider ? this.resourceProvider(node.x, node.z) : undefined;
    return buildGrowthOptions(this.config, plant, node, tile);
  }

  createPlant(ownerId: string, worldId: string, startX: number, startZ: number): Plant {
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
        clampPlantStorage(plant, this.config);
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
    const isDormantSeed =
      rootNode?.type === 'seed' && rootNode.isSeed === true && plant.nodes.size <= 1;
    if (rootNode && !isDormantSeed) {
      const energyUpkeepCost =
        plant.totalBiomass * this.config.energyUpkeepPerBiomass * elapsedSeconds;
      const canPayUpkeep = plant.totalEnergy >= energyUpkeepCost;
      plant.totalEnergy = Math.max(0, plant.totalEnergy - energyUpkeepCost);
      if (!canPayUpkeep) {
        plant.totalBiomass = Math.max(0, plant.totalBiomass - energyUpkeepCost);
        if (plant.totalBiomass <= 0) {
          this.killPlant(plant.id, 'starvation');
          return;
        }
      }
      this.applyTissueUpkeep(plant, elapsedSeconds);
      if (!this.plants.has(plant.id)) return;
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

  private processPlantUpkeep(plant: Plant, dt: number): void {
    this.reconcileStructuralMass(plant);
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
    const isDormantSeed =
      rootNode?.type === 'seed' && rootNode.isSeed === true && plant.nodes.size <= 1;
    if (rootNode && !isDormantSeed) {
      const energyUpkeepCost = plant.totalBiomass * this.config.energyUpkeepPerBiomass * dt;
      const canPayUpkeep = plant.totalEnergy >= energyUpkeepCost;
      plant.totalEnergy = Math.max(0, plant.totalEnergy - energyUpkeepCost);

      if (!canPayUpkeep) {
        plant.totalBiomass = Math.max(0, plant.totalBiomass - energyUpkeepCost);
        if (plant.totalBiomass <= 0) {
          this.killPlant(plant.id, 'starvation');
          return;
        }
      }
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

    if (waterRate > 0) {
      const need = plant.totalBiomass * waterRate * dt;
      const paid = Math.min(plant.storedWater, need);
      plant.storedWater = Math.max(0, plant.storedWater - paid);
      const deficit = need - paid;
      if (deficit > 0) {
        plant.totalBiomass = Math.max(
          0,
          plant.totalBiomass - deficit * (this.config.waterDeficitBiomassLoss ?? 0),
        );
      }
    }

    if (mineralRate > 0) {
      const need = plant.totalBiomass * mineralRate * dt;
      const paid = Math.min(plant.storedMinerals, need);
      plant.storedMinerals = Math.max(0, plant.storedMinerals - paid);
      const deficit = need - paid;
      if (deficit > 0) {
        plant.totalBiomass = Math.max(
          0,
          plant.totalBiomass - deficit * (this.config.mineralDeficitBiomassLoss ?? 0),
        );
      }
    }

    if (plant.totalBiomass <= 0) this.killPlant(plant.id, 'starvation');
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
      // budget: mass may never exceed what the part is actually drawn as.
      const targetMass = computeGrowthCostQuote(this.config, nodeDef).biomassGain;
      const biomassThisTick = targetMass * progressThisTick;
      plant.totalBiomass += biomassThisTick;
      node.biomass = (node.biomass ?? 0) + biomassThisTick;

      const waterCostPerSecond = this.config.growthWaterConsumptionRate * nodeDef.biomass_cost;
      const mineralCostPerSecond = this.config.growthMineralConsumptionRate * nodeDef.biomass_cost;
      const waterCost = Math.min(plant.storedWater, waterCostPerSecond * dt);
      const mineralCost = Math.min(plant.storedMinerals, mineralCostPerSecond * dt);
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
        node.biomass = targetMass;
        node.upkeepBiomassPerSecond = nodeDef.upkeep_biomass_per_second;
        plant.totalUpkeep += nodeDef.upkeep_biomass_per_second;
        node.targetX = node.targetY = node.targetZ = undefined;
        node.growthTimeRemaining = 0;
      }

      // Radius follows the part's own biomass so a growing segment thickens in
      // step with the drawn geometry (one shared table, no client clamps).
      node.radius = nodeRenderRadius(node.type, node.biomass);
    }
  }

  addPhotosynthesisEnergy(plantId: string, energyGain: number): void {
    const plant = this.plants.get(plantId);
    if (!plant) return;
    plant.totalEnergy += energyGain;
    clampPlantStorage(plant, this.config);
  }

  tryGrow(intent: GrowthIntent, currentTick: number): GrowthResult {
    const plant = this.plants.get(intent.plantId);
    if (!plant) return { success: false, reason: 'plant_not_found' };
    if (currentTick < plant.growthCooldownUntil) {
      return { success: false, reason: 'growth_on_cooldown' };
    }

    const parentNode = plant.nodes.get(intent.nodeId);
    if (!parentNode) return { success: false, reason: 'parent_node_not_found' };

    const targetType = intent.nodeType;
    const targetLayer = getLayerForNodeType(targetType);

    // A stem/canopy part must come from the crown, never from a buried root.
    if (
      targetLayer === 'canopy' &&
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
      if (!availableTypes.includes(targetType)) {
        return { success: false, reason: 'cannot_cross_layer' };
      }
    }

    const clampedDir = clampGrowthDirectionByGene(targetType, intent.direction);
    const dir = normalizeDirection(clampedDir);
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
    const speed = nodeDef.segment_length ?? getGrowthSpeed(this.config, targetLayer);
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

    const costs = computeGrowthCostQuote(this.config, nodeDef);
    // Roots pay for the soil they open; canopy growth is in air. The provider
    // returns a multiplier clamped by `growth_resistance_min/max`.
    const resistance =
      targetLayer === 'root'
        ? Math.max(0.25, this.growthResistanceProvider?.(newX, newY, newZ) ?? 1)
        : 1;
    const energyCost = costs.energyCost * resistance;
    const growthTimeSeconds = costs.growthTimeSeconds * resistance;

    if (plant.totalEnergy < energyCost) {
      return { success: false, reason: 'insufficient_energy' };
    }

    // Establishment runs on seed reserves (plus the soil moisture gate inside
    // handleGermination). Everything after that must be paid for from the
    // plant's own captured water and minerals, not merely from its energy.
    const isEstablishment = targetType === 'radicle' || targetType === 'cotyledon';
    if (!isEstablishment) {
      const storedGate = canGrow(plant, this.config);
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
    plant.totalEnergy -= energyCost;
    plant.lastGrowthTick = currentTick;
    plant.growthCooldownUntil =
      currentTick + Math.ceil(this.config.growthCooldown * this.activeTickRateHz);

    parentNode.children.push(newNodeId);
    this.nodeSpatialIndex.add(newNode);

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

  killPlant(plantId: string, cause: PlantDeathCause): PlantDeathRecord | null {
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

  /** Returns deaths queued since the last call and clears the queue. */
  drainDeaths(): PlantDeathRecord[] {
    if (this.pendingDeaths.length === 0) return [];
    const deaths = this.pendingDeaths;
    this.pendingDeaths = [];
    return deaths;
  }

  loadPlant(plant: Plant): void {
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
    // plant is drawn identically to the plant that produced the save.
    computeNodeRadii(plant);
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
