import type {
  DamageConfig,
  DamageRecord,
  DamageSource,
  KillCredit,
  TumbleState,
  TumblingConfig,
  UprootCause,
  UprootConfig,
  UprootPhase,
} from '@plant-legacy/shared/damage';
import {
  createTumbleImpulse,
  damageTearsPlantFree,
  gustTearsPlantFree,
  impactDamage,
  killCreditFor,
  plantHeight,
  rerootSettleStep,
  rerootSoilIsValid,
  rollFragment,
  rotatePointAroundAxis,
  selectDamageTarget,
  stepTumble,
  uprootDamageThreshold,
} from '@plant-legacy/shared/damage';
import type { Plant, PlantNode, PlantUprootState } from '@plant-legacy/shared/growth';
import type { WeatherStateName } from '@plant-legacy/weather';
import { eventBus, GAME_EVENTS } from '../eventBus.ts';
import type { PlantDeathRecord, PlantWorld } from '../plantWorld.ts';
import type { ResourceWorld } from '../resourceWorld.ts';
import type { TerrainService } from '../terrain.ts';

export type DropKind = 'fragment' | 'remains' | 'dung';

/** Something the world dropped. T51 turns fragments and remains into items. */
export interface WorldDrop {
  id: string;
  kind: DropKind;
  x: number;
  y: number;
  z: number;
  sourcePlantId: string | null;
  expiresAtMs: number;
}

export type DamagePipelineEvent =
  | {
      kind: 'damage';
      plantId: string;
      nodeId: string | null;
      destroyedNodeIds: string[];
      source: DamageSource;
      amount: number;
      totalBiomass: number;
      /** Unhealed structural damage and the ceiling that tears the plant free. */
      damageHp: number;
      structuralThreshold: number;
    }
  | {
      kind: 'uproot';
      plantId: string;
      cause: UprootCause;
      phase: UprootPhase;
      x: number;
      y: number;
      z: number;
      tiltRad: number;
      headingRad: number;
      windowRemainingS: number;
    }
  | { kind: 'reroot'; plantId: string; x: number; y: number; z: number }
  | { kind: 'fauna'; phase: 'start' | 'end'; x: number; z: number; radiusM: number }
  | { kind: 'drop'; drop: WorldDrop }
  | { kind: 'drop_expired'; id: string }
  | { kind: 'kill_credit'; plantId: string; credit: KillCredit };

export interface DamagePipelineOptions {
  plantWorld: PlantWorld;
  resourceWorld: ResourceWorld;
  terrain: TerrainService | null;
  damage: DamageConfig;
  uproot: UprootConfig;
  tumbling: TumblingConfig;
  tickRateHz: number;
  getWeatherState: () => WeatherStateName;
  lightningFrequencyPerMinute: number;
  lightningRadiusM: number;
  /** Seeded RNG in tests; `Math.random` in the game. */
  random?: () => number;
  /** Injectable clock so drop expiry can be tested without waiting. */
  now?: () => number;
  log?: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/** Continuous rain, as opposed to a clear spell over wet ground. */
// Ordinary rain wets the soil but does not liquefy it. Only a sustained storm
// can saturate a root plate enough to tear it free; before this, a drizzle
// could uproot a seedling that had barely broken the surface.
const SATURATING_STATES: ReadonlySet<WeatherStateName> = new Set(['thunderstorm_active']);

/**
 * T06 damage, uproot, tumbling, drops and kill credit.
 *
 * One pipeline owns every hit in the world. Sources hand it an amount; it picks
 * the tissue, applies the loss through `PlantWorld`, remembers the damage, and
 * decides whether the root plate survives. Roots are not a source (ADR-051) and
 * uproot triggers have causes, not dice (ADR-052).
 */
export class DamagePipeline {
  private readonly options: DamagePipelineOptions;
  private readonly random: () => number;
  private readonly records = new Map<string, DamageRecord[]>();
  /** Unhealed structural damage per plant, in biomass points. */
  private readonly damageMemory = new Map<string, number>();
  /** Continuous saturated seconds per rooted plant. */
  private readonly saturation = new Map<string, number>();
  /** Ticks before a gust may uproot this plant again after a reroot. */
  private readonly uprootCooldownUntil = new Map<string, number>();
  private readonly drops = new Map<string, WorldDrop>();
  private events: DamagePipelineEvent[] = [];
  /**
   * Damage is coalesced per plant before broadcast. Weather hits every plant on
   * every tick; sending one message per hit was 20 broadcasts a second per
   * plant. A part being destroyed flushes immediately.
   */
  private readonly pendingDamage = new Map<
    string,
    {
      amount: number;
      source: DamageSource;
      nodeId: string | null;
      destroyedNodeIds: string[];
      totalBiomass: number;
    }
  >();
  private readonly lastDamageBroadcastTick = new Map<string, number>();
  private nextDropSeq = 1;
  private nextSwarmTick: number;
  private swarm: { x: number; z: number; endsAtTick: number } | null = null;
  private terrainCursor: number;
  /** Last broadcast phase/tick per uprooted plant, so the transform is throttled. */
  private readonly lastUprootBroadcast = new Map<string, { phase: UprootPhase; tick: number }>();
  /** Per-plant accumulator for the configured saturation sampling cadence. */
  private readonly saturationAccumulator = new Map<string, number>();
  /**
   * Seconds a detached plant has spent on ground too dry to drink from.
   *
   * This is what makes a torn-free plant survivable: while the soil under it is
   * wet it lives as a cutting, and only once the ground has been dry for
   * `detached_dry_grace_s` does the full bleed apply. Not persisted — a reload
   * hands the plant a fresh capillary reserve, which is the forgiving side.
   */
  private readonly detachedDrySeconds = new Map<string, number>();

