/**
 * Growth vocabulary shared by the server, the shared rules and every renderer.
 *
 * This module is types only: no functions and no tunables. Keeping it separate
 * lets the geometry and node-type rules import the same declarations without a
 * cycle, and lets consumers tell "a shape of the data" apart from "a rule about
 * the data".
 */

import type { UprootCause, UprootPhase } from '../damage/index.ts';

export type NodeType =
  | 'seed'
  | 'radicle'
  | 'root'
  | 'lateral_root'
  | 'stem'
  | 'branch'
  /** Secondary, woody stem: the only tissue that carries bark. */
  | 'trunk'
  /** Underground horizontal stem that can raise new shoots (clonal growth). */
  | 'rhizome'
  /** Hollow, segmented shoot (bamboo-like): light, quick, water-holding. */
  | 'culm'
  /** Buoyant leaf that floats on the surface instead of standing in air. */
  | 'floating_leaf'
  /** Aerial breathing root lifted out of waterlogged soil (mangrove-like). */
  | 'pneumatophore'
  /** Hardened defensive shoot: short, rigid, silica-tipped. */
  | 'thorn'
  /** Above-ground horizontal runner with long internodes that roots at nodes. */
  | 'stolon'
  /** Swollen storage stem at the end of a rhizome (starch and water reserve). */
  | 'tuber'
  | 'vine'
  | 'leaf'
  | 'cotyledon'
  | 'flower'
  | 'spore_sac';

export type Layer = 'root' | 'canopy';

export type GrowthDirectionBias = 'downward' | 'upward' | 'outward' | 'horizontal';

/** Gene-owned direction limits for one node type. */
export interface GrowthGeneConstraints {
  maxReach: number;
  minY: number;
  maxY: number;
  minHorizontal: number;
  maxHorizontal: number;
  downwardPreferred?: boolean;
  upwardPreferred?: boolean;
}

export interface NodeStatModifiers {
  structural_integrity?: number;
  photosynthesis?: number;
  light_blocking?: number;
  reproduction?: number;
  pollinator_attraction?: number;
  spore_production?: number;
  climbing?: number;
  horizontal_spread?: number;
  /** Air tissue: how much oxygen the part can move into the root system. */
  aeration?: number;
  /** Hard tissue: how much browsing and abrasion the part resists. */
  defense?: number;
  [key: string]: number | undefined;
}

export interface NodeTypeDefinition {
  biomass_cost: number;
  resource_draw_water: number;
  resource_draw_nutrients: number;
  resource_draw_minerals: number;
  upkeep_biomass_per_second: number;
  stat_modifiers: NodeStatModifiers;
  growth_direction_bias: GrowthDirectionBias;
  growth_time_seconds: number;
  // Distance one growth action moves this node away from its parent. Without a
  // per-type value every node uses the layer's growth speed as a length, which
  // made a cotyledon a 95 cm pole next to a 16 cm seed.
  segment_length?: number;
  // Minerals are used for structural components: cell walls (cellulose/lignin),
  // enzyme cofactors, structural proteins. Higher for woody nodes (stem, branch, root).
}

