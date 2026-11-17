/**
 * T04 adaptive pressure — guided growth.
 *
 * Investment is tracked per growth category with exponential decay, so the
 * plant's recent playstyle biases the mutation pool without removing chance.
 * All arithmetic is pure; the PlantWorld owns when it is called.
 */
import type { MutationCategory, MutationsConfig } from './types.ts';

export type Pressure = Record<MutationCategory, number>;

/** Decay every category by `dtSeconds` of a configurable half-life. */
export function decayPressure(
  pressure: Pressure,
  dtSeconds: number,
  halfLifeTicks: number,
  tickRateHz: number,
): void {
  if (dtSeconds <= 0) return;
  const halfLifeSeconds = Math.max(1, halfLifeTicks) / Math.max(1, tickRateHz);
  const factor = 2 ** (-dtSeconds / halfLifeSeconds);
  for (const category of Object.keys(pressure) as MutationCategory[]) {
    pressure[category] *= factor;
  }
}

/** Record investment in one category. Amounts are in biomass. */
export function addPressure(pressure: Pressure, category: MutationCategory, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  pressure[category] += amount;
}

/**
 * The multiplier this plant's pressure applies to a mutation's tags.
 *
 * `(1 + sum(pressure for matching categories))`, capped by config so a long
 * game cannot make one mutation certain. Pressure is normalised by the plant's
 * total investment so a big plant is not automatically biased everywhere.
 */
export function pressureMultiplier(
  pressure: Pressure,
  tags: readonly string[],
  config: MutationsConfig,
): number {
  if (!config.adaptivePressureEnabled || tags.length === 0) return 1;
  let total = 0;
  for (const [category, rawAmount] of Object.entries(pressure)) {
    const mapped = config.categoryToTags[category] ?? [];
    if (!mapped.some((tag) => tags.includes(tag))) continue;
    total += rawAmount;
  }
  if (total <= 0) return 1;
  // Saturating curve: early investment moves the odds, late investment does
  // not make them a certainty.
  const scaled = 1 + Math.min(config.maxPressureMultiplier - 1, total / (total + 1));
  return Math.min(config.maxPressureMultiplier, scaled);
}