  constructor(options: DamagePipelineOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
    this.nextSwarmTick = Math.max(
      1,
      Math.round(options.damage.herbivoreSwarmIntervalS * options.tickRateHz),
    );
    this.terrainCursor = options.terrain?.getLatestRevision() ?? 0;
  }

  getConfig(): { damage: DamageConfig; uproot: UprootConfig; tumbling: TumblingConfig } {
    return {
      damage: this.options.damage,
      uproot: this.options.uproot,
      tumbling: this.options.tumbling,
    };
  }

  /** One tick of weather, fauna, collapse, uproot and drop bookkeeping. */
  tick(dt: number, tick: number): void {
    if (!(dt > 0)) return;
    const weather = this.options.getWeatherState();

    this.processTerrainCollapse(tick);
    this.updateHerbivores(dt, tick);
    this.updateLightning(dt, tick, weather);
    this.expireDrops();

    for (const plant of this.options.plantWorld.getAllPlants()) {
      if (!this.options.plantWorld.getPlant(plant.id)) continue;

      // Damage is forgotten slowly, so a series of hits can tear a plant out
      // while one scratch cannot.
      const memory = Math.max(
        0,
        (this.damageMemory.get(plant.id) ?? 0) - this.options.damage.damageMemoryDecayPerS * dt,
      );
      this.damageMemory.set(plant.id, memory);
      if (plant.uproot) plant.uproot.damageHp = memory;

      if (
        weather === 'thunderstorm_active' &&
        !this.isSeedOnly(plant) &&
        plant.totalBiomass >= this.options.damage.weatherMinBiomass
      ) {
        // Weather damage is absolute, not scaled by size, so a one-biomass seed
        // died in the first storm tick it lived through: "my seed died for no
        // reason". A seed in its coat is sheltered, the same way rain cannot
        // saturate one and a gust cannot tear it free, and a sprout below the
        // biomass floor is too small for the storm to spend damage on at all.
        // Deliberate tool damage still reaches either.
        // Capped by the plant's own size: absolute damage killed a two-node
        // seedling within seconds of its first storm, which read as "I take
        // continuous damage and my new node dies straight away".
        const rate = Math.min(
          this.options.damage.weatherDamagePerS,
          plant.totalBiomass * this.options.damage.weatherMaxBiomassFractionPerS,
        );
        this.applyDamage(plant.id, rate * dt, 'weather', tick);
      }

      const current = this.options.plantWorld.getPlant(plant.id);
      if (!current) continue;
      if (current.uproot) {
        this.updateUprootedPlant(current, dt, tick);
      } else {
        this.monitorSaturation(current, dt, tick, weather);
        this.monitorGust(current, tick, weather);
      }
    }
  }

  /**
   * Apply one hit. Returns true when the plant took any damage.
   *
   * `meta.playerId`/`meta.plantId` are only set for sources that can be credited
   * with a kill; weather and herbivores deliberately leave them empty.
   */
  applyDamage(
    plantId: string,
    amount: number,
    source: DamageSource,
    tick: number,
    meta: { playerId?: string | null; plantId?: string | null; nodeId?: string | null } = {},
  ): boolean {
    if (!(amount > 0)) return false;
    const plant = this.options.plantWorld.getPlant(plantId);
    if (!plant || plant.nodes.size === 0) return false;

    const target = meta.nodeId
      ? (plant.nodes.get(meta.nodeId) ?? selectDamageTarget(plant.nodes.values(), this.random))
      : selectDamageTarget(plant.nodes.values(), this.random);
    if (!target) return false;

    const result = this.options.plantWorld.applyNodeDamage(plant.id, target.id, amount);
    if (!result.node || result.biomassLost <= 0) return false;

    this.addDamageMemory(plant, result.biomassLost);
    if (meta.playerId || meta.plantId) {
      this.rememberDamage(plant.id, {
        source,
        amount: result.biomassLost,
        tick,
        playerId: meta.playerId ?? null,
        plantId: meta.plantId ?? null,
        nodeId: target.id,
      });
    }

    const destroyedNodeIds: string[] = [];
    if (result.destroyed) {
      destroyedNodeIds.push(target.id);
      this.maybeDropFragment(plant, target);
    }

    const pending = this.pendingDamage.get(plant.id) ?? {
      amount: 0,
      source,
      nodeId: target.id,
      destroyedNodeIds: [],
      totalBiomass: plant.totalBiomass,
    };
    pending.amount += result.biomassLost;
    pending.source = source;
    pending.nodeId = target.id;
    pending.destroyedNodeIds.push(...destroyedNodeIds);
    pending.totalBiomass = plant.totalBiomass;
    this.pendingDamage.set(plant.id, pending);

    const interval = Math.max(1, Math.round(this.options.tickRateHz / 2));
    const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    const last = this.lastDamageBroadcastTick.get(plant.id) ?? Number.NEGATIVE_INFINITY;
    const dead = !root || root.biomass <= 0 || plant.totalBiomass <= 1e-6;
    if (result.destroyed || dead || tick - last >= interval) {
      this.flushDamage(plant.id, tick);
    }

    if (dead) {
      // The source is what the loss screen needs: "damage" alone does not say
      // whether it was a tool, the storm, an animal or the ground giving way.
      this.options.plantWorld.killPlant(plant.id, 'damage', source);
      return true;
    }

    this.checkStructuralUproot(plant, tick);
    return true;
  }

