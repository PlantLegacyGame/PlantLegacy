/**
 * Item categories and movement flags (DESIGN.md Part 6.1, Part 6.3, RULE_23).
 *
 * `account_bound: true` forces `tradeable`, `mailable` and `listable` to false.
 * Every system that moves items (T14, T45, T08A bundles, T29) validates these
 * server-side. No rarity field exists anywhere in this schema (RULE_20).
 */

/** Every item definition must declare exactly these four flags. */
export const ITEM_FLAG_KEYS = ['tradeable', 'mailable', 'listable', 'account_bound'] as const;

/** Item categories from DESIGN.md Part 6.1. No `rarity` member, by design. */
export const ITEM_CATEGORIES = [
  'booster',
  'gene',
  'heirloom_seed',
  'offspring_seed',
  'starter_pack',
  'gift_bundle',
  'essence',
  'dung',
  'fertilizer',
  'gene_stabilization',
  'mail_attachment',
  'fragment',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export interface ItemFlags {
  tradeable: boolean;
  mailable: boolean;
  listable: boolean;
  account_bound: boolean;
}

export interface ItemDefinition extends ItemFlags {
  id: string;
  category: ItemCategory;
  stack_limit: number;
}

export function flagsAllowTrade(flags: ItemFlags): boolean {
  return flags.tradeable && !flags.account_bound;
}

export function flagsAllowMail(flags: ItemFlags): boolean {
  return flags.mailable && !flags.account_bound;
}

export function flagsAllowListing(flags: ItemFlags): boolean {
  return flags.listable && !flags.account_bound;
}

/** True when the flag set violates the `account_bound` invariant. */
export function violatesAccountBoundInvariant(flags: Partial<ItemFlags>): boolean {
  if (flags.account_bound !== true) return false;
  return flags.tradeable === true || flags.mailable === true || flags.listable === true;
}
