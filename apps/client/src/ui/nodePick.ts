/**
 * Which node a click on the plant belongs to.
 *
 * The pick spheres are sized from each node's radius, and a parent is almost
 * always larger than its child, so a child growing out of a stem sits *inside*
 * the parent's sphere. Taking `intersects[0]` then picked whichever sphere the
 * ray entered first - usually the parent - and the growth panel belonged to the
 * wrong part. A small child on a thick parent was effectively unclickable.
 *
 * Fixed rule: the nearest hit wins, but hits within a small tie window are
 * compared by depth in the plant, and the deeper node (the child) wins. The
 * window is what "the same place" means: two spheres the ray grazes at the same
 * distance are the same point on screen, and the specific part is the better
 * answer.
 */

export interface NodeHitCandidate {
  nodeId: string;
  /** Parent of this node, or null for the seed. */
  parentId: string | null;
  /** Ray distance to the hit, metres. */
  distance: number;
}

export interface NodePickResult {
  nodeId: string | null;
  /** True when the winner was chosen by depth inside the tie window. */
  tieBroken: boolean;
}

function depthOf(nodeId: string, byId: Map<string, NodeHitCandidate>): number {
  let depth = 0;
  let current = byId.get(nodeId)?.parentId ?? null;
  // Bounded so a malformed cycle cannot hang the click handler.
  while (current && depth < 256) {
    depth += 1;
    current = byId.get(current)?.parentId ?? null;
  }
  return depth;
}

export function pickNodeHit(
  candidates: ReadonlyArray<NodeHitCandidate>,
  tieWindowM = 0.02,
): NodePickResult {
  if (candidates.length === 0) return { nodeId: null, tieBroken: false };
  const byId = new Map(candidates.map((candidate) => [candidate.nodeId, candidate]));

  let nearest = candidates[0];
  for (const candidate of candidates) {
    if (candidate.distance < nearest.distance) nearest = candidate;
  }

  const window = Number.isFinite(tieWindowM) ? Math.max(0, tieWindowM) : 0;
  let winner = nearest;
  let winnerDepth = depthOf(nearest.nodeId, byId);
  for (const candidate of candidates) {
    if (candidate === nearest) continue;
    if (candidate.distance > nearest.distance + window) continue;
    const depth = depthOf(candidate.nodeId, byId);
    if (depth > winnerDepth) {
      winner = candidate;
      winnerDepth = depth;
    }
  }

  return { nodeId: winner.nodeId, tieBroken: winner !== nearest };
}
