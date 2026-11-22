/**
 * How long frames actually take, and how much of that is ours.
 *
 * "It stutters" is a report with two very different causes: the main thread is
 * busy (our code), or the GPU cannot finish a frame in time (fill rate, draw
 * calls, a shadow pass). Console timings from outside the page cannot answer it,
 * because a hidden tab stops drawing entirely. So the loop records its own
 * frame intervals and the time it spends inside `renderFrame`, and the
 * difference between the two is the answer: small CPU inside a long frame means
 * the GPU is the limit.
 *
 * Pure and bounded: a fixed ring of samples, percentiles computed on demand.
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
  /** Time spent inside the frame callback, milliseconds. */
  cpuP50Ms: number;
  cpuP95Ms: number;
  /** Frames that missed a 60 Hz vsync by more than half a frame. */
  longFrames: number;
}

/**
 * The one frame readout (`__pl.frameStats()`).
 *
 * Pacing and cost are two budgets because they are recorded in different places:
 * intervals only exist when the tab is animating, while the cost of a frame can be
 * measured on the timer loop a hidden tab draws with. Reporting them separately
 * left two overlapping readouts (`frameStats` and `renderStats`) and a third
 * number inside `stats()`, which is how "is it the CPU or the GPU" got answered
 * three different ways. One object, one place.
 */
export interface FrameStats {
  /** Frames the animation loop measured. */
  frames: number;
  /** Frames per second over the window, from the mean interval. */
  fps: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  /** Frames that missed a 60 Hz vsync by more than half a frame. */
  longFrames: number;
  /** Time spent inside the frame callback, over every frame drawn. */
  cpuP50Ms: number;
  cpuP95Ms: number;
  cpuWorstMs: number;
  /** Frames the cost was measured on, including a hidden tab's timer frames. */
  cpuFrames: number;
}

const EMPTY: FrameBudgetStats = {
  frames: 0,
  fps: 0,
  p50Ms: 0,
  p95Ms: 0,
  worstMs: 0,
  cpuP50Ms: 0,
  cpuP95Ms: 0,
  longFrames: 0,
};

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

export class FrameBudget {
  private readonly size: number;
  private readonly intervals: number[] = [];
  private readonly cpu: number[] = [];
  private cursor = 0;
  private filled = 0;

  constructor(size = 240) {
    this.size = Math.max(1, Math.round(size));
  }

  /** Record one frame: its interval and the time the callback took. */
  record(intervalMs: number, cpuMs: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 0) return;
    if (!Number.isFinite(cpuMs) || cpuMs < 0) return;
    this.intervals[this.cursor] = intervalMs;
    this.cpu[this.cursor] = cpuMs;
    this.cursor = (this.cursor + 1) % this.size;
    this.filled = Math.min(this.size, this.filled + 1);
  }

  stats(): FrameBudgetStats {
    if (this.filled === 0) return { ...EMPTY };
    const intervals = this.intervals.slice(0, this.filled);
    const cpu = this.cpu.slice(0, this.filled);
    const sortedIntervals = [...intervals].sort((a, b) => a - b);
    const sortedCpu = [...cpu].sort((a, b) => a - b);
    const meanInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    return {
      frames: intervals.length,
      fps: meanInterval > 0 ? Math.round(1000 / meanInterval) : 0,
      p50Ms: round(percentile(sortedIntervals, 0.5)),
      p95Ms: round(percentile(sortedIntervals, 0.95)),
      worstMs: round(sortedIntervals[sortedIntervals.length - 1] ?? 0),
      cpuP50Ms: round(percentile(sortedCpu, 0.5)),
      cpuP95Ms: round(percentile(sortedCpu, 0.95)),
      longFrames: intervals.filter((value) => value > 24).length,
    };
  }

  reset(): void {
    this.intervals.length = 0;
    this.cpu.length = 0;
    this.cursor = 0;
    this.filled = 0;
  }
}

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Merge the two budgets into the readout callers use.
 *
 * Pacing comes from the animation loop; cost comes from the cost budget, which
 * also has the timer frames a hidden tab draws - so `cpuP50Ms` stays meaningful
 * when `fps` is 0 because nothing is animating.
 */
export function frameStatsOf(pacing: FrameBudget, cost: FrameBudget): FrameStats {
  const p = pacing.stats();
  const c = cost.stats();
  return {
    frames: p.frames,
    fps: p.fps,
    p50Ms: p.p50Ms,
    p95Ms: p.p95Ms,
    worstMs: p.worstMs,
    longFrames: p.longFrames,
    cpuP50Ms: c.p50Ms,
    cpuP95Ms: c.p95Ms,
    cpuWorstMs: c.worstMs,
    cpuFrames: c.frames,
  };
}
