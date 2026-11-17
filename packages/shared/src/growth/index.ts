/**
 * Growth vocabulary, gene constraints and organism geometry.
 *
 * The rules are split by responsibility so a reader can find the part they
 * need without scanning one 700-line file:
 *
 * - `types.ts`       shapes of the data (node, plant, intent, option)
 * - `constraints.ts` gene direction limits and direction clamping
 * - `geometry.ts`    drawn radii, attach points, segment placement, tunables
 * - `nodeTypes.ts`   layer lookup, definitions, what may grow from what
 *
 * This barrel keeps `@plant-legacy/shared/growth` as the single entry point, so
 * the server, the client and Plant Lab import from one specifier.
 */

export * from './constraints.ts';
export * from './geometry.ts';
export * from './health.ts';
export * from './nodeTypes.ts';
export * from './types.ts';
