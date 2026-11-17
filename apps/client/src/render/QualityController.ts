/**
 * C01/AL-03 quality control.
 *
 * Two jobs, deliberately separated:
 *
 * 1. **Tier** — the static capability class (low/medium/high) picked from the
 *    device and corrected when the triangle count blows the tier budget.
 * 2. **Band** — a closed loop over measured frame time. When a frame costs more
 *    than `gpuBandMaxMs` it spends detail in a fixed order: resolution, then
 *    draw distance, then the tier. When it costs less than `gpuBandMinMs` it
 *    recovers in the reverse order, one step at a time, after `holdMs`.
 *
 * The loop is a pure function (`nextQualityState`) so the behaviour is testable
 * without a GPU. `update()` is the only thing the render loop calls.
 *
 * No per-frame allocation: the state object is mutated in place.
 */

export interface QualityTier {
  name: string;
  pixelRatio: number;
  shadowMapSize: number;
  maxTriangles: number;
  antialiasing: boolean;
}

export interface QualityConfig {
  targetFps: number;
  fpsWarningThreshold: number;
  resolutionFloor: number;
  maxPixelRatio: number;
  qualityTiers: QualityTier[];
  /** Frame cost below which detail is restored (ms). */
  gpuBandMinMs: number;
  /** Frame cost above which detail is spent (ms). */
  gpuBandMaxMs: number;
  /** Minimum time between band decisions (ms); stops oscillation. */
  holdMs: number;
  /** Floor for the draw-distance scale, 0..1. */
  drawDistanceFloor: number;
  /** Cost is ignored for this long after the first sample (load, shader builds). */
  warmupMs: number;
  /** EMA weight for a new sample, 0.01..1. Lower is steadier and slower. */
  smoothing: number;
}

export interface QualitySample {
  /** Whole-frame CPU time in ms (the vsync-clamped fallback). */
  frameMs: number;
  /** Measured GPU time in ms, or null when the driver cannot report it. */
  gpuMs: number | null;
  triangles: number;
}

export interface QualityState {
  /** Tier index, 0 = cheapest. */
  tier: number;
  /** Multiplier on the tier's pixel ratio. */
  pixelScale: number;
  /** Multiplier on draw distance / LOD thresholds, 0..1. */
  drawDistanceScale: number;
  /** When the last band or tier decision was made, ms. */
  lastChangeMs: number;
  /** True when the last sample was a real GPU measurement. */
  gpuMeasured: boolean;
  /**
   * True once any real GPU sample has been seen. A driver that reports GPU
   * timing does not stop reporting it, so this only ever latches on. It gates
   * supersampling: without a measurement, native resolution is the ceiling.
   */
  gpuTimingSeen: boolean;
  /** Exponentially smoothed cost in ms, 0 before the first sample. */
  smoothedCostMs: number;
  /** Time of the first sample, 0 before it. Anchors the warm-up window. */
  firstSampleMs: number;
  /** When the smoothed cost first went over budget, 0 when it is not over. */
  overBudgetSinceMs: number;
}

/** How far one decision may move each lever per step. */
const PIXEL_STEP = 0.1;
const DISTANCE_STEP = 0.1;

export function createQualityState(_config?: QualityConfig): QualityState {
  return {
    tier: 0,
    pixelScale: 1,
    drawDistanceScale: 1,
    lastChangeMs: 0,
    gpuMeasured: false,
    gpuTimingSeen: false,
    smoothedCostMs: 0,
    firstSampleMs: 0,
    overBudgetSinceMs: 0,
  };
}

/**
 * The pixel ratio the renderer should actually use.
 *
 * The band's `pixelScale` multiplies the tier's base ratio, and the effective
 * value is clamped to the configured floor and ceiling. Without GPU timing the
 * ceiling is native (1.0): estimated timing cannot prove headroom, so it must
 * not supersample. That is what stops a 60 Hz display from sawtoothing between
 * a degraded ratio and a tier base of 1.25 that is above native.
 */
export function effectivePixelRatio(state: QualityState, config: QualityConfig): number {
  const tiers = config.qualityTiers.length > 0 ? config.qualityTiers : DEFAULT_TIERS;
  const tier = tiers[Math.min(Math.max(0, state.tier), tiers.length - 1)];
  const base = Math.max(0.01, tier.pixelRatio);
  const ceiling = state.gpuTimingSeen ? config.maxPixelRatio : Math.min(config.maxPixelRatio, 1);
  return clamp(base * state.pixelScale, config.resolutionFloor, ceiling);
}

