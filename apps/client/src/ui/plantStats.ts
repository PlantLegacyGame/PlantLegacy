/**
 * Shared plant statistics wording for the inspect panel and the death screen.
 * Pure data in, display strings out; no DOM.
 */

export interface PlantStatsSummary {
  /** Current structural health, 0..1; null when the server has not sent it. */
  healthFraction: number | null;
  biomass: number;
  /** Signed biomass change per second, or null before two samples. */
  biomassRatePerSecond: number | null;
  peakBiomass: number;
  energy: number;
  storedWater: number;
  waterCapacity: number;
  storedMinerals: number;
  mineralCapacity: number;
  nodeCount: number;
  peakNodeCount: number;
  mutationCount: number;
  mutationUpkeepPerSecond: number;
  mutationEnergyUpkeepPerSecond?: number;
  mutationBiomassUpkeepPerSecond?: number;
  ageSeconds: number;
  dayNumber: number;
  clock: string;
}

export type StatRow = [label: string, value: string];

function count(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0';
}

function decimal(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '0';
}

/**
 * A per-second rate. One decimal was lying about mutation upkeep: a bill of
 * 0.04 B/s that really does kill a small plant over a few minutes printed as
 * "0.0 B/s", so the death screen blamed a cost it showed as nothing. Small
 * nonzero rates keep their significant digits.
 */
function rate(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0.0';
  return Math.abs(value) < 0.1 ? value.toFixed(3) : value.toFixed(1);
}

/** The same rows in the live inspect panel and on the death screen. */
export function plantStatRows(stats: PlantStatsSummary): StatRow[] {
  return [
    [
      'Health',
      stats.healthFraction === null ? 'Unknown' : `${Math.round(stats.healthFraction * 100)}%`,
    ],
    ['Biomass', decimal(stats.biomass)],
    [
      'Growth rate',
      stats.biomassRatePerSecond === null
        ? 'Unknown'
        : `${stats.biomassRatePerSecond >= 0 ? '+' : ''}${decimal(stats.biomassRatePerSecond)}/s`,
    ],
    ['Peak biomass', decimal(stats.peakBiomass)],
    ['Energy', decimal(stats.energy)],
    ['Water', `${decimal(stats.storedWater)} / ${decimal(stats.waterCapacity, 0)}`],
    ['Minerals', `${decimal(stats.storedMinerals)} / ${decimal(stats.mineralCapacity, 0)}`],
    ['Growth nodes', count(stats.nodeCount)],
    ['Peak nodes', count(stats.peakNodeCount)],
    ['Mutations', count(stats.mutationCount)],
    [
      'Mutation upkeep',
      `${rate(stats.mutationEnergyUpkeepPerSecond ?? stats.mutationUpkeepPerSecond)} E/s \u00B7 ${rate(stats.mutationBiomassUpkeepPerSecond ?? 0)} B/s`,
    ],
    ['Age', formatAge(stats.ageSeconds)],
    ['Game day', `${count(stats.dayNumber)} \u00B7 ${stats.clock}`],
  ];
}

export function formatAge(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
}

/** What an item's Use button promises, from the server's own definition. */
export interface ItemUseSummary {
  kind: 'resources' | 'unavailable';
  water?: number;
  minerals?: number;
  energy?: number;
  reason?: string;
}

/**
 * One line saying exactly what pressing Use does, in the item's own numbers.
 *
 * The panel used to show a bare Use button and nothing else, and the config
 * descriptions only said things like "boost soil minerals". A player could not
 * tell 50 from 500, or that a gene booster does nothing at all yet.
 */
export function describeItemUse(use: ItemUseSummary | undefined): string {
  if (!use) return 'Use: waiting for the server';
  if (use.kind === 'unavailable') {
    return use.reason ? `Cannot be used: ${use.reason}` : 'Cannot be used yet';
  }
  const parts: string[] = [];
  if ((use.water ?? 0) > 0) parts.push(`+${use.water} water`);
  if ((use.minerals ?? 0) > 0) parts.push(`+${use.minerals} minerals`);
  if ((use.energy ?? 0) > 0) parts.push(`+${use.energy} energy`);
  return parts.length > 0 ? `Use: ${parts.join(', ')}` : 'Use: no effect';
}

/** `starter_dung` -> `Starter Dung`; ids are server data and stay intact. */
export function prettyItemId(itemId: string): string {
  if (!itemId) return 'Empty';
  return itemId
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
