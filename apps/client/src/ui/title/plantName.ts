/**
 * The nickname on the title screen.
 *
 * Two jobs: turn what a player typed into what the game will store, and invent a
 * readable name when they leave the box empty. The word lists come from
 * `config/ui.json` rather than living here, because holidays will want their own
 * (a winter set, a harvest set) without touching code.
 *
 * Names stay plain on purpose: two short words a player can say out loud, plus a
 * number. Nothing that needs a dictionary, and nothing scientific.
 */

import { sanitizeDisplayName, validateDisplayName } from '@plant-legacy/shared/displayName';

export interface NameLists {
  prefixes: readonly string[];
  nouns: readonly string[];
}

const NUMBER_RANGE = 900;
const NUMBER_FLOOR = 10;

function pick<T>(list: readonly T[], random: () => number): T | null {
  if (list.length === 0) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)));
  return list[index] ?? null;
}

/**
 * `Mossy Fern 412`. Returns an empty string when both lists are empty; callers
 * treat that as "no name available" rather than inventing a fallback word.
 */
export function autoDisplayName(lists: NameLists, random: () => number = Math.random): string {
  const prefix = pick(lists.prefixes, random);
  const noun = pick(lists.nouns, random);
  if (!prefix || !noun) return prefix ?? noun ?? '';
  const number = NUMBER_FLOOR + Math.floor(random() * NUMBER_RANGE);
  return prefix + ' ' + noun + ' ' + number;
}

export interface ResolvedName {
  value: string;
  /** True when the name was generated because the player left the box empty. */
  generated: boolean;
  ok: boolean;
}

/**
 * What Play should send. An empty box is not an error on the title screen: the
 * player gets a generated name and can change it later.
 */
export function resolveDisplayName(
  raw: string,
  lists: NameLists,
  maxLength: number,
  random: () => number = Math.random,
): ResolvedName {
  const typed = sanitizeDisplayName(raw);
  if (typed.length === 0) {
    const generated = autoDisplayName(lists, random);
    return { value: generated, generated: true, ok: generated.length > 0 };
  }
  const result = validateDisplayName(typed, maxLength);
  return { value: result.value, generated: false, ok: result.ok };
}
