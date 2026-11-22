/**
 * Colour maths shared by the palette tooling and the client.
 *
 * One implementation, so the art bible's swatches and the HUD's custom
 * properties cannot disagree about what a palette step is - and one definition
 * of what a role name is, for the config validator and the client alike.
 */
export * from './oklch.ts';
export * from './paletteRole.ts';
