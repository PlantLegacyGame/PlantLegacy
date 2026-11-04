/**
 * C01 quality tiers and dynamic resolution scaling.
 *
 * Picks a tier from `config/render.json` `quality_tiers` based on the device
 * and the measured frame rate. When the render loop drops below
 * `fps_warning_threshold` of `target_fps`, the renderer pixel ratio is scaled
 * down toward `resolution_floor`; it climbs back up when performance allows.
 *
 * No per-frame allocations: the tier object is reused and only the active
 * pixel ratio changes.
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
}

export class QualityController {
  private readonly tiers: QualityTier[];
  private activeTierIndex: number;
  private currentPixelRatio: number;
  private readonly floor: number;
  private readonly ceiling: number;
  private readonly targetFps: number;
  private readonly warningThreshold: number;
  private lastAdjust = 0;
  private readonly adjustCooldownMs = 1000;

  constructor(config: QualityConfig) {
    this.tiers =
      Array.isArray(config.qualityTiers) && config.qualityTiers.length > 0
        ? config.qualityTiers
        : DEFAULT_TIERS;
    this.activeTierIndex = this.pickInitialTier();
    this.floor = finiteOr(config.resolutionFloor, 1);
    this.ceiling = finiteOr(config.maxPixelRatio, 2);
    this.targetFps = finiteOr(config.targetFps, 60);
    this.warningThreshold = finiteOr(config.fpsWarningThreshold, 0.85);
    this.currentPixelRatio = this.clampPixelRatio(this.tiers[this.activeTierIndex]?.pixelRatio);
  }

  /** Initial tier by hardware concurrency and touch capability. */
  private pickInitialTier(): number {
    const cores = navigator.hardwareConcurrency ?? 4;
    const touch = 'ontouchstart' in window;
    if (touch || cores <= 2) return 0;
    if (cores <= 4) return 1;
    return this.tiers.length - 1;
  }

  get activeTier(): QualityTier {
    return this.tiers[this.activeTierIndex];
  }

  get pixelRatio(): number {
    return this.currentPixelRatio;
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

  /** Adjust once per second based on measured fps. */
  adjust(fps: number, triangles: number, now = performance.now()): void {
    if (now - this.lastAdjust < this.adjustCooldownMs) return;
    this.lastAdjust = now;

    const target = this.targetFps * this.warningThreshold;

    if (fps > 0 && fps < target) {
      // Under budget: drop resolution toward the floor (minimum 0.8 to prevent pixelated soup).
      const effectiveFloor = Math.max(0.8, this.floor);
      const next = this.currentPixelRatio - 0.05;
      this.currentPixelRatio = this.clampPixelRatio(Math.max(next, effectiveFloor));
      return;
    }

    if (fps >= target + 8 && this.currentPixelRatio < this.ceiling) {
      // Headroom: climb back up smoothly.
      const next = this.currentPixelRatio + 0.05;
      this.currentPixelRatio = this.clampPixelRatio(Math.min(next, this.ceiling));
      return;
    }

    // Swap tier if triangles blow the tier budget.
    if (triangles > this.activeTier.maxTriangles && this.activeTierIndex > 0) {
      this.activeTierIndex -= 1;
      this.currentPixelRatio = this.clampPixelRatio(
        Math.min(this.currentPixelRatio, this.tiers[this.activeTierIndex].pixelRatio),
      );
    } else if (
      triangles <=
        this.tiers[Math.min(this.activeTierIndex + 1, this.tiers.length - 1)].maxTriangles &&
      this.activeTierIndex < this.tiers.length - 1
    ) {
      this.activeTierIndex += 1;
      this.currentPixelRatio = this.clampPixelRatio(
        Math.max(this.currentPixelRatio, this.tiers[this.activeTierIndex].pixelRatio),
      );
    }
  }

  private clampPixelRatio(value: number): number {
    const ratio = finiteOr(value, 1);
    return Math.max(this.floor, Math.min(this.ceiling, ratio));
  }
}

const DEFAULT_TIERS: QualityTier[] = [
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

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function createQualityController(config: QualityConfig): QualityController {
  return new QualityController(config);
}
