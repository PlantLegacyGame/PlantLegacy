/**
 * Per-device key rebinding.
 *
 * `config/controls.json` is the server's table and stays authoritative: a
 * player's changes are a small override map of action -> keys, stored on this
 * device only. Merging at the point the InputBus is built (and again after the
 * server reloads the table) keeps the config as the source of defaults, so a
 * config fix still reaches a player who has rebound something else.
 *
 * Rules:
 * - A rebind replaces that action's keys with the one key pressed. A movement
 *   action that ships two keys keeps its second key only until it is rebound.
 * - One key drives one action: assigning a key takes it away from every other
 *   action, and the caller can say which actions lost it.
 * - An override for an action the config no longer has is ignored, not
 *   resurrected.
 */
import type { Binding } from '@plant-legacy/input';

export type ControlOverrides = Record<string, string[]>;

export const CONTROL_OVERRIDES_KEY = 'plantlegacy.controls.v1';

export interface RebindResult {
  bindings: Record<string, Binding>;
  /** Every action whose keys changed, including ones that lost the key. */
  changes: ControlOverrides;
  /** Actions that held the key before this rebind. */
  displaced: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Parse stored overrides; anything malformed is ignored rather than fatal. */
export function parseControlOverrides(raw: string | null): ControlOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string[]] => isStringArray(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

/** Overlay the stored keys on the config's table, action by action. */
export function mergeControlOverrides(
  bindings: Record<string, Binding>,
  overrides: ControlOverrides,
): Record<string, Binding> {
  const merged: Record<string, Binding> = {};
  for (const [action, binding] of Object.entries(bindings)) {
    const keys = overrides[action];
    merged[action] = keys ? { ...binding, keys: [...keys] } : binding;
  }
  return merged;
}

/**
 * Give one action a new key.
 *
 * Returns null for an action the config does not have, so a stale click cannot
 * invent a binding. The returned `changes` holds the resulting keys for every
 * action that moved, which is what the caller persists.
 */
export function rebindAction(
  bindings: Record<string, Binding>,
  action: string,
  code: string,
): RebindResult | null {
  const target = bindings[action];
  if (!target || !code) return null;

  const changes: ControlOverrides = { [action]: [code] };
  const displaced: string[] = [];
  const next: Record<string, Binding> = {};

  for (const [id, binding] of Object.entries(bindings)) {
    if (id === action) {
      next[id] = { ...binding, keys: [code] };
      continue;
    }
    if (binding.keys.includes(code)) {
      displaced.push(id);
      changes[id] = binding.keys.filter((key) => key !== code);
      next[id] = { ...binding, keys: [...changes[id]] };
      continue;
    }
    next[id] = binding;
  }

  return { bindings: next, changes, displaced };
}

export function loadControlOverrides(storage: Pick<Storage, 'getItem'>): ControlOverrides {
  try {
    return parseControlOverrides(storage.getItem(CONTROL_OVERRIDES_KEY));
  } catch {
    return {};
  }
}

export function saveControlOverrides(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  overrides: ControlOverrides,
): void {
  try {
    if (Object.keys(overrides).length === 0) {
      storage.removeItem(CONTROL_OVERRIDES_KEY);
      return;
    }
    storage.setItem(CONTROL_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // A private-mode quota failure must not break the rebind the player just did.
  }
}