  /** Emit the coalesced damage for one plant. */
  private flushDamage(plantId: string, tick: number): void {
    const pending = this.pendingDamage.get(plantId);
    if (!pending) return;
    this.pendingDamage.delete(plantId);
    this.lastDamageBroadcastTick.set(plantId, tick);
    this.events.push({
      kind: 'damage',
      plantId,
      nodeId: pending.nodeId,
      destroyedNodeIds: pending.destroyedNodeIds,
      source: pending.source,
      amount: pending.amount,
      totalBiomass: pending.totalBiomass,
      damageHp: this.damageMemory.get(plantId) ?? 0,
      structuralThreshold: uprootDamageThreshold(pending.totalBiomass, this.options.uproot),
    });
  }

  /** Dev/tool entry point: one accepted tool hit on a plant. */
  applyToolHit(plantId: string, tick: number, playerId?: string | null): boolean {
    return this.applyDamage(plantId, this.options.damage.toolDamagePerHit, 'tool', tick, {
      playerId: playerId ?? null,
    });
  }

  /**
   * Player steers the crawl while uprooted. The direction is a world XZ vector;
   * the server normalises it and keeps the speed for as long as it is set.
   */
  requestReroot(plantId: string, dirX: number, dirZ: number): boolean {
    const plant = this.options.plantWorld.getPlant(plantId);
    const state = plant?.uproot;
    if (!plant || !state || state.phase === 'rooted') return false;
    const length = Math.hypot(dirX, dirZ);
    if (!(length > 1e-6)) {
      state.crawlX = 0;
      state.crawlZ = 0;
      return true;
    }
    state.crawlX = dirX / length;
    state.crawlZ = dirZ / length;
    return true;
  }

  /** A seed with no tissue yet is anchored in the coat, not a root plate. */
  private isSeedOnly(plant: Plant): boolean {
    if (plant.nodes.size > 1) return false;
    const root = plant.rootNodeId
      ? plant.nodes.get(plant.rootNodeId)
      : Array.from(plant.nodes.values())[0];
    return root?.isSeed === true || root?.type === 'seed';
  }

  /** Force an uproot (dev action and tests). */
  forceUproot(plantId: string, cause: UprootCause, tick: number): boolean {
    const plant = this.options.plantWorld.getPlant(plantId);
    if (!plant || plant.uproot || this.isSeedOnly(plant)) return false;
    this.uprootPlant(plant, cause, tick);
    return true;
  }

  /** Force one herbivore swarm now (dev action and tests). */
  forceSwarm(x: number, z: number, tick: number): void {
    this.swarm = {
      x,
      z,
      endsAtTick:
        tick +
        Math.max(
          1,
          Math.round(this.options.damage.herbivoreSwarmDurationS * this.options.tickRateHz),
        ),
    };
    this.events.push({
      kind: 'fauna',
      phase: 'start',
      x,
      z,
      radiusM: this.options.damage.herbivoreSwarmRadiusM,
    });
    eventBus.publishSync(GAME_EVENTS.FAUNA_SWARM, {
      phase: 'start',
      x,
      z,
      radiusM: this.options.damage.herbivoreSwarmRadiusM,
      tick,
    });
  }

  /** Force a collapse at a point (dev action and tests). */
  forceCollapse(x: number, z: number, tick: number, actorPlantId: string | null = null): void {
    this.applyCollapse(x, z, this.options.damage.terrainCollapseRadiusM, tick, actorPlantId);
  }

