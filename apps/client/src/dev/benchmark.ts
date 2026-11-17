/**
 * AL-01 — benchmark and fixed poses.
 *
 * A quality claim needs a baseline. This walks a fixed list of camera poses,
 * records real frame cost for each, and reports the distribution instead of an
 * average. Poses are config (`config/dev.json` `benchmark_poses`), so the six
 * comparison shots are reproducible without editing code.
 *
 * The runner is pure: it takes samples and a clock, and asks the caller to place
 * the camera. It never touches the DOM or Three.js, so the stats and the pose
 * schedule are unit-tested.
 */

export interface BenchmarkPose {
  /** Stable name used in the report, e.g. `seedling`. */
  id: string;
  /** Orbit distance from the focus point, metres. */
  distanceM: number;
  /** Azimuth around the focus, degrees clockwise from +X. */
  azimuthDeg: number;
  /** Elevation above the horizon at the focus, degrees. Negative looks up. */
  elevationDeg: number;
  /** Height added to the focus point, metres (canopy, roots, ground). */
  targetLiftM: number;
}

export interface BenchmarkSample {
  frameMs: number;
  gpuMs: number | null;
  triangles: number;
  drawCalls: number;
}

export interface PoseStats {
  id: string;
  samples: number;
  avgFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  avgGpuMs: number | null;
  p95GpuMs: number | null;
  avgTriangles: number;
  avgDrawCalls: number;
}

export interface BenchmarkReport {
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  gpuMeasured: boolean;
  poses: PoseStats[];
  overall: PoseStats;
}

export interface BenchmarkOptions {
  poses: readonly BenchmarkPose[];
  /** Frames discarded after the pose is applied, per pose. */
  warmupMs: number;
  /** Measured window per pose. */
  poseMs: number;
  /** Places the camera. Called on start and on every pose change. */
  applyPose: (pose: BenchmarkPose) => void;
  /** Called once when the run completes. */
  onFinish?: (report: BenchmarkReport) => void;
}

interface PoseBuffer {
  frame: number[];
  gpu: number[];
  triangles: number[];
  drawCalls: number[];
}

/** Nearest-rank percentile on an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function summarize(id: string, buffer: PoseBuffer): PoseStats {
  const frame = [...buffer.frame].sort((a, b) => a - b);
  const gpu = [...buffer.gpu].sort((a, b) => a - b);
  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    id,
    samples: frame.length,
    avgFrameMs: mean(buffer.frame),
    p50FrameMs: percentile(frame, 50),
    p95FrameMs: percentile(frame, 95),
    p99FrameMs: percentile(frame, 99),
    maxFrameMs: frame.length > 0 ? frame[frame.length - 1] : 0,
    avgGpuMs: buffer.gpu.length > 0 ? mean(buffer.gpu) : null,
    p95GpuMs: gpu.length > 0 ? percentile(gpu, 95) : null,
    avgTriangles: mean(buffer.triangles),
    avgDrawCalls: mean(buffer.drawCalls),
  };
}

export class BenchmarkRunner {
  private readonly options: BenchmarkOptions;
  private running = false;
  private poseIndex = -1;
  private poseStartedAt = 0;
  private startedAt = 0;
  private buffers: PoseBuffer[] = [];
  private finished: BenchmarkReport | null = null;
  private sawGpu = false;

  constructor(options: BenchmarkOptions) {
    this.options = options;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentPose(): BenchmarkPose | null {
    return this.poseIndex >= 0 ? (this.options.poses[this.poseIndex] ?? null) : null;
  }

  get lastReport(): BenchmarkReport | null {
    return this.finished;
  }

  start(nowMs: number): void {
    if (this.options.poses.length === 0) return;
    this.running = true;
    this.poseIndex = 0;
    this.startedAt = nowMs;
    this.poseStartedAt = nowMs;
    this.sawGpu = false;
    this.finished = null;
    this.buffers = this.options.poses.map(() => ({
      frame: [],
      gpu: [],
      triangles: [],
      drawCalls: [],
    }));
    this.options.applyPose(this.options.poses[0]);
  }

  /** Feed one measured frame. Returns true when the run just finished. */
  tick(nowMs: number, sample: BenchmarkSample): boolean {
    if (!this.running) return false;
    const elapsedInPose = nowMs - this.poseStartedAt;
    const totalPoseMs = this.options.warmupMs + this.options.poseMs;
    if (elapsedInPose >= totalPoseMs) {
      const next = this.poseIndex + 1;
      if (next >= this.options.poses.length) {
        this.finish(nowMs);
        return true;
      }
      this.poseIndex = next;
      this.poseStartedAt = nowMs;
      this.options.applyPose(this.options.poses[this.poseIndex]);
      return false;
    }
    // Warm-up frames include shader compilation and cache misses; recording them
    // would make the first pose look slower than the scene really is.
    if (elapsedInPose < this.options.warmupMs) return false;
    if (!Number.isFinite(sample.frameMs) || sample.frameMs <= 0) return false;

    const buffer = this.buffers[this.poseIndex];
    buffer.frame.push(sample.frameMs);
    if (sample.gpuMs !== null && sample.gpuMs > 0) {
      buffer.gpu.push(sample.gpuMs);
      this.sawGpu = true;
    }
    buffer.triangles.push(sample.triangles);
    buffer.drawCalls.push(sample.drawCalls);
    return false;
  }

  stop(nowMs: number): BenchmarkReport | null {
    if (!this.running) return this.finished;
    this.finish(nowMs);
    return this.finished;
  }

  private finish(nowMs: number): void {
    this.running = false;
    const poses = this.options.poses.map((pose, index) => summarize(pose.id, this.buffers[index]));
    const all: PoseBuffer = { frame: [], gpu: [], triangles: [], drawCalls: [] };
    for (const buffer of this.buffers) {
      all.frame.push(...buffer.frame);
      all.gpu.push(...buffer.gpu);
      all.triangles.push(...buffer.triangles);
      all.drawCalls.push(...buffer.drawCalls);
    }
    this.finished = {
      startedAtMs: this.startedAt,
      finishedAtMs: nowMs,
      durationMs: nowMs - this.startedAt,
      gpuMeasured: this.sawGpu,
      poses,
      overall: summarize('overall', all),
    };
    this.options.onFinish?.(this.finished);
  }
}

/** Default six poses, used only when `config/dev.json` cannot be read. */
export const DEFAULT_BENCHMARK_POSES: BenchmarkPose[] = [
  { id: 'seedling', distanceM: 6, azimuthDeg: 35, elevationDeg: 18, targetLiftM: 0 },
  { id: 'canopy-from-below', distanceM: 9, azimuthDeg: 200, elevationDeg: -22, targetLiftM: 2 },
  { id: 'silhouette', distanceM: 14, azimuthDeg: 120, elevationDeg: 6, targetLiftM: 1.5 },
  { id: 'golden-hour-wide', distanceM: 28, azimuthDeg: 300, elevationDeg: 12, targetLiftM: 0.5 },
  { id: 'root-layer', distanceM: 5, azimuthDeg: 80, elevationDeg: -35, targetLiftM: -1.5 },
  { id: 'terrain-panorama', distanceM: 90, azimuthDeg: 15, elevationDeg: 30, targetLiftM: 0 },
];
