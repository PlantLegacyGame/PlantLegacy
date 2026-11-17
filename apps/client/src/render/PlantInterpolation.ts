/**
 * P0/2-B — interpolation for node positions that move between server ticks.
 *
 * Most plant nodes never move: a node is created once and its position is
 * final. Uprooted and tumbling plants are the exception — the server streams
 * new node positions every tick, and drawing them raw makes the whole body step
 * at the tick rate.
 *
 * The interpolator keeps a short segment per node: where it was, where the
 * server says it is, and when the segment started. `sample()` returns the point
 * at the render clock. A new capture starts from wherever the node currently is,
 * so a late packet bends the path instead of teleporting the body.
 *
 * It is deliberately free of Three.js so the maths is unit-tested directly.
 */

export interface InterpolatedPoint {
  x: number;
  y: number;
  z: number;
}

interface Segment {
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  startMs: number;
  durationMs: number;
}

export class NodeInterpolator {
  private readonly segments = new Map<string, Segment>();

  get size(): number {
    return this.segments.size;
  }

  /**
   * Record a server position for `id`.
   *
   * `durationMs` is how long the move should take to draw — normally the server
   * tick interval, so the body arrives at the authoritative position just as the
   * next packet lands.
   */
  capture(id: string, x: number, y: number, z: number, nowMs: number, durationMs: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const existing = this.segments.get(id);
    const duration = Math.max(1, durationMs);
    if (existing) {
      const current = this.sampleSegment(existing, nowMs);
      existing.fromX = current.x;
      existing.fromY = current.y;
      existing.fromZ = current.z;
      existing.toX = x;
      existing.toY = y;
      existing.toZ = z;
      existing.startMs = nowMs;
      existing.durationMs = duration;
      return;
    }
    this.segments.set(id, {
      fromX: x,
      fromY: y,
      fromZ: z,
      toX: x,
      toY: y,
      toZ: z,
      startMs: nowMs,
      durationMs: duration,
    });
  }

  /** Write the interpolated position into `out`. False when `id` is unknown. */
  sample(id: string, nowMs: number, out: InterpolatedPoint): boolean {
    const segment = this.segments.get(id);
    if (!segment) return false;
    const point = this.sampleSegment(segment, nowMs);
    out.x = point.x;
    out.y = point.y;
    out.z = point.z;
    return true;
  }

  /** Drop one node (a plant was removed, or its body settled). */
  forget(id: string): void {
    this.segments.delete(id);
  }

  /** Drop everything whose id is not in `keep`. */
  prune(keep: ReadonlySet<string>): void {
    for (const id of this.segments.keys()) {
      if (!keep.has(id)) this.segments.delete(id);
    }
  }

  clear(): void {
    this.segments.clear();
  }

  private sampleSegment(segment: Segment, nowMs: number): InterpolatedPoint {
    const span = Math.max(1, segment.durationMs);
    const t = Math.min(1, Math.max(0, (nowMs - segment.startMs) / span));
    return {
      x: segment.fromX + (segment.toX - segment.fromX) * t,
      y: segment.fromY + (segment.toY - segment.fromY) * t,
      z: segment.fromZ + (segment.toZ - segment.fromZ) * t,
    };
  }
}

/**
 * How long a streamed node position should take to draw.
 *
 * The server sends a movement packet per tick; drawing the movement over that
 * interval means the body is always exactly one packet behind the server and
 * never steps. Clamped so a stalled connection does not turn into a slow slide.
 */
export function interpolationDurationMs(tickRateHz: number, maxMs = 250): number {
  const hz = Number.isFinite(tickRateHz) && tickRateHz > 0 ? tickRateHz : 20;
  return Math.min(maxMs, 1000 / hz);
}