  /** Called by the world when a plant death is settled. */
  onPlantDeath(death: PlantDeathRecord, tick: number): void {
    // Send any damage still waiting in the coalescing buffer before cleanup.
    this.flushDamage(death.id, tick);
    const credit = killCreditFor(
      this.records.get(death.id) ?? [],
      tick,
      this.options.tickRateHz,
      this.options.damage.killCreditWindowS,
    );
    if (credit.kind !== 'none') {
      this.events.push({ kind: 'kill_credit', plantId: death.id, credit });
      eventBus.publishSync(GAME_EVENTS.KILL_CREDITED, {
        plantId: death.id,
        credit,
        tick,
      });
    }

    const root = death.rootNodeId ? death.nodes.get(death.rootNodeId) : undefined;
    const fallback = death.nodes.values().next().value as PlantNode | undefined;
    const at = root ?? fallback;
    if (at) {
      for (let i = 0; i < this.options.damage.remainsFragmentCount; i += 1) {
        this.spawnDrop('remains', at.x, at.y, at.z, death.id);
      }
      for (let i = 0; i < this.options.damage.dungPerDeath; i += 1) {
        this.spawnDrop('dung', at.x, at.y, at.z, death.id);
      }
    }

    this.records.delete(death.id);
    this.damageMemory.delete(death.id);
    this.saturation.delete(death.id);
    this.saturationAccumulator.delete(death.id);
    this.uprootCooldownUntil.delete(death.id);
    this.lastUprootBroadcast.delete(death.id);
    this.pendingDamage.delete(death.id);
    this.lastDamageBroadcastTick.delete(death.id);
  }

  getDrops(): WorldDrop[] {
    return Array.from(this.drops.values());
  }

  getDamageMemory(plantId: string): number {
    return this.damageMemory.get(plantId) ?? 0;
  }

  /** Structural state for the HUD: damage taken and the uproot ceiling. */
  getStructure(plantId: string, structuralMass: number): { damageHp: number; threshold: number } {
    return {
      damageHp: this.damageMemory.get(plantId) ?? 0,
      threshold: uprootDamageThreshold(structuralMass, this.options.uproot),
    };
  }

  getActiveSwarm(): { x: number; z: number; endsAtTick: number } | null {
    return this.swarm;
  }

  /** Dequeue everything the world should broadcast. */
  drainEvents(): DamagePipelineEvent[] {
    if (this.events.length === 0) return [];
    const events = this.events;
    this.events = [];
    return events;
  }

  private rememberDamage(plantId: string, record: DamageRecord): void {
    const list = this.records.get(plantId) ?? [];
    list.push(record);
    // Only creditable sources are remembered; even so, a long fight must not
    // keep every hit forever. Old entries cannot affect a later window anyway.
    const windowTicks =
      this.options.damage.killCreditWindowS * Math.max(1, this.options.tickRateHz);
    while (list.length > 0 && record.tick - list[0].tick > windowTicks) list.shift();
    this.records.set(plantId, list);
  }

  private addDamageMemory(plant: Plant, amount: number): void {
    const next = (this.damageMemory.get(plant.id) ?? 0) + amount;
    this.damageMemory.set(plant.id, next);
    if (plant.uproot) plant.uproot.damageHp = next;
  }

  private checkStructuralUproot(plant: Plant, tick: number): void {
    if (plant.uproot && plant.uproot.phase !== 'rooted') return;
    const accumulated = this.damageMemory.get(plant.id) ?? 0;
    if (damageTearsPlantFree(accumulated, plant.totalBiomass, this.options.uproot)) {
      this.uprootPlant(plant, 'structural_damage', tick);
    }
  }

  private monitorSaturation(
    plant: Plant,
    dt: number,
    tick: number,
    weather: WeatherStateName,
  ): void {
    if (this.isSeedOnly(plant)) return;
    // Sampling has its own cadence so 65k tiles are not queried 20 times a
    // second; the seconds still accumulate across the whole span.
    const interval = Math.max(0.1, this.options.uproot.saturationCheckIntervalS);
    const accumulated = (this.saturationAccumulator.get(plant.id) ?? 0) + dt;
    if (accumulated < interval) {
      this.saturationAccumulator.set(plant.id, accumulated);
      return;
    }
    this.saturationAccumulator.set(plant.id, accumulated - interval);
    const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    if (!root) return;
    const tile = this.options.resourceWorld.getTileResources(root.x, root.z);
    const saturated =
      SATURATING_STATES.has(weather) && tile.moisture >= this.options.uproot.saturationMoisture;
    if (!saturated) {
      this.saturation.set(plant.id, 0);
      return;
    }
    const seconds = (this.saturation.get(plant.id) ?? 0) + interval;
    this.saturation.set(plant.id, seconds);
    if (seconds >= this.options.uproot.saturationSeconds) {
      this.uprootPlant(plant, 'saturation', tick);
    }
  }

  private monitorGust(plant: Plant, tick: number, weather: WeatherStateName): void {
    if (weather !== 'thunderstorm_active') return;
    const cooldown = this.uprootCooldownUntil.get(plant.id) ?? 0;
    if (tick < cooldown) return;
    const height = plantHeight(plant.nodes.values(), plant.rootNodeId);
    if (gustTearsPlantFree(height, this.options.damage.stormGustSpeedMps, this.options.uproot)) {
      this.uprootPlant(plant, 'gust', tick);
    }
  }

