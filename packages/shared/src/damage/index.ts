/**
 * T06 damage, uproot and tumble rules.
 *
 * Pure decisions only: what takes damage, when a gust tears a root plate free,
 * whether a reroot can settle, which damage source gets kill credit, and how a
 * thrown body moves. The server owns the state and applies these rules; the
 * renderers only draw the node positions the server ends up with.
 *
 * Roots are not a damage source (ADR-051). Uproot always has a cause the player
 * could have seen coming — saturation, a gust, or a collapse — never a dice
 * roll (ADR-052).
 */

import type { NodeType, PlantNode, Vec3Like } from '../growth/types.ts';

/**
 * What took the biomass. `starvation` is the plant failing to pay its own upkeep
 * and shedding tissue to stay alive (`PlantWorld.drainShedDamage` → the shed
 * flush in `main.ts`). It is the one loss the player cannot dodge, so it has to
 * be nameable in the damage cue instead of falling through to "damage" (E18).
 */
export type DamageSource = 'weather' | 'tool' | 'herbivore' | 'terrain' | 'starvation';

/** Lifecycle for one plant. `rooted` is the resting state. */
export type UprootPhase = 'rooted' | 'uprooted' | 'tumbling' | 'rerooting';

export type UprootCause = 'saturation' | 'gust' | 'collapse' | 'structural_damage';

export interface DamageConfig {
  weatherDamagePerS: number;
  /** Structural biomass a plant needs before a storm can hurt it at all. */
  weatherMinBiomass: number;
  /** Ceiling on storm damage as a share of the plant's biomass per second. */
  weatherMaxBiomassFractionPerS: number;
  /** Most a lightning strike may take, as a share of the plant's biomass. */
  lightningMaxBiomassFraction: number;
  stormGustSpeedMps: number;
  lightningDamageAmount: number;
  herbivoreSwarmAutoEnabled: boolean;
  herbivoreSwarmIntervalS: number;
  herbivoreSwarmRadiusM: number;
  herbivoreSwarmDurationS: number;
  herbivoreSwarmDamagePerS: number;
  herbivoreSwarmSpreadM: number;
  toolDamagePerHit: number;
  terrainCollapseDamage: number;
  terrainCollapseRadiusM: number;
  damageMemoryDecayPerS: number;
  fragmentDropChance: number;
  remainsFragmentCount: number;
  fragmentLifetimeS: number;
  dungPerDeath: number;
  dungPerSwarm: number;
  dungLifetimeS: number;
  killCreditWindowS: number;
}

export interface UprootConfig {
  damageThresholdHp: number;
  rerootWindowS: number;
  rerootSoilMinMoisture: number;
  rerootSettleSeconds: number;
  rerootCrawlSpeedMps: number;
  uprootedBiomassDrainPerS: number;
  // Detached survival (T06). A plant torn free is not on a death timer: lying in
  // wet ground it can live as a cutting, at a lower quality of life.
  detachedWateredDrainMultiplier: number;
  detachedMinTileMoisture: number;
  detachedPhotosynthesisMultiplier: number;
  detachedDryGraceSeconds: number;
  detachedGrowthEnabled: boolean;
  saturationMoisture: number;
  saturationSeconds: number;
  saturationCheckIntervalS: number;
  gustThresholdMps: number;
  gustHeightReferenceM: number;
  collapseUprootRadiusM: number;
  uprootLiftM: number;
  uprootTiltDegrees: number;
}

export interface TumblingConfig {
  impulseMinMps: number;
  impulseMaxMps: number;
  gravityMps2: number;
  groundFrictionPerS: number;
  bounceDamping: number;
  maxTumbleSeconds: number;
  impactDamagePerMps: number;
  impactDamageMinSpeedMps: number;
  rollSpeedMaxRadPerS: number;
  settleSpeedMps: number;
}

/** One hit, kept so death can be credited to the source that did the most. */
export interface DamageRecord {
  source: DamageSource;
  amount: number;
  tick: number;
  /** Player who dealt it, when the source belongs to one (tools). */
  playerId?: string | null;
  /** Plant that dealt it. No MVP source sets this (ADR-051). */
  plantId?: string | null;
  nodeId?: string | null;
}

export interface KillCredit {
  kind: 'player' | 'plant' | 'none';
  playerId: string | null;
  plantId: string | null;
  amount: number;
}

/**
 * Which tissue a hit lands on.
 *
 * Soft, exposed organs go first so damage is legible: a grazing swarm strips
 * leaves before it reaches a trunk, and a plant is only structurally torn out
 * after its outer tissues are gone. A seed is last because it is the base the
 * whole graph hangs from.
 */
