/**
 * What a competent player does, and where they point a new part.
 *
 * Kept apart from the socket so the policy can be tested and swapped: a bot
 * that cannot play the game would report every rule as a bug.
 */

/**
 * Growth order a new plant needs to become a plant, then a rhythm that keeps
 * energy positive: canopy to earn, roots to drink.
 *
 * The order is a preference, not a script. The bot takes the first entry it can
 * legally grow *now* and moves on, so a refusal for one part does not stall it.
 */
export const GROWTH_PLAN: readonly string[] = [
  'radicle',
  'cotyledon',
  'cotyledon',
  'stem',
  'leaf',
  'leaf',
  'root',
  'leaf',
  'lateral_root',
  'leaf',
  'branch',
  'root',
  'leaf',
  'branch',
  'lateral_root',
];

export interface Direction {
  x: number;
  y: number;
  z: number;
}

/**
 * A legal-looking direction for each organ.
 *
 * The server clamps and validates these (roots must trend down, cotyledons up),
 * so the bot sends a plausible raw vector and lets the authority decide - which
 * is also what the real client does.
 */
export function directionFor(nodeType: string, index: number): Direction {
  // Vary the azimuth so a bot does not grow every lateral branch along +x.
  const angle = (index * 2.399963) % (Math.PI * 2); // golden angle in radians
  const cx = Math.cos(angle);
  const cz = Math.sin(angle);
  switch (nodeType) {
    case 'radicle':
      return { x: 0, y: -1, z: 0 };
    case 'root':
      return { x: 0.18 * cx, y: -1, z: 0.18 * cz };
    case 'lateral_root':
      return { x: 0.82 * cx, y: -0.58, z: 0.82 * cz };
    case 'pneumatophore':
      return { x: 0.2 * cx, y: 0.9, z: 0.2 * cz };
    case 'cotyledon':
      return { x: 0.45 * cx, y: 0.9, z: 0.45 * cz };
    case 'stem':
    case 'trunk':
    case 'culm':
      return { x: 0.12 * cx, y: 1, z: 0.12 * cz };
    case 'branch':
      return { x: 0.72 * cx, y: 0.68, z: 0.72 * cz };
    case 'vine':
    case 'stolon':
      return { x: 0.9 * cx, y: 0.3, z: 0.9 * cz };
    case 'leaf':
    case 'cotyledon_leaf':
    case 'floating_leaf':
    case 'flower':
    case 'spore_sac':
      return { x: 0.8 * cx, y: 0.5, z: 0.8 * cz };
    case 'rhizome':
    case 'tuber':
      return { x: 0.9 * cx, y: -0.25, z: 0.9 * cz };
    case 'thorn':
      return { x: 0.5 * cx, y: 0.6, z: 0.5 * cz };
    default:
      return { x: 0.4 * cx, y: 0.7, z: 0.4 * cz };
  }
}

/** Is this a root-layer organ? Used to avoid a plant made only of roots. */
export function isRootOrgan(nodeType: string): boolean {
  return (
    nodeType === 'radicle' ||
    nodeType === 'root' ||
    nodeType === 'lateral_root' ||
    nodeType === 'rhizome' ||
    nodeType === 'tuber' ||
    nodeType === 'pneumatophore'
  );
}
