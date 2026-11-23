/**
 * Sending the spore ledger, and the words it uses.
 *
 * The purse already travels with `INVENTORY_SYNC`, but a balance is a number:
 * when it changed between two syncs the client had no way to say whether the
 * player had bought something, used something, been paid for a drop or been
 * killed. One `LEDGER_ENTRY` per change closes that gap, and every entry carries
 * the balance the database committed - not the balance the caller calculated -
 * so the ledger and the chip can never disagree.
 *
 * The label is a sentence the player reads. It comes from the server's own item
 * table for purchases and uses, and from `awardLabel` for reasons, which is why
 * a raw `drop_dung` never reaches the screen.
 */
import type { LedgerEntry } from '@plant-legacy/shared/economy';
import type { WebSocket } from 'ws';
import { MESSAGE_TYPE } from './net.ts';

export interface LedgerPorts {
  send(ws: WebSocket, type: number, payload: unknown): void;
}

/** Round a purse change so the client never prints `12.000000000000002`. */
export function tidyLedgerEntry(entry: LedgerEntry): LedgerEntry {
  const balance = Number.isFinite(entry.balance) ? Math.round(entry.balance) : 0;
  const amount = Number.isFinite(entry.amount) ? Math.round(entry.amount) : 0;
  const count = Number.isFinite(entry.count) ? Math.max(0, Math.round(entry.count)) : 0;
  return {
    kind: entry.kind,
    label: entry.label,
    itemId: entry.itemId,
    count,
    amount,
    balance,
  };
}

export function sendLedgerEntry(
  ports: LedgerPorts,
  player: { ws: WebSocket },
  entry: LedgerEntry,
): void {
  ports.send(player.ws, MESSAGE_TYPE.LEDGER_ENTRY, tidyLedgerEntry(entry));
}

/**
 * The sentence for an award reason.
 *
 * Reasons are wire values (`kill_credit`, `drop_fragment`) and are useful in a
 * log, but the ledger is player-facing: it says what happened, not which branch
 * of the damage pipeline paid it.
 */
export function awardLabel(reason: string): string {
  switch (reason) {
    case 'kill_credit':
      return 'Kill credit';
    case 'drop_dung':
      return 'Dung';
    case 'drop_fragment':
      return 'Fragment';
    case 'drop_remains':
      return 'Remains';
    case 'dev_grant':
      return 'Dev grant';
    default:
      return 'Award';
  }
}