const TARGET_PRIORITY: Record<NodeType, number> = {
  leaf: 0,
  cotyledon: 0,
  flower: 0,
  spore_sac: 0,
  floating_leaf: 0,
  vine: 1,
  stem: 1,
  branch: 1,
  trunk: 1,
  culm: 1,
  stolon: 1,
  thorn: 1,
  tuber: 2,
  rhizome: 2,
  pneumatophore: 2,
  root: 3,
  radicle: 3,
  lateral_root: 3,
  seed: 4,
};

/**
 * Pick the hit target among the lowest-priority-number organs present.
 * `random` is injected so a test can be deterministic.
 */
export function selectDamageTarget(
  nodes: Iterable<PlantNode>,
  random: () => number = Math.random,
): PlantNode | null {
  let bestPriority = Number.POSITIVE_INFINITY;
  const candidates: PlantNode[] = [];
  for (const node of nodes) {
    if (!(node.biomass > 0)) continue;
    const priority = TARGET_PRIORITY[node.type] ?? 3;
    if (priority < bestPriority) {
      bestPriority = priority;
      candidates.length = 0;
      candidates.push(node);
    } else if (priority === bestPriority) {
      candidates.push(node);
    }
  }
  if (candidates.length === 0) return null;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index];
}

export interface TumbleState {
  /** Displacement from the pose captured when the plant came up. */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  headingRad: number;
  rollRad: number;
  rollSpeedRad: number;
  grounded: boolean;
  elapsedSeconds: number;
}

export interface TumbleStepResult {
  state: TumbleState;
  /** Downward speed at the moment of a ground contact, else 0. */
  impactSpeed: number;
  settled: boolean;
}

/** Launch a body: a horizontal hop plus a little lift and roll. */
export function createTumbleImpulse(random: () => number, config: TumblingConfig): TumbleState {
  const span = Math.max(0, config.impulseMaxMps - config.impulseMinMps);
  const speed = config.impulseMinMps + span * random();
  const heading = random() * Math.PI * 2;
  const rollSign = random() < 0.5 ? -1 : 1;
  return {
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    velocityX: Math.cos(heading) * speed,
    velocityY: speed * 0.35,
    velocityZ: Math.sin(heading) * speed,
    headingRad: heading,
    rollRad: 0,
    rollSpeedRad: rollSign * config.rollSpeedMaxRadPerS * (0.4 + random() * 0.6),
    grounded: false,
    elapsedSeconds: 0,
  };
}

/**
 * Integrate one tumble step. Deterministic and allocation-free apart from the
 * returned state object, so a test can replay a fall exactly.
 */
export function stepTumble(
  state: TumbleState,
  dt: number,
  config: TumblingConfig,
): TumbleStepResult {
  if (!(dt > 0)) return { state, impactSpeed: 0, settled: state.grounded };
  const next: TumbleState = { ...state, elapsedSeconds: state.elapsedSeconds + dt };
  let impactSpeed = 0;

  next.velocityY -= config.gravityMps2 * dt;
  next.offsetX += next.velocityX * dt;
  next.offsetY += next.velocityY * dt;
  next.offsetZ += next.velocityZ * dt;

  if (next.offsetY <= 0) {
    next.offsetY = 0;
    if (next.velocityY < 0) {
      impactSpeed = -next.velocityY;
      next.velocityY =
        impactSpeed >= config.settleSpeedMps ? impactSpeed * config.bounceDamping : 0;
    }
    next.grounded = true;
  } else {
    next.grounded = false;
  }

  if (next.grounded) {
    const damping = Math.max(0, 1 - config.groundFrictionPerS * dt);
    next.velocityX *= damping;
    next.velocityZ *= damping;
    next.rollSpeedRad *= damping;
  }
  next.rollRad += next.rollSpeedRad * dt;

  const horizontalSpeed = Math.hypot(next.velocityX, next.velocityZ);
  const settled =
    next.elapsedSeconds >= config.maxTumbleSeconds ||
    (next.grounded &&
      horizontalSpeed <= config.settleSpeedMps &&
      Math.abs(next.velocityY) <= config.settleSpeedMps &&
      next.elapsedSeconds >= 0.5);

  return { state: next, impactSpeed, settled };
}

/** Extra damage from a landing, above the configured minimum speed. */
export function impactDamage(impactSpeed: number, config: TumblingConfig): number {
  if (!(impactSpeed > config.impactDamageMinSpeedMps)) return 0;
  return (impactSpeed - config.impactDamageMinSpeedMps) * config.impactDamagePerMps;
}

/** Height of the exposed body above its root plate. */
export function plantHeight(nodes: Iterable<PlantNode>, rootNodeId: string | null): number {
  let rootY = 0;
  for (const node of nodes) {
    if (node.id === rootNodeId) {
      rootY = node.y;
      break;
    }
  }
  let top = rootY;
  for (const node of nodes) {
    if (node.y > top) top = node.y;
  }
  return Math.max(0, top - rootY);
}

