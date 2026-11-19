/**
 * How a node's id is formed, and how to read one back.
 *
 * A node id is the plant's tag, a colon, then the part's own name:
 * `7de297df-8304-4a:seed`, `7de297df-8304-4a:seed.radicle0`.
 *
 * The tag is the plant id without its `p_` prefix, cut to
 * `PLANT_NODE_TAG_LENGTH`. INV-GR-05 raised that length from eight to sixteen:
 * two plants whose eight-character tags collided minted the same node ids, and
 * `findPlantByNodeId` grew the wrong plant.
 *
 * *Reading* an id has to agree with *minting* one, and it lived in two places
 * that disagreed. The server minted sixteen characters; the client still tested
 * for eight when it pruned nodes that did not carry its plant's tag. Every node
 * the server made failed that test, so the first growth event deleted the whole
 * plant mirror: the plant vanished, Root Sight's cavity emptied with it (its
 * mouth is sized from the roots in that mirror), and both reappeared a couple of
 * seconds later when the next sync arrived. One rule, imported by both sides.
 */

/** Characters of the plant id a node id is tagged with. */
export const PLANT_NODE_TAG_LENGTH = 16;

/** The tag that every node id of this plant starts with. */
export function plantNodeTag(plantId: string): string {
  return plantId.replace(/^p_/, '').slice(0, PLANT_NODE_TAG_LENGTH);
}

/** True when a node id was minted for this plant. */
export function nodeBelongsToPlant(nodeId: string, plantId: string): boolean {
  const tag = plantNodeTag(plantId);
  return tag.length > 0 && nodeId.startsWith(`${tag}:`);
}
