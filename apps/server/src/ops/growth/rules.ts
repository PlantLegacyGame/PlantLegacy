/**
 * Pure growth rules used by PlantWorld and by the growth-options builder.
 *
 * Nothing here touches world state: every function is a decision about the
 * config and the plant it is handed. That keeps the rules testable and keeps
 * `plantWorld.ts` about storage, ticking and broadcasting.
 */
import type {
  AttachmentPart,
  GrowthConfig,
  NodeType,
  NodeTypeDefinition,
  Plant,
  PlantNode,
} from '@plant-legacy/shared/growth';
import {
  getNodeTypeDefinition,
  NODE_GROWTH_CONSTRAINTS,
  nodeRenderRadius,
  plantHealth,
} from '@plant-legacy/shared/growth';

export interface GrowthCostQuote {
  energyCost: number;
  biomassGain: number;
  growthTimeSeconds: number;
  waterCost: number;
  mineralCost: number;
  nutrientCost: number;
}

/**
 * What the world adds to a quote before charging it.
 *
 * A quote is not the charge: roots open compact, deep soil (`growth_resistance`)
 * and a mutation can make every part cost more energy or grow slower. The menu
 * used to quote the bare `computeGrowthCostQuote` figure, so a root card said
 * "6 energy", the server charged 11, and growth was refused for energy the card
 * had promised was enough. Both sides now read this one scale.
 */
export interface GrowthChargeScale {
  /** Soil the part grows out of, clamped by `growth_resistance_min/max`. */
  resistance: number;
  /** Multiplier on the quoted energy: resistance × mutation growth cost. */
  energyMultiplier: number;
  /** Multiplier on the quoted seconds: resistance ÷ mutation growth speed. */
  timeMultiplier: number;
}

export const NEUTRAL_GROWTH_SCALE: GrowthChargeScale = {
  resistance: 1,
  energyMultiplier: 1,
  timeMultiplier: 1,
};

/**
 * Apply a charge scale to a quote, rounding energy up.
 *
 * Rounding up means the card can only ever be pessimistic: it may ask for one
 * more energy than the charge needs, never promise a price the charge beats.
 */
export function scaleGrowthQuote(
  quote: GrowthCostQuote,
  scale: GrowthChargeScale,
): GrowthCostQuote {
  const energyMultiplier =
    Number.isFinite(scale.energyMultiplier) && scale.energyMultiplier > 0
      ? scale.energyMultiplier
      : 1;
  const timeMultiplier =
    Number.isFinite(scale.timeMultiplier) && scale.timeMultiplier > 0 ? scale.timeMultiplier : 1;
  const growthTimeSeconds = Math.max(0.1, quote.growthTimeSeconds * timeMultiplier);
  const timeRatio = quote.growthTimeSeconds > 0 ? growthTimeSeconds / quote.growthTimeSeconds : 1;
  return {
    energyCost:
      energyMultiplier === 1 ? quote.energyCost : Math.ceil(quote.energyCost * energyMultiplier),
    biomassGain: quote.biomassGain,
    growthTimeSeconds,
    waterCost: quote.waterCost * timeRatio,
    nutrientCost: quote.nutrientCost * timeRatio,
    mineralCost: quote.mineralCost * timeRatio,
  };
}

/**
 * Single source of truth for growth energy and resource costs (INV-GR-13).
 * Ensures getGrowthOptions quotes exactly what tryGrow and step charge.
 */
export function computeGrowthCostQuote(
  config: GrowthConfig,
  nodeDef: NodeTypeDefinition,
  /**
   * How much tissue the part ends up holding per unit of build cost. A size
   * mutation raises it (`scale³`), so the same growth is materially bigger: the
   * quote has to carry that or the menu promises a mass the part never has.
   */
  massScale = 1,
): GrowthCostQuote {
  // Energy is what the plant spends; biomass is what it keeps. Building tissue
  // respires part of the fixed carbon, so the stored mass is a share of the
  // carbon budget rather than the whole of it (the rest leaves as CO2 and heat).
  // Without this a part cost 8 energy and added 8 biomass, so mass tracked the
  // energy spent 1:1 and a seedling's biomass leapt for parts far smaller than
  // the number claimed. `growth_biomass_yield` keeps the two consistent.
  const yieldFraction = config.growthBiomassYield ?? 1;
  const energyCost = Math.ceil(nodeDef.biomass_cost);
  const safeScale = Number.isFinite(massScale) && massScale > 0 ? massScale : 1;
  const biomassGain = roundMass(nodeDef.biomass_cost * yieldFraction * safeScale ** 3);
  const growthTimeSeconds = nodeDef.growth_time_seconds ?? config.defaultGrowthTimeSeconds;
  const waterCost = growthTimeSeconds * config.growthWaterConsumptionRate * nodeDef.biomass_cost;
  const mineralCost =
    growthTimeSeconds * config.growthMineralConsumptionRate * nodeDef.biomass_cost;
  const nutrientCost =
    growthTimeSeconds * config.growthNutrientConsumptionRate * nodeDef.biomass_cost;
  return {
    energyCost,
    biomassGain,
    growthTimeSeconds,
    waterCost,
    mineralCost,
    nutrientCost,
  };
}