/**
 * Wind a plant of this height actually catches. A seedling under the reference
 * height sheds most of the gust; a taller body catches more than the base gust,
 * capped so the comparison stays legible.
 */
export function effectiveGustSpeed(
  heightM: number,
  gustSpeedMps: number,
  config: UprootConfig,
): number {
  const reference = Math.max(0.2, config.gustHeightReferenceM);
  const exposure = Math.min(3, Math.max(0.15, heightM / reference));
  return gustSpeedMps * exposure;
}

export function gustTearsPlantFree(
  heightM: number,
  gustSpeedMps: number,
  config: UprootConfig,
): boolean {
  return effectiveGustSpeed(heightM, gustSpeedMps, config) >= config.gustThresholdMps;
}

/**
 * Structural damage needed to tear this plant out.
 *
 * `damage_threshold_hp` is a ceiling: a large plant still comes out once it has
 * lost four fifths of its own mass, which keeps a seedling from being
 * un-uprootable because it never reaches the configured HP total.
 */
export function uprootDamageThreshold(structuralMass: number, config: UprootConfig): number {
  return Math.min(config.damageThresholdHp, Math.max(1, structuralMass * 0.8));
}

export function damageTearsPlantFree(
  accumulatedDamage: number,
  structuralMass: number,
  config: UprootConfig,
): boolean {
  return accumulatedDamage >= uprootDamageThreshold(structuralMass, config);
}

export function rerootSoilIsValid(moisture: number, config: UprootConfig): boolean {
  return moisture >= config.rerootSoilMinMoisture;
}

/**
 * Share of the reroot settle timer earned this second. Kept separate from the
 * server so the rule can be read and tested without a world.
 */
export function rerootSettleStep(onValidSoil: boolean, dt: number, settledSeconds: number): number {
  if (!onValidSoil) return 0;
  return settledSeconds + Math.max(0, dt);
}

/**
 * Credit for a plant's death: whoever did the most damage inside the window.
 * Weather and herbivores leave no source id, so they credit nobody (T06 §Kill
 * credit).
 */
export function killCreditFor(
  records: readonly DamageRecord[],
  currentTick: number,
  tickRateHz: number,
  windowS: number,
): KillCredit {
  const windowTicks = Math.max(0, windowS) * Math.max(1, tickRateHz);
  const totals = new Map<string, { kind: 'player' | 'plant'; amount: number }>();
  for (const record of records) {
    if (currentTick - record.tick > windowTicks) continue;
    if (!(record.amount > 0)) continue;
    let key: string | null = null;
    let kind: 'player' | 'plant' = 'player';
    if (typeof record.playerId === 'string' && record.playerId.length > 0) {
      key = `player:${record.playerId}`;
      kind = 'player';
    } else if (typeof record.plantId === 'string' && record.plantId.length > 0) {
      key = `plant:${record.plantId}`;
      kind = 'plant';
    }
    if (!key) continue;
    const entry = totals.get(key) ?? { kind, amount: 0 };
    entry.amount += record.amount;
    totals.set(key, entry);
  }

  let best: { key: string; kind: 'player' | 'plant'; amount: number } | null = null;
  for (const [key, entry] of totals) {
    if (!best || entry.amount > best.amount) best = { key, ...entry };
  }
  if (!best) return { kind: 'none', playerId: null, plantId: null, amount: 0 };
  const id = best.key.slice(best.key.indexOf(':') + 1);
  return {
    kind: best.kind,
    playerId: best.kind === 'player' ? id : null,
    plantId: best.kind === 'plant' ? id : null,
    amount: best.amount,
  };
}

export function rollFragment(random: () => number, chance: number): boolean {
  return random() < Math.min(1, Math.max(0, chance));
}

/**
 * Rotate a point around an axis through the origin (Rodrigues). Used to lean a
 * whole plant about its root plate without touching per-part geometry.
 */
export function rotatePointAroundAxis(point: Vec3Like, axis: Vec3Like, angleRad: number): Vec3Like {
  const length = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const ax = axis.x / length;
  const ay = axis.y / length;
  const az = axis.z / length;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dot = point.x * ax + point.y * ay + point.z * az;
  return {
    x: point.x * cos + (ay * point.z - az * point.y) * sin + ax * dot * (1 - cos),
    y: point.y * cos + (az * point.x - ax * point.z) * sin + ay * dot * (1 - cos),
    z: point.z * cos + (ax * point.y - ay * point.x) * sin + az * dot * (1 - cos),
  };
}