export interface GrowthConfig {
  rootGrowthSpeed: number;
  canopyGrowthSpeed: number;
  nodeCostBase: number;
  maxNodesPerPlant: number;
  growthCooldown: number;
  lightBlockingPerNode: number;
  seedNode: NodeTypeDefinition;
  radicleNode: NodeTypeDefinition;
  rootNode: NodeTypeDefinition;
  lateralRootNode: NodeTypeDefinition;
  stemNode: NodeTypeDefinition;
  branchNode: NodeTypeDefinition;
  leafNode: NodeTypeDefinition;
  cotyledonNode: NodeTypeDefinition;
  flowerNode: NodeTypeDefinition;
  sporeSacNode: NodeTypeDefinition;
  vineNode: NodeTypeDefinition;
  trunkNode: NodeTypeDefinition;
  rhizomeNode: NodeTypeDefinition;
  culmNode: NodeTypeDefinition;
  floatingLeafNode: NodeTypeDefinition;
  /** Aerial breathing root; optional so configs that predate it still boot. */
  pneumatophoreNode?: NodeTypeDefinition;
  /** Defensive hardened shoot; optional so configs that predate it still boot. */
  thornNode?: NodeTypeDefinition;
  /** Above-ground runner; optional so configs that predate it still boot. */
  stolonNode?: NodeTypeDefinition;
  /** Swollen storage stem; optional so configs that predate it still boot. */
  tuberNode?: NodeTypeDefinition;
  /** Lowest plant health (0..1) at which growth may proceed. */
  growthMinHealth?: number;
  /** Share of photosynthesis kept at zero health. */
  healthPhotosynthesisFloor?: number;
  /** Groundwater (0..100) a floating pad needs under the point it occupies. */
  floatingLeafMinGroundwater?: number;
  /** Biomass a part regrows per second while the plant is unstressed. */
  tissueRepairPerSecond?: number;
  /** Energy spent per unit of biomass regrown. */
  tissueRepairEnergyPerBiomass?: number;
  /**
   * Longest a new segment may be relative to the part it grows out of.
   * Optional so configs and fixtures that predate it keep working; absent means
   * the type's own segment length is used unclamped.
   */
  maxChildLengthRatio?: number;
  growthIntentCooldown: number;
  germinationMinMoisture: number;
  germinationMinLight: number;
  germinationFailureKillsSeed: boolean;
  /** Cotyledons a seed crown may produce before it offers a stem (growth menu). */
  maxCotyledons: number;
  /** True leaves a plant needs before its cotyledons are shed. */
  cotyledonShedLeafCount: number;
  /** Growth time used when a node definition omits `growth_time_seconds`. */
  defaultGrowthTimeSeconds: number;
  photosynthesisEnergyPerSecond: number;
  energyUpkeepPerBiomass: number;
  /** @deprecated Storage is now derived from the plant; see energyCapacityPerBiomass. */

  // Storage capacity scales with the plant itself (RULE_3).
  energyCapacityPerBiomass: number;
  energyCapacityFloor: number;
  waterCapacityPerRootBiomass: number;
  waterCapacityFloor: number;
  mineralCapacityPerRootBiomass: number;
  mineralCapacityFloor: number;
  initialEnergyFraction: number;
  // Resource consumption during growth (per second of growth time)
  growthWaterConsumptionRate: number;
  growthNutrientConsumptionRate: number;
  growthMineralConsumptionRate: number;
  /**
   * Share of a part's configured carbon budget that ends up as structural
   * biomass. The rest is respired as construction cost, so a grown part never
   * stores more mass than the energy and materials spent building it. Optional
   * so configs written before this key keep the old 1:1 behaviour.
   */
  growthBiomassYield?: number;
  /** Water respired per unit of standing biomass per second. */
  upkeepWaterPerBiomass?: number;
  /** Minerals respired per unit of standing biomass per second. */
  upkeepMineralPerBiomass?: number;
  /** Biomass lost per unit of unmet water upkeep (drought wilting). */
  waterDeficitBiomassLoss?: number;
  /** Biomass lost per unit of unmet mineral upkeep. */
  mineralDeficitBiomassLoss?: number;
  /** Seconds an under-quota stem waits before unhealed damage starts thinning it. */
  stemDamageWitherDelayS?: number;
  /** Fraction of its quota an unhealed stem loses per second after that delay. */
  stemDamageWitherPerS?: number;
  // Minimum resource levels required for growth to proceed
  growthMinWater: number;
  growthMinNutrients: number;
  growthMinMinerals: number;
  germinationGate?: boolean;
}

