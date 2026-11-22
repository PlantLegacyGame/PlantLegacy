/**
 * Spores: the earned currency.
 *
 * Spores are the money the shop prices things in (DESIGN T13). The shop used to
 * quote biomass - a resource the plant spends on growing - so buying a thing
 * either starved the plant or was not a purchase at all, and no shop button was
 * ever wired, because there was no balance to check.
 *
 * The balance lives on the player, server-side, exactly like the pouch: the
 * client can read it and ask to spend it, never set it. This module owns the
 * numbers, so a price or an earn rate is one config edit and not a literal in a
 * handler.
 */
import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger } from '@plant-legacy/shared/config';

export interface SporeConfig {
  /** What a new plant starts with, so the shop is usable on the first session. */
  startingBalance: number;
  /** Spores for consuming one dung item. */
  earnDung: number;
  /** Spores for acquiring a mutation. */
  earnMutation: number;
  /** Spores for picking up one fragment drop. */
  earnFragment: number;
  /** Spores credited to the killer when another plant dies. */
  earnKill: number;
  /** Hard ceiling on a balance, so one bug cannot produce a runaway number. */
  maxBalance: number;
}

export function loadSporeConfig(configs: Map<string, ConfigFile>): SporeConfig {
  return {
    startingBalance: readInteger(configs, 'spores', 'starting_balance'),
    earnDung: readInteger(configs, 'spores', 'earn_dung'),
    earnMutation: readInteger(configs, 'spores', 'earn_mutation'),
    earnFragment: readInteger(configs, 'spores', 'earn_fragment'),
    earnKill: readInteger(configs, 'spores', 'earn_kill'),
    maxBalance: readInteger(configs, 'spores', 'max_balance'),
  };
}

/** Clamp an amount to what a purse can hold. Keeps every write bounded. */
export function clampBalance(balance: number, maxBalance: number): number {
  if (!Number.isFinite(balance)) return 0;
  return Math.max(0, Math.min(maxBalance, Math.round(balance)));
}

/** Add spores, never above the ceiling and never below zero. */
export function earnSpores(balance: number, amount: number, maxBalance: number): number {
  return clampBalance(balance + Math.max(0, Math.round(amount)), maxBalance);
}

/**
 * Take spores for a price. Returns the new balance, or null when the player
 * cannot afford it - the caller decides what to tell them, and no caller can
 * spend a balance below zero.
 */
export function spendSpores(balance: number, price: number, maxBalance: number): number | null {
  const cost = Math.round(price);
  if (!Number.isFinite(cost) || cost < 0) return null;
  if (balance < cost) return null;
  return clampBalance(balance - cost, maxBalance);
}
