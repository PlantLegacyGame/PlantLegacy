import type { Plant } from '@plant-legacy/shared/growth';
import { nodeWireFields, type WelcomePayload } from '../ops/net.ts';

export interface WelcomeSource {
  playerId: string;
  plant: Plant;
  /**
   * Fresh reclaim secret for this plant. The caller rotates it, because
   * rotation is state (the plant's previous token must stop working).
   */
  reconnectToken: string;
  tick: number;
  /** Health of one of `plant`'s nodes, where the caller knows it. */
  nodeHealth: (nodeId: string) => number | undefined;
}

/**
 * The WELCOME body for a player who now holds `plant`.
 *
 * It lives here because three attach paths (join, account reclaim, anonymous
 * reclaim) each carried their own copy of this object, and copies drift: a
 * field added to one is silently missing from the others, and a client adopts
 * the plant WELCOME describes, so a short payload reads as a plant with no
 * nodes. The token and the tick are passed in rather than generated here, so
 * this stays a pure mapping of plant state to wire shape.
 */
export function buildWelcomePayload(source: WelcomeSource): WelcomePayload {
  const { plant } = source;
  const rootNodeId = plant.rootNodeId;
  const rootNode = rootNodeId != null ? plant.nodes.get(rootNodeId) : undefined;
  return {
    playerId: source.playerId,
    plantId: plant.id,
    reconnectToken: source.reconnectToken,
    tick: source.tick,
    rootNode: rootNode
      ? {
          id: rootNode.id,
          x: rootNode.x,
          y: rootNode.y,
          z: rootNode.z,
          type: 'root',
          biomass: rootNode.biomass,
        }
      : { id: rootNodeId ?? '', x: 0, y: 0, z: 0, type: 'root', biomass: 0 },
    totalBiomass: plant.totalBiomass,
    totalEnergy: plant.totalEnergy,
    nodes: Array.from(plant.nodes.values()).map((node) =>
      nodeWireFields(node, source.nodeHealth(node.id)),
    ),
  };
}