  private uprootPlant(plant: Plant, cause: UprootCause, tick: number): void {
    // A seed that has not germinated cannot be "torn free": there is no root
    // plate yet, and the coat is the entire plant. Ordinary rain used to be able
    // to saturate one and start a starvation clock on a plant the player had
    // only just planted.
    if (this.isSeedOnly(plant)) return;
    if (plant.uproot && plant.uproot.phase !== 'rooted') return;
    const impulse = createTumbleImpulse(this.random, this.options.tumbling);
    const basePose = new Map<string, { x: number; y: number; z: number }>();
    const baseAttach = new Map<string, { x: number; y: number; z: number }>();
    for (const node of plant.nodes.values()) {
      basePose.set(node.id, { x: node.x, y: node.y, z: node.z });
      if (node.parentAttachX !== undefined && node.parentAttachZ !== undefined) {
        baseAttach.set(node.id, {
          x: node.parentAttachX,
          y: node.parentAttachY ?? node.y,
          z: node.parentAttachZ,
        });
      }
    }
    const state: PlantUprootState = {
      phase: 'uprooted',
      cause,
      sinceTick: tick,
      damageHp: this.damageMemory.get(plant.id) ?? 0,
      saturatedSeconds: this.saturation.get(plant.id) ?? 0,
      settledSeconds: 0,
      tiltRad: (this.options.uproot.uprootTiltDegrees * Math.PI) / 180,
      headingRad: impulse.headingRad,
      rollRad: 0,
      rollSpeedRad: impulse.rollSpeedRad,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      velocityX: impulse.velocityX,
      velocityY: impulse.velocityY,
      velocityZ: impulse.velocityZ,
      crawlX: 0,
      crawlZ: 0,
      tumbleSeconds: 0,
      tumbleSettled: false,
      basePose,
      baseAttach,
    };
    plant.uproot = state;
    this.saturation.delete(plant.id);
    // A plant that reroots inside the same storm is not torn out again the very
    // next tick: the gust has to come round after the recovery window.
    this.uprootCooldownUntil.set(
      plant.id,
      tick + Math.round(this.options.uproot.rerootWindowS * this.options.tickRateHz),
    );
    this.applyUprootPose(plant, state);
    const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    this.events.push({
      kind: 'uproot',
      plantId: plant.id,
      cause,
      phase: state.phase,
      x: root?.x ?? 0,
      y: root?.y ?? 0,
      z: root?.z ?? 0,
      tiltRad: state.tiltRad,
      headingRad: state.headingRad,
      windowRemainingS: this.options.uproot.rerootWindowS,
    });
    eventBus.publishSync(GAME_EVENTS.PLANT_UPROOTED, {
      plantId: plant.id,
      cause,
      x: root?.x ?? 0,
      z: root?.z ?? 0,
      tick,
    });
  }

