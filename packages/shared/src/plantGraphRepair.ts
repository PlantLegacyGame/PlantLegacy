/**
 * Repair a plant graph before it is validated (INV-GR-02/04/05).
 *
 * The load boundary used to make a single decision: validate, and throw if the
 * graph disagrees with itself. Boot then skipped that plant and logged it, so a
 * recoverable defect — a `children` list that drifted from `parentId`, a node
 * carrying another plant's id — cost a player their plant.
 *
 * The repairs here are the ones that are *determined* by the data rather than
 * invented: `parentId` is the authority for structure, so `children` is derived
 * from it and never the other way round. Anything this cannot determine (a node
 * whose parent is gone, a graph with two roots) is dropped and counted, and
 * `validatePlantGraph` still runs afterwards to refuse whatever is left. Every
 * change is reported so the caller can log one line per loaded plant instead of
 * repairing in silence.
 */
import type { Plant, PlantNode } from './growth/index.js';

export interface PlantGraphRepair {
  /** Nodes whose `plantId` was rewritten to the owning plant. */
  plantIdFixed: number;
  /** `children` entries that named a node not in this plant. */
  danglingChildrenDropped: number;
  /** Nodes whose `children` list disagreed with `parentId` and was rebuilt. */
  childListsRebuilt: number;
  /** Nodes dropped because their parent does not exist (with their subtrees). */
  orphansDropped: number;
  /** `rootNodeId` was empty but a parentless node exists. */
  rootNodeAdopted: number;
}

export function isCleanRepair(repair: PlantGraphRepair): boolean {
  return (
    repair.plantIdFixed === 0 &&
    repair.danglingChildrenDropped === 0 &&
    repair.childListsRebuilt === 0 &&
    repair.orphansDropped === 0 &&
    repair.rootNodeAdopted === 0
  );
}

/** Total nodes removed; what a caller reports as "lost". */
export function droppedNodeCount(repair: PlantGraphRepair): number {
  return repair.orphansDropped;
}

/**
 * Mutate `plant` into a self-consistent graph where the data determines it.
 *
 * Idempotent: a clean plant comes back with every counter at zero and no writes.
 */
export function repairPlantGraph(plant: Plant): PlantGraphRepair {
  const repair: PlantGraphRepair = {
    plantIdFixed: 0,
    danglingChildrenDropped: 0,
    childListsRebuilt: 0,
    orphansDropped: 0,
    rootNodeAdopted: 0,
  };
  const nodes = plant.nodes;

  for (const node of nodes.values()) {
    if (node.plantId !== plant.id) {
      node.plantId = plant.id;
      repair.plantIdFixed += 1;
    }
  }

  // Drop nodes whose parent is missing, and everything beneath them: a node
  // hanging off nothing has no place to grow from, and keeping it would leave
  // the graph reachable-from-root check failing.
  const doomed = new Set<string>();
  const collectSubtree = (id: string): void => {
    if (doomed.has(id)) return;
    doomed.add(id);
    const node = nodes.get(id);
    if (!node) return;
    for (const childId of node.children) collectSubtree(childId);
  };
  for (const node of nodes.values()) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      collectSubtree(node.id);
    }
  }
  if (doomed.size > 0) {
    for (const id of doomed) nodes.delete(id);
    repair.orphansDropped += doomed.size;
  }

  // `parentId` is the authority: rebuild every child list from it.
  const derived = new Map<string, string[]>();
  for (const node of nodes.values()) {
    if (node.parentId === null) continue;
    const list = derived.get(node.parentId);
    if (list) list.push(node.id);
    else derived.set(node.parentId, [node.id]);
  }
  for (const node of nodes.values()) {
    const next = derived.get(node.id) ?? [];
    const same =
      node.children.length === next.length && node.children.every((id, i) => id === next[i]);
    if (same) continue;
    const kept = node.children.filter((id) => nodes.has(id));
    if (kept.length !== node.children.length) {
      repair.danglingChildrenDropped += node.children.length - kept.length;
    }
    node.children = next;
    repair.childListsRebuilt += 1;
  }

  // A plant with no recorded root but exactly one parentless node has an
  // unambiguous answer; two parentless nodes stay a validation error.
  if (!plant.rootNodeId) {
    const parentless: PlantNode[] = [];
    for (const node of nodes.values()) if (node.parentId === null) parentless.push(node);
    if (parentless.length === 1) {
      plant.rootNodeId = parentless[0].id;
      repair.rootNodeAdopted += 1;
    }
  }

  return repair;
}