/** Structural mass is quoted and accrued to hundredths, never raw floats. */
export function roundMass(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value) * 100) / 100;
}

/** Speed budget for the layer a node type grows in. */
export function getGrowthSpeed(config: GrowthConfig, layer: 'root' | 'canopy'): number {
  return layer === 'root' ? config.rootGrowthSpeed : config.canopyGrowthSpeed;
}

export function normalizeDirection(dir: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (len === 0) return { x: 0, y: -1, z: 0 };
  return { x: dir.x / len, y: dir.y / len, z: dir.z / len };
}

/**
 * A node as the attachment rule sees it: drawn position and size, plus the start
 * of its own segment so a lateral branch can leave part-way along it.
 */
export function attachmentPart(node: PlantNode): AttachmentPart {
  const segmentStart =
    node.parentAttachX !== undefined &&
    node.parentAttachY !== undefined &&
    node.parentAttachZ !== undefined
      ? { x: node.parentAttachX, y: node.parentAttachY, z: node.parentAttachZ }
      : undefined;
  return {
    x: node.x,
    y: node.y,
    z: node.z,
    nodeType: node.type,
    radius: node.radius,
    biomass: node.biomass,
    segmentStart,
  };
}

export function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Assign every node its drawn radius, in metres.
 *
 * `nodeRenderRadius` in packages/shared/growth is the one source of truth for
 * part thickness. The old Murray vessel formula here (cbrt(biomass) * 0.5,
 * roots * 1.5) described a pipe in metres and produced 0.9-1.9 m radii for
 * gram-scale nodes - 50-92x the drawn size - so every client had to invent its
 * own clamp. Storing the drawn radius means the server, WebGPU mesh pass, SDF
 * renderer and Plant Lab all read the same number.
 */
export function computeNodeRadii(plant: Plant): void {
  for (const node of plant.nodes.values()) {
    node.radius = nodeRenderRadius(node.type, node.biomass);
  }
}

/**
 * Deterministic node names: `<plant tag>:<parent path>.<type><sibling index>`.
 *
 * The old ids came from a process-wide counter (`n_1`, `n_2`, ...), so every
 * restart handed out the same names again and a client that kept an old plant
 * in memory merged the two into one impossible specimen: parts of the previous
 * plant hanging in the air, attached to nothing. A name built from the tree
 * cannot do that - it is a pure function of where the node sits, so each plant's
 * names are unique and stable across rebuilds.
 *
 * `taken` is checked rather than assumed: a shed cotyledon frees its sibling
 * slot, and a later growth into that slot must never reuse the name.
 */
export function nodeName(
  plantId: string,
  parent: PlantNode | null,
  type: string,
  taken: (id: string) => boolean,
): string {
  const tag = plantId.replace(/^p_/, '').slice(0, 8);
  const base = parent
    ? `${tag}:${parent.id
        .slice(tag.length + 1)
        .split('.')
        .slice(-2)
        .join('.')}.${type}${parent.children.length}`
    : `${tag}:seed`;
  let name = base;
  let suffix = 1;
  while (taken(name)) {
    name = `${base}~${suffix}`;
    suffix += 1;
  }
  return name;
}

/**
 * How many cotyledons this plant's crown may produce.
 *
 * T15 (genes, still a stub - `docs/tunables.md` lists `genes` as unimplemented)
 * makes this a per-seed trait: a seed will carry its own limit and this
 * function will read it from that seed's genome. Until genes exist, the seed
 * says nothing, so the configured base is the answer for every plant - and it
 * is the only answer: the growth menu, `tryGrow` and the seed-crown state all
 * read it here so they cannot disagree.
 */
export function maxCotyledonsForPlant(config: GrowthConfig): number {
  return config.maxCotyledons;
}

/**
 * Whether the plant's internal storage allows another growth step.
 *
 * `storedResourceSharing` is the share of the requirement a clonal network
 * covers for a part grown from root tissue (T04: `clonal_rhizome`,
 * `clonal_network`). The rhizome network subsidises the new ramet, so a shoot
 * can be raised from reserves the parent never held in its own right.
 */