  private updateUprootedPlant(plant: Plant, dt: number, tick: number): void {
    const state = plant.uproot;
    if (!state) return;
    // A seed-only plant cannot really be uprooted; clear a state inherited
    // from an older save instead of draining its coat to death.
    if (this.isSeedOnly(plant)) {
      plant.uproot = undefined;
      return;
    }
    const elapsed = (tick - state.sinceTick) / this.options.tickRateHz;
    const windowRemaining = Math.max(0, this.options.uproot.rerootWindowS - elapsed);

    state.tumbleSeconds += dt;

    // Crawl only after the body has stopped bouncing around. Steering during the
    // tumble would fight the impulse and feel like the input was ignored.
    if (state.phase === 'uprooted' || state.phase === 'rerooting') {
      if (state.crawlX !== 0 || state.crawlZ !== 0) {
        // T04 movement.rerootSpeed multiplies the crawl (acceptance for the T04
        // movement block). The substrate multiplier stays 1 until T02 exposes
        // one; the terrain service has no substrate signal yet.
        const mutationMultiplier =
          this.options.plantWorld.getMutationEffects(plant).rerootSpeedMultiplier ?? 1;
        const speed = this.options.uproot.rerootCrawlSpeedMps * mutationMultiplier;
        state.offsetX += state.crawlX * speed * dt;
        state.offsetZ += state.crawlZ * speed * dt;
        state.phase = 'rerooting';
      }
    }

    if (state.phase === 'uprooted' && !state.tumbleSettled) {
      // Uprooted is the one tick between the rip and the first physics step.
      state.phase = 'tumbling';
    }

    if (state.phase === 'tumbling') {
      const tumble: TumbleState = {
        offsetX: state.offsetX,
        offsetY: state.offsetY,
        offsetZ: state.offsetZ,
        velocityX: state.velocityX,
        velocityY: state.velocityY,
        velocityZ: state.velocityZ,
        headingRad: state.headingRad,
        rollRad: state.rollRad,
        rollSpeedRad: state.rollSpeedRad,
        grounded: state.offsetY <= 0,
        elapsedSeconds: state.tumbleSeconds,
      };
      const result = stepTumble(tumble, dt, this.options.tumbling);
      state.offsetX = result.state.offsetX;
      state.offsetY = result.state.offsetY;
      state.offsetZ = result.state.offsetZ;
      state.velocityX = result.state.velocityX;
      state.velocityY = result.state.velocityY;
      state.velocityZ = result.state.velocityZ;
      state.rollRad = result.state.rollRad;
      state.rollSpeedRad = result.state.rollSpeedRad;
      state.tumbleSeconds = result.state.elapsedSeconds;
      if (result.impactSpeed > 0) {
        const landingDamage = impactDamage(result.impactSpeed, this.options.tumbling);
        if (landingDamage > 0) this.applyDamage(plant.id, landingDamage, 'terrain', tick);
        if (!this.options.plantWorld.getPlant(plant.id)) return;
      }
      if (result.settled && this.options.plantWorld.getPlant(plant.id)) {
        state.phase = 'uprooted';
        state.tumbleSettled = true;
        state.offsetY = 0;
        state.velocityX = 0;
        state.velocityY = 0;
        state.velocityZ = 0;
      }
    }

    this.applyUprootPose(plant, state);

    const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    const moisture = root
      ? this.options.resourceWorld.getTileResources(root.x, root.z).moisture
      : 0;
    const canSettle =
      windowRemaining > 0 &&
      (state.phase === 'uprooted' || state.phase === 'rerooting') &&
      rerootSoilIsValid(moisture, this.options.uproot);
    state.settledSeconds = rerootSettleStep(canSettle, dt, state.settledSeconds);
    if (state.settledSeconds >= this.options.uproot.rerootSettleSeconds) {
      this.completeReroot(plant, tick);
      return;
    }

    // An uprooted plant is no longer on a death timer. With roots out of the
    // soil it cannot drink, but a plant lying in wet ground draws enough from
    // the soil it rests on to live as a cutting (the hydroponic case) at a much
    // slower bleed. Dry ground is what kills: the capillary reserve lasts
    // `detachedDryGraceSeconds`, then the full rate applies and the plant
    // starves, which is still the failure mode ADR-052 describes.
    const detached = this.options.uproot;
    let drySeconds = this.detachedDrySeconds.get(plant.id) ?? 0;
    if (moisture >= detached.detachedMinTileMoisture) {
      drySeconds = 0;
    } else {
      drySeconds += dt;
    }
    this.detachedDrySeconds.set(plant.id, drySeconds);
    const hasCapillaryWater = drySeconds <= detached.detachedDryGraceSeconds;
    const bleedFactor = hasCapillaryWater ? detached.detachedWateredDrainMultiplier : 1;
    const drain = detached.uprootedBiomassDrainPerS * bleedFactor * dt;
    if (drain > 0) {
      const result = this.options.plantWorld.drainStructuralMass(plant.id, drain);
      for (const node of result.destroyed) {
        this.maybeDropFragment(plant, node);
      }
      if (plant.totalBiomass <= 1e-6) {
        // Torn free, dry, and bled out. Reporting this as plain "starvation"
        // hid the cause the player actually experienced.
        this.detachedDrySeconds.delete(plant.id);
        this.options.plantWorld.killPlant(plant.id, 'starvation', 'uprooted');
        return;
      }
    }

    // Keep the broadcast transform current so clients see the crawl and roll,
    // but do not send 20 transforms a second for a plant that is only draining.
    const previous = this.lastUprootBroadcast.get(plant.id);
    const shouldBroadcast =
      !previous ||
      previous.phase !== state.phase ||
      tick - previous.tick >= Math.max(1, Math.round(this.options.tickRateHz / 4));
    if (shouldBroadcast) {
      this.lastUprootBroadcast.set(plant.id, { phase: state.phase, tick });
      this.events.push({
        kind: 'uproot',
        plantId: plant.id,
        cause: state.cause ?? 'structural_damage',
        phase: state.phase,
        x: root?.x ?? 0,
        y: root?.y ?? 0,
        z: root?.z ?? 0,
        tiltRad: state.tiltRad + state.rollRad,
        headingRad: state.headingRad,
        windowRemainingS: windowRemaining,
      });
    }
  }

