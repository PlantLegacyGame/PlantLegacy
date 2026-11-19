/**
 * Tick timing metrics, and the consumer `TICK_BUDGET_WARNING` never had.
 *
 * `PlantWorld.step` has always returned per-tier milliseconds, but nothing read
 * them: the budget warning was published into an empty subscription list, so a
 * server that spent all its tick on Active plants was indistinguishable from a
 * healthy one from the outside. This keeps a ring of the last
 * `metrics_window_ticks` samples and summarises them on demand.
 *
 * Deliberately not a sampler: no timers, no per-tick allocation, no logging side
 * effects. Callers record, and the `/metrics` route or a test reads.
 */

export interface TickStepTimings {
  activeMs: number;
  nearMs: number;
  dormantMs: number;
  totalMs: number;
}

export interface TickBudgetWarning {
  /** Present only on the share branch; the absolute-ms branch omits it. */
  activeShare?: number;
  activeMs: number;
  totalMs: number;
  tick: number;
}

export interface MetricSummary {
  avgMs: number;
  maxMs: number;
}

export interface TickMetricsSnapshot {
  /** Samples currently held, and the ring size that bounds them. */
  samples: number;
  windowTicks: number;
  activeMs: MetricSummary;
  nearMs: MetricSummary;
  dormantMs: MetricSummary;
  totalMs: MetricSummary;
  /** Ticks in the window whose Active work exceeded `tick_budget_warn_threshold_ms`. */
  overBudgetTicks: number;
  /** Warnings published inside the window, including both branches of the check. */
  budgetWarnings: number;
  lastWarning: TickBudgetWarning | null;
  /** Highest Active/total share seen in the window; 1 means Active owned the tick. */
  peakActiveShare: number;
}

const EMPTY_SUMMARY: MetricSummary = { avgMs: 0, maxMs: 0 };

function summarise(values: readonly number[]): MetricSummary {
  if (values.length === 0) return EMPTY_SUMMARY;
  let total = 0;
  let max = 0;
  for (const value of values) {
    total += value;
    if (value > max) max = value;
  }
  return { avgMs: total / values.length, maxMs: max };
}

export class TickMetrics {
  readonly windowTicks: number;
  private readonly warnThresholdMs: number;
  private readonly active: number[];
  private readonly near: number[];
  private readonly dormant: number[];
  private readonly total: number[];
  private readonly overBudget: boolean[];
  private readonly shares: number[];
  private cursor = 0;
  private filled = 0;
  private windowWarnings = 0;
  private lastWarning: TickBudgetWarning | null = null;

  constructor(windowTicks: number, warnThresholdMs: number) {
    const size = Math.max(1, Math.floor(windowTicks));
    this.windowTicks = size;
    this.warnThresholdMs = warnThresholdMs;
    this.active = new Array<number>(size).fill(0);
    this.near = new Array<number>(size).fill(0);
    this.dormant = new Array<number>(size).fill(0);
    this.total = new Array<number>(size).fill(0);
    this.overBudget = new Array<boolean>(size).fill(false);
    this.shares = new Array<number>(size).fill(0);
  }

  /** Record one tick. A tick whose Active work passed the threshold is counted. */
  record(timings: TickStepTimings): void {
    const index = this.cursor;
    this.active[index] = timings.activeMs;
    this.near[index] = timings.nearMs;
    this.dormant[index] = timings.dormantMs;
    this.total[index] = timings.totalMs;
    this.overBudget[index] = timings.activeMs > this.warnThresholdMs;
    this.shares[index] = timings.totalMs > 0 ? timings.activeMs / timings.totalMs : 0;
    this.cursor = (index + 1) % this.active.length;
    if (this.filled < this.active.length) this.filled += 1;
  }

  /** Record a published warning. Called from the event-bus subscriber. */
  recordWarning(warning: TickBudgetWarning): void {
    this.windowWarnings += 1;
    this.lastWarning = warning;
  }

  snapshot(): TickMetricsSnapshot {
    const held = <T>(ring: readonly T[]): T[] => ring.slice(0, this.filled);
    const shares = held(this.shares);
    let peakActiveShare = 0;
    for (const share of shares) {
      if (share > peakActiveShare) peakActiveShare = share;
    }
    return {
      samples: this.filled,
      windowTicks: this.active.length,
      activeMs: summarise(held(this.active)),
      nearMs: summarise(held(this.near)),
      dormantMs: summarise(held(this.dormant)),
      totalMs: summarise(held(this.total)),
      overBudgetTicks: held(this.overBudget).filter(Boolean).length,
      budgetWarnings: this.windowWarnings,
      lastWarning: this.lastWarning,
      peakActiveShare,
    };
  }

  /** Drop the window's counters. The last warning survives, since it is not windowed. */
  reset(): void {
    this.cursor = 0;
    this.filled = 0;
    this.windowWarnings = 0;
    this.active.fill(0);
    this.near.fill(0);
    this.dormant.fill(0);
    this.total.fill(0);
    this.overBudget.fill(false);
    this.shares.fill(0);
  }
}
