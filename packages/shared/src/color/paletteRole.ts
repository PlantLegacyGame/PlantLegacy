/**
 * What a palette role name looks like, in one place.
 *
 * `config/palette.json` names its roles (`water_deep`, `leaf_body`), and config
 * entries of type `palette_role` hold one of those names instead of a colour.
 * The config validator checks the shape when it validates a file, and the
 * client checks it again when it parses the payload it was sent; both ask here,
 * because two copies of the pattern had already started to disagree.
 */

/** A role name as `config/palette.json` writes it: `water_deep`, `leaf_body`. */
export const PALETTE_ROLE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Whether a value is shaped like a palette role name (and so not a colour). */
export const isPaletteRoleName = (value: unknown): value is string =>
  typeof value === 'string' && PALETTE_ROLE_PATTERN.test(value);