  private completeReroot(plant: Plant, tick: number): void {
    const state = plant.uproot;
    if (!state) return;
    const rootId = plant.rootNodeId;
    const baseRoot = rootId ? state.basePose.get(rootId) : undefined;
    const newRootX = (baseRoot?.x ?? 0) + state.offsetX;
    const newRootZ = (baseRoot?.z ?? 0) + state.offsetZ;
    // A node's y is measured from the soil line *under that node*, not from a
    // world zero: the seed is created at y = 0 wherever it is planted, and the
    // client adds the terrain relief of each node's own x/z when it draws.
    // Re-basing the body onto the terrain height at the landing spot therefore
    // lifted the whole plant by that relief - crawling three metres onto a 16 m
    // rise teleported the crown to y = 16, which put the body in the air, the
    // Root Sight bubbles with it and Space framed empty sky. The body keeps its
    // shape relative to the ground; only x and z move.
    for (const node of plant.nodes.values()) {
      const base = state.basePose.get(node.id);
      if (!base) continue;
      node.x = base.x + state.offsetX;
      node.y = base.y;
      node.z = base.z + state.offsetZ;
      const attach = state.baseAttach.get(node.id);
      if (attach) {
        node.parentAttachX = attach.x + state.offsetX;
        node.parentAttachY = attach.y;
        node.parentAttachZ = attach.z + state.offsetZ;
      }
    }
    plant.uproot = undefined;
    this.damageMemory.delete(plant.id);
    this.saturation.delete(plant.id);
    this.saturationAccumulator.delete(plant.id);
    this.detachedDrySeconds.delete(plant.id);
    this.lastUprootBroadcast.delete(plant.id);
    const root = rootId ? plant.nodes.get(rootId) : undefined;
    this.events.push({
      kind: 'reroot',
      plantId: plant.id,
      x: root?.x ?? newRootX,
      y: root?.y ?? baseRoot?.y ?? 0,
      z: root?.z ?? newRootZ,
    });
    eventBus.publishSync(GAME_EVENTS.PLANT_REROOTED, {
      plantId: plant.id,
      x: root?.x ?? newRootX,
      z: root?.z ?? newRootZ,
      tick,
    });
  }

  /**
   * Place every node from the rigid pose captured at uproot. Recomputing from
   * the base each time keeps a long tumble from accumulating drift.
   */
  private applyUprootPose(plant: Plant, state: PlantUprootState): void {
    const rootId = plant.rootNodeId;
    const baseRoot = rootId ? state.basePose.get(rootId) : undefined;
    const origin = baseRoot ?? { x: 0, y: 0, z: 0 };
    const axis = {
      x: Math.cos(state.headingRad),
      y: 0,
      z: -Math.sin(state.headingRad),
    };
    const angle = state.phase === 'tumbling' ? state.tiltRad + state.rollRad : state.tiltRad;
    for (const node of plant.nodes.values()) {
      const base = state.basePose.get(node.id);
      if (!base) continue;
      const rotated = rotatePointAroundAxis(
        { x: base.x - origin.x, y: base.y - origin.y, z: base.z - origin.z },
        axis,
        angle,
      );
      node.x = origin.x + rotated.x + state.offsetX;
      node.y = origin.y + rotated.y + this.options.uproot.uprootLiftM + Math.max(0, state.offsetY);
      node.z = origin.z + rotated.z + state.offsetZ;
      // The joint rides the same rigid body. Left out, every child stayed
      // attached to where its parent had been, which is the plant coming apart
      // at its joints. A node grown while detached has no base entry (its
      // attach point was placed on the posed parent already), so it is skipped.
      const baseAttach = state.baseAttach.get(node.id);
      if (baseAttach) {
        const rotatedAttach = rotatePointAroundAxis(
          {
            x: baseAttach.x - origin.x,
            y: baseAttach.y - origin.y,
            z: baseAttach.z - origin.z,
          },
          axis,
          angle,
        );
        node.parentAttachX = origin.x + rotatedAttach.x + state.offsetX;
        node.parentAttachY =
          origin.y + rotatedAttach.y + this.options.uproot.uprootLiftM + Math.max(0, state.offsetY);
        node.parentAttachZ = origin.z + rotatedAttach.z + state.offsetZ;
      }
    }
  }

  private updateHerbivores(dt: number, tick: number): void {
    if (!this.swarm) {
      // Automatic swarms stay off until T54 gives them a visible body. A
      // swarm spawned around the origin used to damage every new plant in
      // range with nothing on screen to explain it. Dev actions still call
      // forceSwarm directly.
      if (!this.options.damage.herbivoreSwarmAutoEnabled) return;
      if (tick >= this.nextSwarmTick) {
        const spread = this.options.damage.herbivoreSwarmSpreadM;
        const x = (this.random() * 2 - 1) * spread;
        const z = (this.random() * 2 - 1) * spread;
        this.forceSwarm(x, z, tick);
      }
      return;
    }

    if (tick >= this.swarm.endsAtTick) {
      this.spawnDungAt(this.swarm.x, this.swarm.z, this.options.damage.dungPerSwarm);
      this.events.push({
        kind: 'fauna',
        phase: 'end',
        x: this.swarm.x,
        z: this.swarm.z,
        radiusM: this.options.damage.herbivoreSwarmRadiusM,
      });
      eventBus.publishSync(GAME_EVENTS.FAUNA_SWARM, {
        phase: 'end',
        x: this.swarm.x,
        z: this.swarm.z,
        tick,
      });
      this.swarm = null;
      this.nextSwarmTick =
        tick +
        Math.max(
          1,
          Math.round(this.options.damage.herbivoreSwarmIntervalS * this.options.tickRateHz),
        );
      return;
    }

    const radius = this.options.damage.herbivoreSwarmRadiusM;
    for (const plant of this.options.plantWorld.getAllPlants()) {
      const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      if (!root) continue;
      if (Math.hypot(root.x - this.swarm.x, root.z - this.swarm.z) > radius) continue;
      this.applyDamage(
        plant.id,
        this.options.damage.herbivoreSwarmDamagePerS * dt,
        'herbivore',
        tick,
      );
    }
  }