/**
 * The band decision, pure and deterministic.
 *
 * Returns the same `state` object, mutated, so the render loop allocates
 * nothing. `now` is passed in for testability.
 */
export function nextQualityState(
  state: QualityState,
  sample: QualitySample,
  config: QualityConfig,
  now: number,
): QualityState {
  const tiers = config.qualityTiers.length > 0 ? config.qualityTiers : DEFAULT_TIERS;
  const maxTier = tiers.length - 1;
  const tierBase = Math.max(0.01, tiers[state.tier].pixelRatio);
  const gpuMeasured = sample.gpuMs !== null && sample.gpuMs > 0;
  const cost = gpuMeasured ? (sample.gpuMs as number) : sample.frameMs;
  state.gpuMeasured = gpuMeasured;
  if (gpuMeasured) state.gpuTimingSeen = true;

  // Smooth the input: one hitch (a garbage collection, a shader build, a
  // texture upload) must not spend detail. The EMA is deliberately slow, and
  // spending also waits for the cost to stay over budget for a whole hold
  // window, so a single bad frame can never move a lever.
  const alpha = clamp(config.smoothing, 0.01, 1);
  state.smoothedCostMs =
    state.smoothedCostMs > 0 ? state.smoothedCostMs + (cost - state.smoothedCostMs) * alpha : cost;
  const smoothCost = state.smoothedCostMs;

  // Warm-up: the first seconds of a session are compile, upload and
  // first-draw costs, not the steady-state frame. Acting on them opened the
  // session at half resolution. Hold the state still until they pass.
  if (state.firstSampleMs <= 0) state.firstSampleMs = now;
  if (now - state.firstSampleMs < config.warmupMs) {
    state.overBudgetSinceMs = 0;
    state.lastChangeMs = now;
    return state;
  }

  // Without GPU timing the frame time is clamped by vsync, so a 60 Hz device
  // sits at 16.7 ms even with plenty of headroom and a pixel-time band would
  // degrade it forever. Estimated timing therefore uses the frame-rate budget
  // it always used: degrade below the configured warning fraction of target
  // fps, and recover once the target rate is actually reached.
  const budgetMax = gpuMeasured
    ? config.gpuBandMaxMs
    : Math.max(
        config.gpuBandMaxMs,
        1000 / Math.max(1, config.targetFps * config.fpsWarningThreshold),
      );
  const budgetMin = gpuMeasured
    ? config.gpuBandMinMs
    : (1000 / Math.max(1, config.targetFps)) * 1.02;

  // The levers are multipliers on the tier's own pixel ratio, so their bounds
  // are relative to it: the effective ratio must stay inside the configured
  // floor and ceiling.
  const minScale = Math.max(0.05, config.resolutionFloor / tierBase);
  const maxScale = Math.max(minScale, config.maxPixelRatio / tierBase);

  const overBudget = Number.isFinite(smoothCost) && smoothCost > budgetMax;
  if (!overBudget) state.overBudgetSinceMs = 0;
  else if (state.overBudgetSinceMs <= 0) state.overBudgetSinceMs = now;
  // Sustained, not momentary: the smoothed cost must stay over budget for a
  // full hold window before any detail is spent.
  const sustainedOverBudget = overBudget && now - state.overBudgetSinceMs >= config.holdMs;
  const trianglesOver = sample.triangles > tiers[state.tier].maxTriangles;
  const changed = now - state.lastChangeMs >= config.holdMs;

  // A triangle overflow is a hard budget: the tier itself is too expensive, so
  // resolution would not fix it. Drop the tier and reset the finer levers.
  if (trianglesOver && state.tier > 0) {
    state.tier -= 1;
    state.pixelScale = 1;
    state.drawDistanceScale = 1;
    state.lastChangeMs = now;
    return state;
  }

  // Over time budget: spend the cheapest-looking detail first. Resolution is
  // the first lever because it is a single number and does not change the scene.
  if (sustainedOverBudget && changed) {
    if (state.pixelScale > minScale + 1e-6) {
      state.pixelScale = Math.max(minScale, state.pixelScale - PIXEL_STEP);
    } else if (state.drawDistanceScale > config.drawDistanceFloor + 1e-6) {
      state.drawDistanceScale = Math.max(
        config.drawDistanceFloor,
        state.drawDistanceScale - DISTANCE_STEP,
      );
    } else if (state.tier > 0) {
      state.tier -= 1;
      // A tier drop resets the finer levers so the cheaper tier is actually
      // cheaper rather than inheriting a degraded resolution.
      state.pixelScale = 1;
      state.drawDistanceScale = 1;
    }
    state.lastChangeMs = now;
    return state;
  }

  // Under budget: recover only after the hold window, and only one lever at a
  // time so the frame never oscillates between two settings.
  const hasHeadroom = Number.isFinite(smoothCost) && smoothCost <= budgetMin;
  if (!hasHeadroom || !changed) return state;

  // Without a real GPU measurement, hitting vsync is not proof of headroom, so
  // estimated mode may not render above native resolution and may not promote a
  // tier on that evidence. The ceiling is expressed as a scale, so it is
  // relative to the tier base: a medium tier (base 1.25) tops out at 0.8, not
  // at 1.0, or the effective ratio would still be above native.
  const recoveryCeiling = gpuMeasured
    ? maxScale
    : Math.min(maxScale, Math.min(config.maxPixelRatio, 1) / tierBase);

  // Keep the state honest when the ceiling drops (a tier change or the first
  // estimated sample after a measured one).
  if (state.pixelScale > recoveryCeiling) state.pixelScale = recoveryCeiling;

  if (state.pixelScale < recoveryCeiling - 1e-6) {
    state.pixelScale = Math.min(recoveryCeiling, state.pixelScale + PIXEL_STEP * 0.5);
  } else if (state.drawDistanceScale < 1 - 1e-6) {
    state.drawDistanceScale = Math.min(1, state.drawDistanceScale + DISTANCE_STEP * 0.5);
  } else if (gpuMeasured && state.tier < maxTier) {
    state.tier += 1;
    state.pixelScale = 1;
    state.drawDistanceScale = 1;
  } else {
    return state;
  }
  state.lastChangeMs = now;
  return state;
}

