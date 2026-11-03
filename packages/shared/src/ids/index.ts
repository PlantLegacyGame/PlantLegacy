/**
 * Identifier aliases. Every gameplay row also carries `world_id`
 * (DESIGN.md Part 13.5 / Appendix H), so ids are never assumed globally unique
 * outside the account service.
 */
export type AccountId = string;
export type WorldId = string;
export type PlantId = string;
export type ItemId = string;
export type GeneId = string;
export type NodeId = string;

const PREFIXES = {
  account: 'acct',
  world: 'world',
  plant: 'p',
  node: 'node',
  item: 'item',
  gene: 'gene',
  seed: 'seed',
  ledger: 'ledger',
  report: 'report',
  session: 'sess',
} as const;

export type IdKind = keyof typeof PREFIXES;

/**
 * Opaque id with a readable prefix. Not a game rule — just a consistent shape
 * so logs and ledger entries are greppable.
 */
export function newId(kind: IdKind): string {
  return `${PREFIXES[kind]}_${crypto.randomUUID()}`;
}