  private updateLightning(dt: number, tick: number, weather: WeatherStateName): void {
    if (weather !== 'thunderstorm_active') return;
    const perSecond = this.options.lightningFrequencyPerMinute / 60;
    if (this.random() >= perSecond * dt) return;
    // Strike near a real plant when one exists, so the bolt is a hazard rather
    // than scenery; with no plants in the world nothing is hit.
    const plants = this.options.plantWorld.getAllPlants();
    if (plants.length === 0) return;
    const target = plants[Math.min(plants.length - 1, Math.floor(this.random() * plants.length))];
    const root = target.rootNodeId ? target.nodes.get(target.rootNodeId) : undefined;
    if (!root) return;
    for (const plant of plants) {
      const plantRoot = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      if (!plantRoot) continue;
      if (Math.hypot(plantRoot.x - root.x, plantRoot.z - root.z) > this.options.lightningRadiusM) {
        continue;
      }
      // A strike is one fixed amount, so it killed a one-biomass seed outright.
      // The same size floor as the storm's rate applies: lightning is a hazard
      // for a grown plant, not an executioner for a sprout.
      if (this.isSeedOnly(plant)) continue;
      if (plant.totalBiomass < this.options.damage.weatherMinBiomass) continue;
      const strike = Math.min(
        this.options.damage.lightningDamageAmount,
        plant.totalBiomass * this.options.damage.lightningMaxBiomassFraction,
      );
      if (strike <= 0) continue;
      this.applyDamage(plant.id, strike, 'weather', tick);
    }
  }

  private processTerrainCollapse(tick: number): void {
    const terrain = this.options.terrain;
    if (!terrain) return;
    const edits = terrain.getEditsSince(this.terrainCursor);
    if (edits.length === 0) return;
    this.terrainCursor = edits[edits.length - 1].id;
    for (const edit of edits) {
      if (edit.kind !== 'collapse') continue;
      this.applyCollapse(
        edit.x,
        edit.z,
        this.options.damage.terrainCollapseRadiusM,
        tick,
        edit.actorPlantId,
      );
    }
  }

  /**
   * A roof came down. Everyone standing on it is hurt — except the plant whose
   * own root dug the cavity: a root that undermines the ground and then takes
   * the falling soil as damage punished the player for growing at all. Roots are
   * not a damage source (ADR-051), and this is the growth path it names.
   */
  private applyCollapse(
    x: number,
    z: number,
    radiusM: number,
    tick: number,
    actorPlantId: string | null,
  ): void {
    for (const plant of this.options.plantWorld.getAllPlants()) {
      if (actorPlantId !== null && plant.id === actorPlantId) continue;
      const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      if (!root) continue;
      const distance = Math.hypot(root.x - x, root.z - z);
      if (distance > radiusM) continue;
      this.applyDamage(plant.id, this.options.damage.terrainCollapseDamage, 'terrain', tick);
      const current = this.options.plantWorld.getPlant(plant.id);
      if (current && !current.uproot && distance <= this.options.uproot.collapseUprootRadiusM) {
        this.uprootPlant(current, 'collapse', tick);
      }
    }
  }

  private maybeDropFragment(plant: Plant, node: PlantNode): void {
    if (!rollFragment(this.random, this.options.damage.fragmentDropChance)) return;
    this.spawnDrop('fragment', node.x, node.y, node.z, plant.id);
  }

  private spawnDungAt(x: number, z: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.spawnDrop('dung', x, 0, z, null);
    }
  }

  private spawnDrop(
    kind: DropKind,
    x: number,
    y: number,
    z: number,
    sourcePlantId: string | null,
  ): WorldDrop {
    const lifetimeS =
      kind === 'dung' ? this.options.damage.dungLifetimeS : this.options.damage.fragmentLifetimeS;
    const drop: WorldDrop = {
      id: `drop_${this.nextDropSeq++}`,
      kind,
      x,
      y,
      z,
      sourcePlantId,
      expiresAtMs: (this.options.now ?? Date.now)() + lifetimeS * 1000,
    };
    this.drops.set(drop.id, drop);
    this.events.push({ kind: 'drop', drop });
    eventBus.publishSync(
      kind === 'dung' ? GAME_EVENTS.DUNG_DROPPED : GAME_EVENTS.FRAGMENT_DROPPED,
      {
        dropId: drop.id,
        kind,
        x,
        y,
        z,
        sourcePlantId,
      },
    );
    return drop;
  }

  private expireDrops(): void {
    const now = (this.options.now ?? Date.now)();
    for (const [id, drop] of this.drops) {
      if (now < drop.expiresAtMs) continue;
      this.drops.delete(id);
      this.events.push({ kind: 'drop_expired', id });
    }
  }
}