export interface PlantNode {
  id: string;
  plantId: string;
  type: NodeType;
  layer: Layer;
  x: number;
  y: number;
  z: number;
  biomass: number;
  age: number;
  parentId: string | null;
  children: string[];
  statModifiers: NodeStatModifiers;
  resourceDrawWater: number;
  resourceDrawNutrients: number;
  resourceDrawMinerals: number;
  upkeepBiomassPerSecond: number;
  growthDirectionBias: GrowthDirectionBias;
  lastGrowthTick: number;
  growthProgress: number;
  // Growth over time fields
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  /** Where this segment started growing; position = start + (target - start) * progress. */
  growthStartX?: number;
  growthStartY?: number;
  growthStartZ?: number;
  growthTimeRemaining?: number;
  growthWaterConsumed?: number;
  growthNutrientsConsumed?: number;
  growthMineralsConsumed?: number;
  isSeed: boolean;
  // Server-authoritative growth timing for client sync
  growthTimeSeconds?: number;
  growthStartTick?: number;
  /**
   * Mass this part's growth was quoted at, stamped on its first growth tick.
   * Frozen for the life of the growth so a mutation gained mid-flight cannot
   * re-price a part the player is already paying for.
   */
  growthTargetMass?: number;
  // Server-authoritative radius (Murray's law) for client sync
  radius?: number;
  // Parent attachment position for client sync
  parentAttachX?: number;
  parentAttachY?: number;
  parentAttachZ?: number;
  /**
   * Where along the parent's own segment this node leaves it. Absent or 1 means
   * the parent's endpoint; a lateral root or branch leaves part-way along.
   */
  attachFraction?: number;
  /** T04: visual signature index this node draws (0 = none). Transient. */
  mutationFlags?: number;
  /**
   * T04: the widest linear scale this part was built under. It widens the
   * profile's radius ceiling so a size mutation can actually draw a thicker
   * part. It only ever grows, so shedding a mutation never snaps the body at
   * the moment of the shed.
   */
  massScale?: number;
  /** Seconds this stem has been under its tissue quota without repair. Transient. */
  damageStressSeconds?: number;
}

/** One mutation a living plant carries (T04). */
export interface PlantMutation {
  id: string;
  acquiredTick: number;
  /** Node the change is expressed through, when one node owns it. */
  nodeId: string | null;
  /** 1-based level. Absent means level 1, which is how old saves load. */
  level?: number;
  /**
   * Card ids chosen at each level above 1, in order: `cards[N - 2]` is the card
   * taken to reach level `N`. Effects compound from these, so a level is
   * whatever the player picked on the way up.
   */
  cards?: string[];
}

export interface Plant {
  id: string;
  ownerId: string;
  worldId: string;
  nodes: Map<string, PlantNode>;
  rootNodeId: string | null;
  totalBiomass: number;
  totalEnergy: number;
  totalUpkeep: number;
  // Internal resource storage - filled by root absorption, consumed by growth
  storedWater: number;
  storedMinerals: number;
  lastGrowthTick: number;
  growthCooldownUntil: number;
  tier?: 'active' | 'near' | 'dormant';
  lastTick?: number;
  maxNodesPerPlant?: number;
  // Growth sequence number for client mirror gap detection
  growthSeq: number;
  /** T04: mutations this plant has acquired. Additive; absent on old saves. */
  mutations?: PlantMutation[];
  /** T04: recent investment per growth category, for adaptive pressure. */
  mutationPressure?: Record<string, number>;
  /** T04: tick until which shedding is refused. */
  mutationShedCooldownUntil?: number;
  /** T04: strongest visual signature held (0 = none), sent to renderers. */
  mutationSignature?: number;
  /**
   * T06: uproot/damage state. Absent means rooted and undamaged, which is what
   * every pre-T06 save and every fresh seed is.
   */
  uproot?: PlantUprootState;
}

/**
 * T06 uproot bookkeeping kept on the plant itself.
 *
 * `basePose` is the rigid pose captured when the plant came up. The visible node
 * positions are recomputed from it on every transform change, so a long tumble
 * cannot accumulate rounding drift and a reroot can put the body back upright.
 * It is deliberately not part of the save format: a restored plant adopts its
 * saved positions as the new pose.
 */
