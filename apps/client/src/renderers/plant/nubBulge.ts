/**
 * Nubs: the subtle swell at a node where the plant is primed to grow.
 *
 * A nub is not a bud, a marker or a badge. It is the same tissue as the part it
 * sits on, a little fuller: growth sites are *recommended* rather than required,
 * weighted by the plant's genes and its condition, and a primed node shows that
 * in its silhouette. Same material, same colour, no outline and no highlight -
 * the only thing that reads is the shape.
 *
 * The decision is deterministic. The node's own lineage id is the gene key, so a
 * nub stays where it grew for the whole life of the plant, and two plants grown
 * from different genomes do not share a pattern.
 */
import { hash01 } from '@plant-legacy/shared/math';
import type { PlantNodeData } from './plantNodeData.js';

/** Organs that carry nubs. A blade or a bloom is a terminus, not a growth site. */
const NUB_ORGANS = new Set([
  'stem',
  'branch',
  'trunk',
  'culm',
  'root',
  'lateral_root',
  'radicle',
  'rhizome',
]);

/** Share of nodes that are primed at all. Most sites are not recommended. */
export const NUB_PRIMED_SHARE = 0.55;
/** Smallest and largest swell, as a fraction of the drawn radius there. */
export const NUB_MIN_SWELL = 0.045;
export const NUB_MAX_SWELL = 0.105;

/** The parts of a node this rule reads, so it can be tested without a scene. */
export interface NubInput {
  id: string;
  nodeType?: string;
  biomass?: number;
  health?: number;
}

/** 0..1: how strongly this node's genes and condition prime it for growth. */
export function nubPriming(node: NubInput): number {
  const type = (node.nodeType ?? '').toLowerCase();
  if (!NUB_ORGANS.has(type)) return 0;
  const gene = hash01(node.id, 'nub-gene');
  const roll = hash01(node.id, 'nub-primed');
  if (roll > NUB_PRIMED_SHARE) return 0;
  const biomass = Number.isFinite(node.biomass) ? Math.max(0, node.biomass as number) : 1;
  const health = Number.isFinite(node.health) ? Math.min(1, Math.max(0, node.health as number)) : 1;
  // A well-fed, healthy plant commits tissue to more of its recommended sites; a
  // starving one does not swell buds it cannot fill.
  const vigour = Math.min(1, 0.35 + 0.65 * health) * Math.min(1, 0.45 + biomass * 0.55);
  return gene * vigour;
}

/**
 * Radius multiplier at a primed node, 1 when the node is not primed.
 *
 * Capped well under a real growth: the point is a fuller belly on the same tube,
 * not a ball stuck to it.
 */
export function nubSwell(node: NubInput): number {
  const priming = nubPriming(node);
  if (priming <= 0) return 1;
  return 1 + NUB_MIN_SWELL + (NUB_MAX_SWELL - NUB_MIN_SWELL) * priming;
}

/** Convenience for the mesh builders, which have the node in hand. */
export function nubSwellForNode(node: NubInput | PlantNodeData): number {
  return nubSwell(node);
}

/** What the dev probe reads back: how many nodes are primed and by how much. */
export interface NubReport {
  total: number;
  primed: number;
  minSwell: number;
  maxSwell: number;
  ids: string[];
}

/**
 * A count of the nubs a plant is carrying, for the dev probe.
 *
 * The swell is a few per cent of a tube's radius, so "is it there at all" cannot
 * be answered by looking; this answers it with numbers from the same rule the mesh
 * builders use.
 */
export function nubReport(nodes: Iterable<NubInput>): NubReport {
  let total = 0;
  let primed = 0;
  let minSwell = Infinity;
  let maxSwell = 1;
  const ids: string[] = [];
  for (const node of nodes) {
    total += 1;
    const swell = nubSwell(node);
    if (swell <= 1) continue;
    primed += 1;
    minSwell = Math.min(minSwell, swell);
    maxSwell = Math.max(maxSwell, swell);
    if (ids.length < 12) ids.push(node.id);
  }
  return {
    total,
    primed,
    minSwell: Number.isFinite(minSwell) ? minSwell : 1,
    maxSwell,
    ids,
  };
}
