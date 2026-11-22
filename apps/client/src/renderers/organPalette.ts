/**
 * A01: the plant's organs take their base colour from the palette's roles.
 *
 * Nine organ materials used to carry nine compiled-in hexes - a dark brown
 * trunk, a pale root, a bluish leaf, a pink flower and a yellow centre that
 * belonged to no ramp in `config/palette.json`. The renderer now asks the role
 * map for a name, the same way the HUD does: no material quotes a ladder step
 * directly, so a role can move along its ramp without hunting through the
 * renderer for the shade it happened to be painted with.
 *
 * The roles themselves live in `config/palette.json`, which is where the art
 * bible's swatches and role table come from; adding an organ means adding a
 * role there, not a number here.
 */

import type { PaletteConfig } from '../config/clientConfig.js';
import { paletteRoleHexes } from '../config/paletteColours.ts';

/**
 * The role that paints each organ. Where the palette already names the paint -
 * a shoot is foliage, a spore is earth - the organ uses that role rather than a
 * second name for the same step.
 */
export const ORGAN_ROLES = {
  bark: 'bark_shade',
  stem: 'leaf_shade',
  root: 'bark_pale',
  leaf: 'leaf_body',
  cotyledon: 'leaf_lit',
  flower: 'flower',
  flowerCentre: 'flower_centre',
  spore: 'soil_mid',
  seed: 'soil_shade',
} as const satisfies Record<string, string>;

export type OrganKey = keyof typeof ORGAN_ROLES;

/** Every organ's hex, resolved through its role. Throws on a role it lacks. */
export function resolveOrganColours(palette: PaletteConfig): Record<OrganKey, string> {
  const roles = paletteRoleHexes(palette);
  const colours = {} as Record<OrganKey, string>;
  for (const organ of Object.keys(ORGAN_ROLES) as OrganKey[]) {
    const role = ORGAN_ROLES[organ];
    const hex = roles[role];
    if (!hex) throw new Error(`the palette has no role ${role} for the ${organ} organ`);
    colours[organ] = hex;
  }
  return colours;
}