export interface PlantUprootState {
  phase: UprootPhase;
  cause: UprootCause | null;
  sinceTick: number;
  /** Unhealed structural damage in biomass points, decaying every tick. */
  damageHp: number;
  /** Continuous seconds the root tile has been saturated. */
  saturatedSeconds: number;
  /** Continuous seconds the root has been on valid soil while rerooting. */
  settledSeconds: number;
  tiltRad: number;
  headingRad: number;
  rollRad: number;
  rollSpeedRad: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  /** Direction the player is crawling, in world XZ; zero when idle. */
  crawlX: number;
  crawlZ: number;
  /** Tumble time, so a body settles even if it keeps drifting. */
  tumbleSeconds: number;
  /** True once the body has come to rest; it must not re-enter tumbling. */
  tumbleSettled: boolean;
  basePose: Map<string, { x: number; y: number; z: number }>;
  /**
   * Each node's attachment point on its parent, captured with `basePose`.
   *
   * A joint is a second point on the same rigid body. Moving `basePose` alone
   * left every lateral root hanging at the spot its parent had occupied before
   * the crawl, so an uprooted plant came apart at the joints even though each
   * node's own position was correct.
   */
  baseAttach: Map<string, { x: number; y: number; z: number }>;
}

export type GrowthMode = 'apical' | 'lateral';

export interface GrowthIntent {
  plantId: string;
  nodeId: string;
  direction: { x: number; y: number; z: number };
  nodeType: NodeType;
  tick: number;
  growthMode?: GrowthMode;
  /** Optional override of where the new part leaves its parent (0.05..1). */
  attachFraction?: number;
}

export interface GrowthResult {
  success: boolean;
  newNode?: PlantNode;
  newNodes?: PlantNode[];
  updatedParentNode?: PlantNode;
  reason?: string;
  plantDied?: boolean;
}

export interface GrowthConditions {
  // Tile-based (for germination)
  light: number;
  moisture: number;
  minLight: number;
  minMoisture: number;
  // Plant storage-based (for growth)
  storedWater?: number;
  storedMinerals?: number;
  growthMinWater?: number;
  growthMinMinerals?: number;
  ok: boolean;
  // For germination: check tile light/moisture; for growth: check stored water/minerals
  growthOk?: boolean;
}

export interface GrowthOption {
  type: NodeType;
  label: string;
  energyCost: number;
  biomassGain: number;
  expectedSeconds: number;
  available: boolean;
  reason?: string;
  risk?: string;
  // Resource costs for growth over time
  waterCost?: number;
  nutrientCost?: number;
  mineralCost?: number;
}

export interface GrowthOptionsResult {
  nodeId: string;
  nodeType: NodeType;
  isSeed: boolean;
  energy: number;
  biomass: number;
  options: GrowthOption[];
  conditions?: GrowthConditions;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** A part as the attachment rule sees it: stored position, identity and drawn size. */
export interface AttachmentPart extends Vec3Like {
  type?: string;
  nodeType?: string;
  radius?: number;
  biomass?: number;
  /**
   * Start of this part's own segment (its parent attachment point), so a child
   * can attach part-way along the segment instead of only at its end.
   */
  segmentStart?: Vec3Like;
}

/** Drawn size of one node type, as a function of biomass. */
export interface NodeRadiusProfile {
  readonly nominalBiomass: number;
  readonly radius: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Organism geometry that is owned by config but read by every process.
 *
 * These numbers are not server rules and not renderer settings: they describe
 * the drawn organism, so a server that placed nodes with one seed aspect and a
 * client that drew them with another would silently disagree.
 */
export interface GrowthGeometryTunables {
  seedBodyHeightRatio?: number;
  nodeRadiusProfiles?: Record<string, NodeRadiusProfile>;
  branchAttachFraction?: number;
  /** Belly width at a junction, as a multiple of the child's own shank radius. */
  jointFlareRatio?: number;
  /** How fast a segment necks from its junction belly down to its shank. */
  segmentTaperExponent?: number;
  /** Where a child's tube starts, as a fraction of the parent's radius. */
  socketInsetRatio?: number;
}

/** Where a growth step starts and ends: the parent's surface and the child's spot. */
export interface SegmentPlacement {
  start: Vec3Like;
  end: Vec3Like;
}
