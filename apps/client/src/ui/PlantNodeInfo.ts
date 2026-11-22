/**
 * Names for the parts of a plant, and the facts a hover tip shows about one.
 *
 * A node id is a server counter (`leaf_37`), which means nothing to a player. The
 * game says "leaf", so a part is named the same way and numbered by when its
 * plant grew it: `Leaf #2` is the second leaf this plant ever made. The order is
 * the order the client learned the nodes, which for the player's own plant is the
 * order it grew them.
 *
 * Pure: no renderer, no DOM, so naming can be tested on a plain list.
 */

export interface PlantNodeRef {
  id: string;
  /** Server node type, e.g. `leaf`. Absent on legacy mirrors. */
  nodeType?: string;
  /** Legacy layer code: 0 root, 1 stem, 2 leaf. */
  type?: number;
  parentId: string | null;
  children?: string[];
}

/** Legacy `type` codes, used only when a node carries no `nodeType`. */
const LEGACY_PART: Record<number, string> = { 0: 'Root', 1: 'Stem', 2: 'Leaf' };

/** `lateral_root` -> `lateral root`, `stem` -> `Stem`. */
export function partLabel(nodeType: string): string {
  const words = nodeType.replace(/_/g, ' ').trim();
  if (words === '') return 'Part';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The part's name without a number, e.g. `Leaf`. */
export function nodePartName(node: PlantNodeRef | undefined): string {
  if (!node) return 'Part';
  const typed = (node.nodeType ?? '').trim();
  if (typed) return partLabel(typed);
  return LEGACY_PART[node.type ?? -1] ?? 'Part';
}

/**
 * Name every node of a plant: `Seed #1`, `Stem #1`, `Leaf #2`.
 *
 * Each part type counts on its own, so two leaves are `Leaf #1` and `Leaf #2`
 * even when a stem grew between them.
 */
export function labelPlantNodes(nodes: Iterable<PlantNodeRef>): Map<string, string> {
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const node of nodes) {
    const name = nodePartName(node);
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    labels.set(node.id, `${name} #${index}`);
  }
  return labels;
}

export interface PlantNodeInfo {
  id: string;
  /** `Leaf #2`. */
  label: string;
  /** The part this one grows out of, or null when it is the plant's first. */
  parent: string | null;
  /** Every part grown directly from this one, named and numbered. */
  children: string[];
}

/**
 * The named facts about one node.
 *
 * Children are read from `parentId`, not from each node's own `children` list: the
 * server treats `parentId` as the authority, and a client mirror that has not
 * received the parent's updated list yet would otherwise claim a part has no
 * children right after it grew one.
 */
export function plantNodeInfo(nodeId: string, nodes: Iterable<PlantNodeRef>): PlantNodeInfo | null {
  const list = [...nodes];
  const found = list.find((node) => node.id === nodeId);
  if (!found) return null;
  const labels = labelPlantNodes(list);
  const children = list
    .filter((node) => node.parentId === nodeId)
    .map((node) => labels.get(node.id) ?? nodePartName(node));
  return {
    id: nodeId,
    label: labels.get(nodeId) ?? nodePartName(found),
    parent: found.parentId ? (labels.get(found.parentId) ?? null) : null,
    children,
  };
}
