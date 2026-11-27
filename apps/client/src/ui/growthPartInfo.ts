import { ORGAN_DISPLAY_ORDER } from '@plant-legacy/shared/growth';

/**
 * What each growth card says when the card is too small to explain itself.
 *
 * This used to be a ten-entry object in `main.ts` beside a ten-entry sort order:
 * nine organs the renderer could grow had no card copy and fell through to "A
 * new part for your plant" (or were never shown). It is a table now, keyed by the
 * same display order the mesh pass uses.
 */
export const GROWTH_PART_INFO: Record<string, string> = {
  seed: 'The seed. The whole plant starts here and the coat protects the first root.',
  radicle: 'The first root. Anchors the seedling and starts drawing water from the soil.',
  root: 'A thick taproot. Holds the plant steady and stores water and minerals.',
  lateral_root: 'A fine side root. Spreads through new soil for water and nutrients.',
  stem: 'The main stem. Lifts new leaves toward the light.',
  branch: 'A side branch. Opens more space for leaves and flowers.',
  trunk: 'A woody trunk. Holds a tall plant up and carries water to the crown.',
  rhizome: 'An underground runner. Creeps through the soil and starts new shoots.',
  culm: 'A hollow grass stem. Light and stiff, with a sheath at every joint.',
  floating_leaf: 'A floating pad. Rests on water and gathers light from above.',
  pneumatophore: 'A breathing root. A spongy peg that takes air down to waterlogged roots.',
  thorn: 'A hardened point. A woody defence against being eaten or bumped.',
  stolon: 'A surface runner. Crosses open ground and roots a new plantlet.',
  tuber: 'A storage body. Packs starch into an underground swelling.',
  vine: 'A climbing vine. Reaches new light without building a thick trunk.',
  leaf: 'A true leaf. Turns light, water and minerals into energy.',
  cotyledon: 'A seed leaf. Feeds the seedling until true leaves can take over.',
  flower: 'A flower. The next step toward seed and a new generation.',
  spore_sac: "A spore sac. Releases the plant's spores when it matures.",
};

export function growthTypeOrder(): Record<string, number> {
  return Object.fromEntries(ORGAN_DISPLAY_ORDER.map((type, index) => [type, index]));
}