export class QualityController {
  private readonly config: QualityConfig;
  private readonly state: QualityState;
  private readonly tiers: QualityTier[];

  constructor(config: QualityConfig) {
    this.config = config;
    this.tiers =
      Array.isArray(config.qualityTiers) && config.qualityTiers.length > 0
        ? config.qualityTiers
        : DEFAULT_TIERS;
    this.state = createQualityState({ ...config, qualityTiers: this.tiers });
    this.state.tier = this.pickInitialTier();
  }

  /** Initial tier by hardware concurrency and touch capability. */
  private pickInitialTier(): number {
    const cores = navigator.hardwareConcurrency ?? 4;
    const touch = 'ontouchstart' in window;
    if (touch || cores <= 2) return 0;
    if (cores <= 4) return Math.min(1, this.tiers.length - 1);
    return this.tiers.length - 1;
  }

  get activeTier(): QualityTier {
    return this.tiers[this.state.tier];
  }

  /** Effective pixel ratio: the tier's base ratio times the band's multiplier. */
  get pixelRatio(): number {
    return effectivePixelRatio(this.state, this.config);
  }

  get drawDistanceScale(): number {
    return this.state.drawDistanceScale;
  }

  get gpuMeasured(): boolean {
    return this.state.gpuMeasured;
  }

  get shadowMapSize(): number {
    return this.activeTier.shadowMapSize;
  }

  get antialiasing(): boolean {
    return this.activeTier.antialiasing;
  }

  get maxTriangles(): number {
    return this.activeTier.maxTriangles;
  }

  /** One band decision. Call once per frame with the measured costs. */
  update(sample: QualitySample, now = performance.now()): void {
    nextQualityState(this.state, sample, this.config, now);
  }

  /**
   * Backwards-compatible entry point: derives a sample from fps and triangles
   * and runs the same band decision.
   */
  adjust(fps: number, triangles: number, now = performance.now()): void {
    const frameMs = fps > 0 ? 1000 / fps : this.config.gpuBandMaxMs;
    this.update({ frameMs, gpuMs: null, triangles }, now);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const DEFAULT_TIERS: QualityTier[] = [
  { name: 'low', pixelRatio: 1, shadowMapSize: 1024, maxTriangles: 50000, antialiasing: false },
  {
    name: 'medium',
    pixelRatio: 1.5,
    shadowMapSize: 2048,
    maxTriangles: 200000,
    antialiasing: true,
  },
  { name: 'high', pixelRatio: 2, shadowMapSize: 2048, maxTriangles: 500000, antialiasing: true },
];

export function createQualityController(config: QualityConfig): QualityController {
  return new QualityController(config);
}
