/**
 * Mutation visual signatures (C02b).
 *
 * T04 owns how a plant acquires a mutation; this module only defines the three
 * signatures the renderers understand and the bits the GPU vertex word carries
 * (bits 29-31 of the packed u32). The server may send either a bitmask per node
 * (`mutationFlags`) or the mutation ids by name; both reduce to the same mask.
 */

export const MUTATION_BIT = {
  /** Bioluminescent: the node emits a soft pulsing glow. */
  bioluminescent: 1 << 0,
  /** Thickened bark: thicker, darker woody tissue. */
  thick_bark: 1 << 1,
  /** Variegated foliage: mottled leaf colour. */
  variegated: 1 << 2,
} as const;

export type MutationName = keyof typeof MUTATION_BIT;

/** Bits the packed vertex word can hold. */
export const MUTATION_MASK_BITS = 3;
export const MUTATION_MASK_LIMIT = (1 << MUTATION_MASK_BITS) - 1;

export const MUTATION_NAMES = Object.keys(MUTATION_BIT) as MutationName[];

/** Unknown ids are ignored, so a newer server can add mutations safely. */
export function encodeMutationMask(names: readonly string[]): number {
  let mask = 0;
  for (const name of names) {
    const bit = MUTATION_BIT[name as MutationName];
    if (typeof bit === 'number') mask |= bit;
  }
  return mask & MUTATION_MASK_LIMIT;
}

/**
 * A node's mutation mask. `mutationFlags` is the server's bitmask; `mutations`
 * is the id list the protocol may carry instead. Both are optional, so a node
 * with no mutations is simply 0.
 */
export function nodeMutationMask(node: {
  mutationFlags?: number;
  mutations?: readonly string[];
}): number {
  const flags = node.mutationFlags ?? 0;
  const named = node.mutations ? encodeMutationMask(node.mutations) : 0;
  return (flags | named) & MUTATION_MASK_LIMIT;
}

export function mutationMaskHas(mask: number, name: MutationName): boolean {
  return (mask & MUTATION_BIT[name]) !== 0;
}

/**
 * Reads the mask off a server node, which may carry either shape. Used at the
 * protocol boundary so the client never assumes a mutation field exists yet.
 */
export function readServerMutationMask(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const record = node as { mutationFlags?: unknown; mutations?: unknown };
  const flags = typeof record.mutationFlags === 'number' ? record.mutationFlags : 0;
  const names = Array.isArray(record.mutations)
    ? record.mutations.filter((name): name is string => typeof name === 'string')
    : [];
  return (flags | encodeMutationMask(names)) & MUTATION_MASK_LIMIT;
}
