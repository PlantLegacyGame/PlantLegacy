/**
 * Where the player's plant actually is, right now.
 *
 * The camera recentre (Space) and Root Sight both have to point at the player's
 * body, and both used to take *the first parentless node in the mirror*. That
 * is only correct while the mirror holds exactly one plant and nothing stale:
 * during an uproot the body is streamed node by node, a saved plant can arrive
 * with more than one parentless node, and a reconnect can leave a node from the
 * previous session behind. Any of those put the camera and the cavity at a spot
 * the plant had already left.
 *
 * The server already says which node is the root crown (`rootNodeId`), and it
 * repeats the crown's position in every uproot message. So resolve the anchor
 * in that order: the named crown, then a seed, then any parentless node, then
 * the last position the server streamed. No map iteration order, no staleness.
 */

import { nodeBelongsToPlant } from '@plant-legacy/shared/growth';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface AnchorNode {
  id: string;
  position: Vec3Like;
  parentId: string | null;
  isSeed?: boolean;
  nodeType?: string;
}

/** A node from the own-plant mirror that can stand for the body. */
function isCrownCandidate(node: AnchorNode): boolean {
  return node.parentId === null;
}

/**
 * The player's body anchor, or null when there is nothing to point at.
 *
 * `rootNodeId` is the server's own answer and wins outright. Everything after
 * it is a fallback for payloads that predate the field or for the frames before
 * the first sync arrives.
 */
export function resolveOwnAnchor(
  nodes: ReadonlyMap<string, AnchorNode> | null | undefined,
  rootNodeId: string | null | undefined,
  lastServerAnchor?: Vec3Like | null,
): Vec3Like | null {
  if (nodes) {
    if (rootNodeId) {
      const crown = nodes.get(rootNodeId);
      if (crown) return crown.position;
    }
    let parentless: AnchorNode | null = null;
    for (const node of nodes.values()) {
      if (!isCrownCandidate(node)) continue;
      // A seed is the planted crown; prefer it over any other orphan.
      if (!parentless) parentless = node;
      else if (isSeedNode(node) && !isSeedNode(parentless)) parentless = node;
    }
    if (parentless) return parentless.position;
  }
  return lastServerAnchor ?? null;
}

function isSeedNode(node: AnchorNode): boolean {
  return node.isSeed === true || node.nodeType === 'seed';
}

/**
 * Keep only the nodes that can belong to the current body.
 *
 * A recentre frames the whole plant, so one stale node left over from an
 * earlier plant would stretch the bounds back to where that plant stood. The
 * node ids carry their plant tag, so the mirror can be filtered without any
 * extra bookkeeping.
 */
export function ownBodyNodes<T extends { id: string }>(
  nodes: Iterable<T>,
  plantId: string | null | undefined,
): T[] {
  if (!plantId) return [...nodes];
  // One reader for "is this node mine": the same rule that mints the ids.
  const kept: T[] = [];
  for (const node of nodes) {
    if (nodeBelongsToPlant(node.id, plantId)) kept.push(node);
  }
  // An unreadable id (a synthetic test node) must not empty the plant.
  return kept.length > 0 ? kept : [...nodes];
}
