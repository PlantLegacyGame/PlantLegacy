import { getNodeTypeDefinition } from './nodeTypes.ts';
import type { GrowthConfig, Plant, PlantNode } from './types.ts';

/**
 * Tissue health, 0..1, derived rather than stored.
 *
 * A part is healthy when it still carries the mass its own tissue type is built
 * with. That mass is the configured build cost scaled by
 * `growth_biomass_yield`: a part never keeps the whole carbon budget it was
 * charged, so measuring against the raw cost marked every finished, untouched
 * plant as 40% damaged. Damage (drought and mineral shortage shed tissue) reads
 * below the quota and recovers as the mass is rebuilt.
 */

/** Mass a finished part of this type carries when nothing has eaten into it. */
export function tissueMassQuota(node: PlantNode, config: GrowthConfig): number {
  const cost = getNodeTypeDefinition(config, node.type).biomass_cost;
  const yieldFraction = Math.min(1, Math.max(0, config.growthBiomassYield ?? 1));
  return cost * yieldFraction;
}

/**
 * The mass a part's growth was quoted at.
 *
 * A part's target mass used to be re-quoted on every tick from the plant's
 * *current* mutation size scale. Growth takes seconds, and a mutation can be
 * acquired in those seconds (one rolls per growth), so a part could be re-priced
 * while it was half built: it accrued mass at the new rate and finished heavier
 * than the menu said it would, its drawn radius jumping with it. A quote is a
 * fact about the growth, not about the plant's form this tick.
 *
 * Stamped once, on the first tick of growth, and never updated. A mutation the
 * plant gains afterwards applies to the parts it grows next, which is what "this
 * makes future growth bigger" has to mean.
 */
export function growthTargetMass(node: PlantNode, quoted: number): number {
  if (node.growthTargetMass === undefined) {
    node.growthTargetMass = Number.isFinite(quoted) && quoted > 0 ? quoted : 0;
  }
  return node.growthTargetMass;
}

export function nodeHealth(node: PlantNode, config: GrowthConfig): number {
  const quota = tissueMassQuota(node, config);
  if (!(quota > 0)) return 1;
  // A part that is still filling in has not had the chance to lose mass.
  // Measuring it against a quota it has not reached yet read every fresh shoot
  // as damaged, which could refuse growth in the seconds after it appeared.
  if ((node.growthProgress ?? 1) < 1) return 1;
  return Math.min(1, Math.max(0, (node.biomass ?? 0) / quota));
}

/**
 * Plant health: the mass-weighted mean health of every part.
 *
 * Weighting by the tissue's own build cost keeps a seed leaf from counting as
 * much as a trunk. A plant with nothing but its seed reads 1: there is no
 * tissue to be damaged yet.
 */
export function plantHealth(plant: Plant, config: GrowthConfig): number {
  let weighted = 0;
  let weight = 0;
  for (const node of plant.nodes.values()) {
    if (node.isSeed) continue;
    const nodeWeight = Math.max(getNodeTypeDefinition(config, node.type).biomass_cost, 1e-6);
    weighted += nodeHealth(node, config) * nodeWeight;
    weight += nodeWeight;
  }
  return weight > 0 ? weighted / weight : 1;
}

/**
 * Share of photosynthesis an unhealthy plant still manages.
 *
 * A wilting plant does not stop fixing carbon, it fixes less: `floor` is the
 * share kept at zero health (config `health_photosynthesis_floor`).
 */
export function healthPhotosynthesisMultiplier(health: number, config: GrowthConfig): number {
  const floor = Math.min(1, Math.max(0, config.healthPhotosynthesisFloor ?? 0.5));
  const bounded = Math.min(1, Math.max(0, health));
  return floor + (1 - floor) * bounded;
}
