/**
 * How long frames actually take, and how much of that is ours.
 *
 * "It stutters" is a report with two very different causes: the main thread is
 * busy (our code), or the GPU cannot finish a frame in time (fill rate, draw
 * calls, a shadow pass). Console timings from outside the page cannot answer it,
 * because a hidden tab stops drawing entirely. So the loop records its own frame
 * intervals and the time it spends inside `renderFrame`, and the difference
 * between the two is the answer: small CPU inside a long frame means the GPU is
 * the limit.
 *
 * Both rings live here: intervals only exist when the tab is animating, while the
 * cost of a frame can be measured on the timer loop a hidden tab draws with. That
 * is why they are recorded separately - and why there is exactly one of each.
 * Two budgets used to exist, one of them feeding the CPU time in as its own
 * interval, so the same number was reported three ways (`frameStats`,
 * `renderStats`, `stats().renderCpuMs`).
 *
 * Pure and bounded: fixed rings of samples, percentiles computed on demand.
 */

export interface FrameBudgetStats {
  /** Samples in the window. */
  frames: number;
  /** Frames per second over the window, from the mean interval. */
  fps: number;
  /** Frame interval percentiles, milliseconds. */
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  /** Frames that missed a 60 Hz vsync by more than half a frame. */
  longFrames: number;
}

/** Time spent inside the frame callback, over every frame that ran one. */
export interface FrameCostStats {
  /** Frames the cost was measured on, including a hidden tab's timer frames. */
  frames: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
}

/**
 * The one frame readout (`__pl.frameStats()`).
 *
 * Pacing and cost together, because "is it the CPU or the GPU" is asked once and
 * has one answer: `fps` is what the display got, `cpuP50Ms` is what our own code
 * spent of each frame, and the gap between them is the GPU's.
 */
export interface FrameStats extends FrameBudgetStats {
  cpuFrames: number;
  cpuP50Ms: number;
  cpuP95Ms: number;
  cpuWorstMs: number;
  /**
   * Last GPU time the driver reported, milliseconds, or null when it cannot.
   *
   * This is the number that separates "our code is slow" from "the GPU is at its
   * limit": with the CPU at 2 ms and the GPU at 16 ms in a 33 ms frame, the GPU is
   * the whole story and no amount of loop work will fix it.
   */
  gpuMs: number | null;
}

const EMPTY: FrameBudgetStats = {
  frames: 0,
  fps: 0,
  p50Ms: 0,
  p95Ms: 0,
  worstMs: 0,
  longFrames: 0,
};

const EMPTY_COST: FrameCostStats = { frames: 0, p50Ms: 0, p95Ms: 0, worstMs: 0 };

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

export class FrameBudget {
  private readonly size: number;
  private readonly intervals: number[] = [];
  private readonly costs: number[] = [];
  private cursor = 0;
  private filled = 0;
  private costCursor = 0;
  private costFilled = 0;

  constructor(size = 240) {
    this.size = Math.max(1, Math.round(size));
  }

  /** Record one animation frame's interval, milliseconds. */
  record(intervalMs: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 0) return;
    this.intervals[this.cursor] = intervalMs;
    this.cursor = (this.cursor + 1) % this.size;
    this.filled = Math.min(this.size, this.filled + 1);
  }

  /**
   * Record what a frame cost inside its callback, milliseconds.
   *
   * Called by the animation loop and by the timer loop a hidden tab draws with,
   * so the cost side keeps reporting when pacing cannot.
   */
  recordCost(cpuMs: number): void {
    if (!Number.isFinite(cpuMs) || cpuMs < 0) return;
    this.costs[this.costCursor] = cpuMs;
    this.costCursor = (this.costCursor + 1) % this.size;
    this.costFilled = Math.min(this.size, this.costFilled + 1);
  }

  stats(): FrameBudgetStats {
    if (this.filled === 0) return { ...EMPTY };
    const intervals = this.intervals.slice(0, this.filled);
    const sorted = [...intervals].sort((a, b) => a - b);
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    return {
      frames: intervals.length,
      fps: mean > 0 ? Math.round(1000 / mean) : 0,
      p50Ms: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      worstMs: round(sorted[sorted.length - 1] ?? 0),
      longFrames: intervals.filter((value) => value > 24).length,
    };
  }

  costStats(): FrameCostStats {
    if (this.costFilled === 0) return { ...EMPTY_COST };
    const costs = this.costs.slice(0, this.costFilled);
    const sorted = [...costs].sort((a, b) => a - b);
    return {
      frames: costs.length,
      p50Ms: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      worstMs: round(sorted[sorted.length - 1] ?? 0),
    };
  }

  reset(): void {
    this.intervals.length = 0;
    this.costs.length = 0;
    this.cursor = 0;
    this.filled = 0;
    this.costCursor = 0;
    this.costFilled = 0;
  }
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** The one readout: pacing from the animation loop, cost from every frame drawn. */
export function frameStatsOf(budget: FrameBudget, gpuMs: number | null = null): FrameStats {
  const p = budget.stats();
  const c = budget.costStats();
  return {
    ...p,
    cpuFrames: c.frames,
    cpuP50Ms: c.p50Ms,
    cpuP95Ms: c.p95Ms,
    cpuWorstMs: c.worstMs,
    gpuMs: Number.isFinite(gpuMs) && (gpuMs as number) > 0 ? round(gpuMs as number) : null,
  };
}