export function canGrow(
  plant: Plant,
  config: GrowthConfig,
  storedResourceSharing = 0,
): { ok: boolean; reason?: string } {
  // T04 health: a wilting plant may not extend until it has rebuilt tissue.
  const health = plantHealth(plant, config);
  const minHealth = config.growthMinHealth ?? 0;
  if (health < minHealth) {
    return {
      ok: false,
      reason: `Plant health ${(health * 100).toFixed(0)}% (needs ${(minHealth * 100).toFixed(0)}%)`,
    };
  }
  const sharing = Math.min(0.9, Math.max(0, storedResourceSharing));
  const waterNeed = config.growthMinWater * (1 - sharing);
  const mineralNeed = config.growthMinMinerals * (1 - sharing);
  const nutrientNeed = config.growthMinNutrients * (1 - sharing);
  // Check plant's internal resource storage for growth requirements
  if (plant.storedWater < waterNeed) {
    return {
      ok: false,
      reason: `Insufficient stored water (${plant.storedWater.toFixed(1)} < ${waterNeed.toFixed(1)})`,
    };
  }
  if (plant.storedMinerals < nutrientNeed) {
    return {
      ok: false,
      reason: `Insufficient stored minerals (${plant.storedMinerals.toFixed(1)} < ${nutrientNeed.toFixed(1)})`,
    };
  }
  // Minerals are used for both nutrients and structural minerals
  if (plant.storedMinerals < mineralNeed) {
    return {
      ok: false,
      reason: `Insufficient stored minerals (${plant.storedMinerals.toFixed(1)} < ${mineralNeed.toFixed(1)})`,
    };
  }
  return { ok: true };
}

/**
 * Explains the germination gate with the numbers being compared, so the panel
 * says what to fix instead of only that something is wrong.
 */
export function germinationGateReason(
  light: number,
  moisture: number,
  config: GrowthConfig,
): string {
  const missing: string[] = [];
  if (moisture < config.germinationMinMoisture) {
    missing.push(`tile moisture ${moisture.toFixed(1)} (needs ${config.germinationMinMoisture})`);
  }
  if (light < config.germinationMinLight) {
    missing.push(`tile light ${light.toFixed(1)} (needs ${config.germinationMinLight})`);
  }
  if (missing.length === 0) return 'Germination conditions not met';
  return `Cannot germinate yet: ${missing.join(', ')}`;
}

/**
 * Validates that the growth direction is realistic for the given node type.
 * Returns { ok: true } if valid, or { ok: false, reason } if invalid.
 * Uses NODE_GROWTH_CONSTRAINTS for authoritative bounds.
 */
export function validateGrowthDirection(
  _parentNode: PlantNode,
  targetType: NodeType,
  dir: { x: number; y: number; z: number },
  config: GrowthConfig,
): { ok: boolean; reason?: string } {
  // Get the node definition for growth bias
  const targetDef = getNodeTypeDefinition(config, targetType);
  const growthBias = targetDef.growth_direction_bias;

  // Get authoritative constraints from shared config
  const constraints = NODE_GROWTH_CONSTRAINTS[targetType] ?? NODE_GROWTH_CONSTRAINTS.stem;

  // Calculate horizontal distance
  const horizontalDist = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
  // The clamp and these bounds describe the same sector, but the table is not
  // always exactly feasible at a corner: `minY` -0.25 for a radicle implies a
  // horizontal of 0.96824 against a declared 0.968 maximum. A legal clamped
  // vector must never be refused for that 2e-4 of rounding.
  const BOUND_TOLERANCE = 1e-3;

  // Validate Y bounds from constraints (authoritative). The same rounding
  // tolerance the horizontal bounds already use applies here: `clampGrowthDirectionByGene`
  // lands exactly on a sector bound, and the resulting 0.6500000000000001 was
  // refused as "outside [-0.4, 0.65]" - which is why a whole gallery of plants
  // had a stem and no branches.
  if (dir.y < constraints.minY - BOUND_TOLERANCE || dir.y > constraints.maxY + BOUND_TOLERANCE) {
    return {
      ok: false,
      reason: `Direction Y (${dir.y.toFixed(2)}) outside allowed range [${constraints.minY}, ${constraints.maxY}] for ${targetType}`,
    };
  }

  // Validate horizontal bounds from constraints
  if (
    horizontalDist < constraints.minHorizontal - BOUND_TOLERANCE ||
    horizontalDist > constraints.maxHorizontal + BOUND_TOLERANCE
  ) {
    return {
      ok: false,
      reason: `Horizontal distance (${horizontalDist.toFixed(2)}) outside allowed range [${constraints.minHorizontal}, ${constraints.maxHorizontal}] for ${targetType}`,
    };
  }

  // Check if direction aligns with growth bias (lenient).
  let biasAlignment = 0;
  switch (growthBias) {
    case 'downward':
      biasAlignment = -dir.y; // positive when growing down
      break;
    case 'upward':
      biasAlignment = dir.y; // positive when growing up
      break;
    case 'outward':
      biasAlignment = Math.sqrt(dir.x * dir.x + dir.z * dir.z); // horizontal distance
      break;
    case 'horizontal':
      biasAlignment = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
      break;
  }

  // Direction should align with bias (cosine similarity > 0.1 - very lenient)
  if (biasAlignment < 0.1) {
    return { ok: false, reason: `Direction does not match ${targetType} growth pattern` };
  }

  return { ok: true };
}
