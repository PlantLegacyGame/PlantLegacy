/**
 * The spore ledger: one line for every event that moved the purse.
 *
 * The purse is server-owned (`INVENTORY_SYNC.sporeBalance`) and the client only
 * ever displays it, so a balance that changed between two syncs was a number
 * with no explanation. A purchase spends 18, a dung use pays 3, a drop pays 2
 * and a kill pays 1; without a record the player saw the chip move and had to
 * guess why. The server now sends one `LEDGER_ENTRY` per change, carrying the
 * reason and the balance it committed, and this module owns the words.
 *
 * Nothing here names a machine: an entry carries the server's own display label
 * for what moved (the item name, or the award's sentence) and never an id. The
 * item id travels in `itemId` for the icon and the slot lookup, but no text is
 * built from it.
 */

export type LedgerKind = 'purchase' | 'use' | 'award' | 'drop';

export interface LedgerEntry {
  kind: LedgerKind;
  /** What moved, in the server's words: "Starter Dung", "Kill credit". */
  label: string;
  /** The item, when one moved. Used for icons, never printed. */
  itemId: string | null;
  /** How many items moved; 0 when only spores did. */
  count: number;
  /** Spores moved, signed: negative spent, positive earned. */
  amount: number;
  /** The purse after the entry, as the server committed it. */
  balance: number;
}

/** How many entries the client keeps. A screenful, not a log file. */
export const LEDGER_LIMIT = 14;

/**
 * Add one entry, oldest first, dropping the oldest once the list is full.
 *
 * Returns a new array rather than mutating: the same rule is used by the client
 * store and by tests, and an in-place push made it hard to tell which of the two
 * had changed a list.
 */
export function appendLedger(
  entries: readonly LedgerEntry[],
  entry: LedgerEntry,
  limit: number = LEDGER_LIMIT,
): LedgerEntry[] {
  const cap = Math.max(1, Math.floor(limit));
  const next = [...entries, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** `−8 spores`, `+3 spores`, or nothing when only items moved. */
export function ledgerAmountText(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '';
  const rounded = Math.round(amount);
  if (rounded === 0) return '';
  return rounded > 0 ? `+${rounded} spores` : `\u2212${Math.abs(rounded)} spores`;
}

/**
 * One line of the ledger, for the inventory panel.
 *
 * The kinds read differently because they are different events: a purchase is
 * something the player chose to do, an award is something the world paid, and a
 * drop is something picked up off the ground.
 */
export function ledgerEntryText(entry: LedgerEntry): string {
  const amount = ledgerAmountText(entry.amount);
  // A missing or broken balance reads as zero, never as "NaN left" on screen.
  const balance = `${Number.isFinite(entry.balance) ? Math.round(entry.balance) : 0} left`;
  const stack = entry.count > 1 ? ` \u00D7${entry.count}` : '';
  const parts: string[] = [];
  switch (entry.kind) {
    case 'purchase':
      parts.push(`Bought ${entry.label}${stack}`);
      break;
    case 'use':
      parts.push(`Used ${entry.label}${stack}`);
      break;
    case 'drop':
      parts.push(`Picked up ${entry.label}`);
      break;
    case 'award':
      parts.push(`${entry.label}${stack}`);
      break;
  }
  if (amount) parts.push(amount);
  parts.push(balance);
  return parts.join(' \u00B7 ');
}
