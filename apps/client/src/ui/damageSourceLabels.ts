import type { DamageSource } from '@plant-legacy/shared/damage';

/**
 * What the damage toast calls each source.
 *
 * A total record on purpose: a source added to `DamageSource` is a compile error
 * here rather than a toast that reads "Took 0.8 biomass damage (damage)". The
 * payload's `source` is whatever a server build sent, so `damageSourceLabel`
 * still answers for a string this client does not know.
 */
export const DAMAGE_SOURCE_LABELS: Record<DamageSource, string> = {
  weather: 'weather',
  tool: 'a tool',
  herbivore: 'herbivores',
  terrain: 'terrain',
  // E18: tissue shed because the plant could not pay its own upkeep. Naming the
  // cause is the point — it is the one loss the player cannot dodge.
  starvation: 'its own upkeep',
};

export function damageSourceLabel(source: string | undefined): string {
  if (!source) return 'damage';
  return (DAMAGE_SOURCE_LABELS as Record<string, string | undefined>)[source] ?? 'damage';
}
